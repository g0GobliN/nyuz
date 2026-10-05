/**
 * One resolved feed becoming one shared Nyuz source.
 *
 * ---------------------------------------------------------------------------
 * There is no second registry
 * ---------------------------------------------------------------------------
 *
 * This is the only writer in the discovery system, and what it writes is an
 * ordinary `sources` row plus an ordinary `source_topics` row. From the moment
 * the insert commits, the discovered source is indistinguishable from a
 * curated one to every stage that reads the table: the ingester fetches it by
 * `last_fetched_at`, `refresh_source_demand` keeps it collected because the
 * link exists, `recompute_polling_tiers` learns its cadence, and the article
 * it produces is clustered, classified, analysed, matched and briefed exactly
 * like any other. Nothing downstream learns that discovery exists -- which is
 * the property the whole design rests on.
 *
 * ---------------------------------------------------------------------------
 * The three fields that make it safe
 * ---------------------------------------------------------------------------
 *
 *   origin = 'discovered'   provenance, so an operator can tell where a feed
 *                           came from and find it in the console.
 *   listed = false          it never appears in another reader's catalogue.
 *                           Promotion is a deliberate act, not a side effect.
 *   coverage_mode = 'demand' its reason to be collected is that somebody
 *                           follows the subject, which is literally true.
 *
 * ---------------------------------------------------------------------------
 * Idempotence is the database's job
 * ---------------------------------------------------------------------------
 *
 * `sources.feed_url` is unique and is the backstop: two jobs that resolved the
 * same site race on the insert, one wins with 23505, and the loser re-reads
 * the winner's row. The same shape the custom-source path already uses --
 * `followCustomSource` documents the identical race -- so a discovered source
 * and a reader-submitted source cannot become two rows for one feed no matter
 * which arrives first.
 *
 * The topic link uses `ignoreDuplicates`, so an editorial mapping or an
 * observation from `recordObservedCoverage` is never overwritten by a
 * discovery's lower-confidence guess.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalUrl, feedUrlVariants } from "@/lib/pipeline/canonical";
import type { Database } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

/**
 * Initial confidence for a discovered source→topic link.
 *
 * Below the observed-coverage value (0.3) and far below an editorial mapping
 * (1.0). One search result is weaker evidence than one event the outlet
 * actually carried, and much weaker than a human's assertion. The number is
 * not a ranking input anywhere today; it exists so the console can show who
 * claimed what, and so a later promotion has a starting point.
 */
export const DISCOVERY_CONFIDENCE = 0.25;

export type RegistrationInput = {
  topicId: string;
  /** Canonical feed URL. The unique key this whole step turns on. */
  feedUrl: string;
  homepage: string;
  /** Feed title, candidate title, or the domain as a last resort. */
  name: string;
  /** For the audit row only; never stored on the source. */
  topicLabel: string;
};

export type RegistrationResult =
  { ok: true; sourceId: string; created: boolean } | { ok: false; reason: string };

export async function registerDiscoveredSource(
  db: Db,
  input: RegistrationInput,
): Promise<RegistrationResult> {
  // Canonicalised here rather than trusted from the caller. Both current callers
  // already pass `canonicalUrl(...)`, so this is idempotent -- but the column is
  // a lookup key, and a third caller that skipped the step would register a
  // rival row for a feed the catalogue already holds. 0107 is the cleanup for
  // what is already there; this is what stops the next one arriving.
  const feedUrl = canonicalUrl(input.feedUrl) ?? input.feedUrl;

  const existing = await findSource(db, feedUrl);
  if (existing !== null) {
    await linkTopic(db, existing.id, input.topicId);
    return { ok: true, sourceId: existing.id, created: false };
  }

  const name = input.name.trim().slice(0, 120) || domainOf(feedUrl);

  const { data, error } = await db
    .from("sources")
    .insert({
      name,
      feed_url: feedUrl,
      homepage: input.homepage,
      kind: "rss",
      // Demand coverage by construction: it exists because a followed subject
      // had none. Not `core` -- nothing here is editorially chosen.
      coverage_mode: "demand",
      // Private until a human promotes it: a discovered feed must not appear
      // in another reader's source catalogue because a search engine matched a
      // query.
      listed: false,
      origin: "discovered",
      active: true,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505: another invocation registered the same feed first. Re-read and
    // use their row -- the loser of the race must not report a failure.
    if (error.code === "23505") {
      const raced = await findSource(db, feedUrl);
      if (raced !== null) {
        await linkTopic(db, raced.id, input.topicId);
        return { ok: true, sourceId: raced.id, created: false };
      }
    }
    return { ok: false, reason: error.message };
  }

  if (!data) return { ok: false, reason: "insert returned no row" };

  await linkTopic(db, data.id, input.topicId);

  // Every other write in the pipeline leaves an audit row when it changes what
  // is collected -- see `recordFailure` in ingest.ts. A discovery invocation
  // adding a source is held to the same standard, so a feed that appears in the
  // console has an explanation attached that names no reader.
  await db.from("admin_audit_log").insert({
    actor_id: null,
    actor_email: "pipeline:discovery",
    action: "source.discover.register",
    target_type: "source",
    target_id: data.id,
    meta: { topic_id: input.topicId, topic: input.topicLabel, feed_url: feedUrl },
  });

  return { ok: true, sourceId: data.id, created: true };
}

async function findSource(db: Db, feedUrl: string): Promise<{ id: string } | null> {
  // Both spellings, so a discovered feed that the catalogue already holds in
  // the slashed form links to that row instead of registering a rival for it.
  // Same reason as `findSource` in src/lib/server/custom-sources.ts: the unique
  // constraint sees `…/feed` and `…/feed/` as two different feeds.
  const { data } = await db.from("sources").select("id").in("feed_url", feedUrlVariants(feedUrl));
  return data?.[0] ?? null;
}

/**
 * The source→topic link, or nothing if one already exists.
 *
 * A failed link is not a failed registration. The source is in the registry
 * and will be collected the moment demand exists for it; the link is what
 * creates that demand. If this write is lost, the next discovery pass for the
 * same topic re-finds the source by `feed_url` and tries the link again --
 * which is why the failure is logged rather than raised.
 */
async function linkTopic(db: Db, sourceId: string, topicId: string): Promise<void> {
  const { error } = await db
    .from("source_topics")
    .upsert(
      { source_id: sourceId, topic_id: topicId, confidence: DISCOVERY_CONFIDENCE },
      { onConflict: "source_id,topic_id", ignoreDuplicates: true },
    );

  if (error) {
    console.warn(
      `discovery: linking source ${sourceId} to topic ${topicId} failed: ${error.message}`,
    );
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
