import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import { z } from "zod";
import { adminOnly, audit, AdminAuthError } from "@/lib/server/guard";
import { isPublicHttpUrl } from "@/lib/net/public-url";
import type { Source, SourceKind } from "@/lib/supabase/types";

/**
 * Source administration for the console.
 *
 * `sources` is global content: readable by any signed-in reader, writable only
 * by the service role. So every mutation here runs behind `adminOnly` and goes
 * through the service-role client on `context.actor.db` — there is no policy
 * that would let a browser write this table directly, by design.
 *
 * Three actions, matching what an operator actually needs and nothing more:
 * add a feed, disable one, and clear a failure count after fixing a URL.
 *
 * **Disable, never delete.** `articles.source_id` is `on delete set null`, so
 * dropping a source would silently orphan every article it ever contributed and
 * quietly break the source list on those stories' pages. Setting `active = false`
 * stops the ingester reading it while leaving the history attributable. The seed
 * in 0006 is `on conflict do nothing` for the same reason: re-running a migration
 * must not resurrect a feed an operator deliberately turned off.
 */

/* ---------------------------------------------------------------------- */
/* Read                                                                   */
/* ---------------------------------------------------------------------- */

/** A source plus the counts an operator needs to judge whether it is working. */
export type SourceSummary = Source & {
  /** Articles attributed to this source. `null` when stats are unavailable. */
  article_count: number | null;
  /** Most recent article's publication time, for spotting a stalled feed. */
  latest_article_at: string | null;
};

/**
 * Every source, newest failure first so the broken ones surface at the top.
 *
 * Counts come from the `admin_source_stats()` function in 0007 rather than a
 * query per source: sixty-six sources would otherwise mean sixty-six round
 * trips to render one page.
 *
 * If that function is missing — someone ran 0006 but not 0007 — the counts come
 * back `null` and the page renders without them rather than failing. An operator
 * locked out of the source list because a stats helper is absent cannot fix the
 * feed that is actually broken.
 */
export const listSources = createServerFn({ method: "GET" })
  .middleware([adminOnly])
  .handler(async ({ context }): Promise<SourceSummary[]> => {
    const { db } = context.actor;

    const { data: rows, error } = await db
      .from("sources")
      .select("*")
      .order("failure_count", { ascending: false })
      .order("name", { ascending: true });

    if (error) throw new AdminAuthError(`List sources: ${error.message}`, 500);

    const stats = new Map<string, { article_count: number; latest_article_at: string | null }>();
    const { data: statRows } = await db.rpc("admin_source_stats");
    for (const row of statRows ?? []) {
      stats.set(row.source_id, {
        article_count: row.article_count,
        latest_article_at: row.latest_article_at,
      });
    }
    const haveStats = statRows !== null && statRows !== undefined;

    return (rows ?? []).map((row) => ({
      ...row,
      article_count: haveStats ? (stats.get(row.id)?.article_count ?? 0) : null,
      latest_article_at: stats.get(row.id)?.latest_article_at ?? null,
    }));
  });

/* ---------------------------------------------------------------------- */
/* Write                                                                  */
/* ---------------------------------------------------------------------- */

const SOURCE_KINDS = [
  "company_blog",
  "news",
  "rss",
  "github",
  "research",
  "product",
  "other",
] as const satisfies readonly SourceKind[];

/**
 * `http(s)` only, and the protocol is checked explicitly rather than left to
 * `z.string().url()`, which happily accepts `javascript:` and `file:`. This
 * value is handed to `fetch()` by a scheduled job holding the service-role key,
 * so the set of schemes it may name is worth being deliberate about.
 */
const feedUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      return isPublicHttpUrl(value);
    } catch {
      return false;
    }
  }, "Must be an absolute http or https URL.");

export const createSource = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        feedUrl,
        homepage: z
          .string()
          .trim()
          .max(2048)
          .optional()
          .refine((v) => !v || isPublicHttpUrl(v), "Homepage must be a public http(s) URL."),
        kind: z.enum(SOURCE_KINDS).default("rss"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true; id: string }> => {
    const { actor } = context;

    const { data: row, error } = await actor.db
      .from("sources")
      .insert({
        name: data.name,
        feed_url: data.feedUrl,
        homepage: data.homepage && data.homepage.length > 0 ? data.homepage : null,
        kind: data.kind,
      })
      .select("id")
      .maybeSingle();

    // 23505 is unique_violation. `feed_url` is unique, and "you already watch
    // this feed" is a different sentence from "the insert failed" — an operator
    // pasting a URL twice should be told which of the two happened.
    if (error) {
      const already = error.code === "23505";
      throw new AdminAuthError(
        already ? "That feed URL is already on the list." : `Add source: ${error.message}`,
        already ? 409 : 500,
      );
    }
    if (!row) throw new AdminAuthError("Add source: the row came back empty.", 500);

    await audit(
      actor,
      "source.create",
      { type: "source", id: row.id },
      {
        name: data.name,
        feed_url: data.feedUrl,
        kind: data.kind,
      },
    );

    return { ok: true, id: row.id };
  });

/**
 * Turns a feed on or off.
 *
 * Reactivating also clears `failure_count`, because the count is the ingester's
 * backoff state and an operator switching a source back on is asserting they
 * have fixed it. Leaving a count of twelve behind would mean the feed is
 * "active" and still skipped by backoff — active-but-ignored is the worst of the
 * three states to debug.
 */
export const setSourceActive = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    parseInput(z.object({ id: z.string().uuid(), active: z.boolean() }), input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    const { error } = await actor.db
      .from("sources")
      .update(data.active ? { active: true, failure_count: 0 } : { active: false })
      .eq("id", data.id);

    if (error) throw new AdminAuthError(`Update source: ${error.message}`, 500);

    await audit(actor, data.active ? "source.enable" : "source.disable", {
      type: "source",
      id: data.id,
    });

    return { ok: true };
  });

/** Clears backoff state without touching `active`, for a feed that has recovered. */
export const resetSourceFailures = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) => parseInput(z.object({ id: z.string().uuid() }), input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    const { error } = await actor.db.from("sources").update({ failure_count: 0 }).eq("id", data.id);

    if (error) throw new AdminAuthError(`Reset failures: ${error.message}`, 500);
    await audit(actor, "source.reset_failures", { type: "source", id: data.id });
    return { ok: true };
  });

/**
 * Promotes a source into the reader catalogue, or withdraws it (0039).
 *
 * Separate from `setSourceActive` because the two answer different questions
 * and an operator needs both independently: `active` decides whether nyuz
 * *crawls* it, `listed` decides whether readers can *find* it. A
 * reader-submitted feed is normally active and unlisted — crawled for the
 * people who asked, invisible to everybody else — and promoting a good one is
 * how the catalogue grows.
 *
 * Audited, because listing a source publishes one reader's private feed to
 * every other reader. That is not reversible in the sense that matters: it can
 * be unlisted, but not un-seen.
 */
export const setSourceListed = createServerFn({ method: "POST" })
  .middleware([adminOnly])
  .validator((input: unknown) =>
    parseInput(z.object({ id: z.string().uuid(), listed: z.boolean() }), input),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    const { error } = await actor.db
      .from("sources")
      .update({ listed: data.listed })
      .eq("id", data.id);

    if (error) throw new AdminAuthError(`Update listing: ${error.message}`, 500);

    await audit(actor, data.listed ? "source.list" : "source.unlist", {
      type: "source",
      id: data.id,
    });

    return { ok: true };
  });
