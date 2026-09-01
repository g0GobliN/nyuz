import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { signedInOnly, AdminAuthError } from "@/lib/server/guard";
import { isPublicHttpUrl } from "@/lib/net/public-url";
import { canonicalUrl } from "@/lib/pipeline/canonical";
import { fetchFeed } from "@/lib/pipeline/fetch";
import { parseFeed } from "@/lib/pipeline/feed";
import { PLAN_LIMITS } from "@/lib/plans";
import type { Database, PlanTier, SourceKind } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

/**
 * Sources a reader asked nyuz to watch (docs/plan2.md phase 3b).
 *
 * ---------------------------------------------------------------------------
 * One canonical source, many followers
 * ---------------------------------------------------------------------------
 *
 * The single most important thing in this file is that adding a feed two
 * readers both want produces ONE row in `sources`. Everything downstream —
 * one crawler, one clustering pass, one analysis — depends on that, and the
 * naive implementation (a source row per follow) would invert the property
 * the whole product is priced on.
 *
 * So `follow` canonicalises the URL, looks for an existing source, and only
 * inserts when there genuinely is not one. The unique constraint on
 * `sources.feed_url` is the backstop: two readers adding the same feed at the
 * same moment race, one insert loses on the constraint, and the loser re-reads
 * the winner's row rather than erroring.
 *
 * ---------------------------------------------------------------------------
 * A submitted URL is hostile until proven otherwise
 * ---------------------------------------------------------------------------
 *
 * This is the only place in the product where a stranger's string becomes a
 * `fetch()` target for a Worker holding the service-role key. Every
 * protection plan2 §14 asks for is applied, and all of it comes from code
 * that already exists rather than a second implementation:
 *
 *   - `isPublicHttpUrl` — https/http only, no credentials in the URL, and no
 *     loopback, private, link-local, CGNAT or IPv6 unique-local host. That
 *     covers `file:`, `javascript:`, `data:`, localhost and cloud metadata
 *     endpoints (169.254.169.254 is link-local).
 *   - `fetchFeed` — re-validates after EVERY redirect hop, so a public URL
 *     that 302s to 127.0.0.1 is refused at the hop rather than followed.
 *     Also caps redirects, response size and wall-clock time.
 *   - `parseFeed` — the same parser the ingester uses, so a "feed" that is
 *     actually an HTML page is rejected here rather than discovered later.
 *
 * The feed is fetched before the source is created, deliberately. A row that
 * has never been proven to parse is how the four dead feeds in `0025` got
 * into the database in the first place (see docs/track.md) — the console's
 * add form validates a URL's *shape* and never fetched it.
 */

/** Plan caps are enforced in Postgres by `claim_custom_source`; this is for display. */
export type CustomSourceRow = {
  sourceId: string;
  name: string;
  feedUrl: string;
  homepage: string | null;
  kind: SourceKind;
  active: boolean;
  /** Whether nyuz is currently able to read it. */
  healthy: boolean;
  createdAt: string;
};

export type CustomSourceList = {
  sources: CustomSourceRow[];
  plan: PlanTier;
  limit: number;
  used: number;
};

export const listCustomSources = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<CustomSourceList> => {
    const { actor } = context;

    const [{ data: rows, error }, { data: subscription }] = await Promise.all([
      actor.db
        .from("user_custom_sources")
        .select(
          "source_id, active, created_at, sources ( name, feed_url, homepage, kind, active, failure_count )",
        )
        .eq("user_id", actor.id)
        .order("created_at", { ascending: true }),
      actor.db.from("subscriptions").select("plan").eq("user_id", actor.id).maybeSingle(),
    ]);

    if (error) throw new AdminAuthError(`List custom sources: ${error.message}`, 500);

    const plan = subscription?.plan ?? "free";
    const sources = (rows ?? []).flatMap((row) => {
      const joined = row.sources as {
        name?: string;
        feed_url?: string;
        homepage?: string | null;
        kind?: SourceKind;
        active?: boolean;
        failure_count?: number;
      } | null;
      if (!joined?.name || !joined.feed_url) return [];
      return [
        {
          sourceId: row.source_id,
          name: joined.name,
          feedUrl: joined.feed_url,
          homepage: joined.homepage ?? null,
          kind: joined.kind ?? ("rss" as SourceKind),
          active: row.active,
          // A source the ingester has switched off, or is backing off from,
          // is reported honestly rather than shown as if it were working.
          healthy: joined.active !== false && (joined.failure_count ?? 0) < 3,
          createdAt: row.created_at,
        },
      ];
    });

    return {
      sources,
      plan,
      limit: PLAN_LIMITS[plan]?.customSources ?? 0,
      used: sources.length,
    };
  });

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
  }, "Must be a public http or https URL.");

export type FollowResult =
  | { ok: true; sourceId: string; name: string; shared: boolean }
  | { ok: false; reason: "limit" | "rate" | "unreachable" | "not-a-feed"; detail: string };

export const followCustomSource = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => parseInput(z.object({ feedUrl }), input))
  .handler(async ({ context, data }): Promise<FollowResult> => {
    const { actor } = context;

    // Canonicalised with the same function the ingester uses on every article
    // URL, so "example.com/feed?utm_source=x" and "example.com/feed" are one
    // source rather than two.
    const canonical = canonicalUrl(data.feedUrl);
    if (canonical === null || !isPublicHttpUrl(canonical)) {
      return { ok: false, reason: "unreachable", detail: "That is not a usable feed address." };
    }

    const existing = await findSource(actor.db, canonical);

    // Only pay for a fetch when the source is genuinely new. A feed nyuz
    // already watches has already been proven to parse, and re-fetching it on
    // every follow would let one reader make the product hammer a publisher.
    let sourceId = existing?.id ?? null;
    let name = existing?.name ?? "";
    const shared = existing !== null;

    if (sourceId === null) {
      const { data: probeClaim, error: probeClaimError } = await actor.db.rpc(
        "claim_source_probe",
        { p_user_id: actor.id },
      );
      if (probeClaimError) {
        throw new AdminAuthError(`Authorising source probe: ${probeClaimError.message}`, 500);
      }
      if (probeClaim !== "ok") {
        const reason = probeClaim === "rate" ? "rate" : "limit";
        const detail =
          probeClaim === "rate"
            ? "You have checked several new feeds recently. Try again in an hour."
            : probeClaim === "plan"
              ? "Adding your own sources is included on Personal and Pro."
              : "You are already at the source limit for your plan.";
        return { ok: false, reason, detail };
      }

      const probe = await probeFeed(canonical);
      if (!probe.ok) return probe.error;

      const created = await createSource(actor.db, canonical, probe.title, probe.homepage);
      if (created === null) {
        // Lost the insert race: another reader created it between the lookup
        // and now. Their row is the canonical one — read it and follow that.
        const raced = await findSource(actor.db, canonical);
        if (raced === null) {
          return { ok: false, reason: "unreachable", detail: "Could not add that source." };
        }
        sourceId = raced.id;
        name = raced.name;
      } else {
        sourceId = created.id;
        name = created.name;
      }
    }

    const { data: claim, error: claimError } = await actor.db.rpc("claim_custom_source", {
      p_user_id: actor.id,
      p_source_id: sourceId,
    });
    if (claimError) throw new AdminAuthError(`Follow source: ${claimError.message}`, 500);

    if (claim === "limit") {
      const plan = await planOf(actor.db, actor.id);
      const cap = PLAN_LIMITS[plan]?.customSources ?? 0;
      return {
        ok: false,
        reason: "limit",
        detail:
          cap === 0
            ? "Adding your own sources is included on Personal and Pro."
            : `You are following ${cap} sources, which is the limit on your plan.`,
      };
    }

    return { ok: true, sourceId, name, shared };
  });

export const unfollowCustomSource = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => parseInput(z.object({ sourceId: z.string().uuid() }), input))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { actor } = context;

    // Scoped to this reader by the RLS delete policy AND by the filter: the
    // policy is the guard, the filter is what makes the intent legible.
    const { error } = await actor.db
      .from("user_custom_sources")
      .delete()
      .eq("user_id", actor.id)
      .eq("source_id", data.sourceId);

    if (error) throw new AdminAuthError(`Unfollow source: ${error.message}`, 500);

    // The `sources` row stays, even with no followers left. Articles
    // reference it, and zero demand is phase 5's business (pause collection,
    // with a grace period), not a reason to delete shared history.
    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* Internals                                                              */
/* ---------------------------------------------------------------------- */

async function findSource(db: Db, canonical: string): Promise<{ id: string; name: string } | null> {
  const { data } = await db
    .from("sources")
    .select("id, name")
    .eq("feed_url", canonical)
    .maybeSingle();
  return data ?? null;
}

type ProbeOk = { ok: true; title: string; homepage: string | null };
type ProbeFail = { ok: false; error: Extract<FollowResult, { ok: false }> };

/**
 * Fetches and parses the feed before anything is written.
 *
 * Both failure modes are reported distinctly because they need different
 * actions from the reader: "I cannot reach this" usually means a typo or a
 * site that is down, while "this is not a feed" usually means they pasted the
 * page rather than the feed.
 */
async function probeFeed(url: string): Promise<ProbeOk | ProbeFail> {
  const fetched = await fetchFeed(url);
  if (!fetched.ok) {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "unreachable",
        detail: `Could not read that address (${fetched.reason}).`,
      },
    };
  }

  const parsed = parseFeed(fetched.body);
  // `format: "unknown"` is what an HTML page parses as — the most common
  // mistake, pasting the page rather than the feed. A feed with zero *items*
  // is legal and common (0006's notes: arXiv declares skipDays at weekends),
  // so emptiness is deliberately not the test; being a feed at all is.
  if (parsed.format === "unknown") {
    return {
      ok: false,
      error: {
        ok: false,
        reason: "not-a-feed",
        detail:
          "That address did not return an RSS or Atom feed. It may be the page rather than the feed.",
      },
    };
  }

  return {
    ok: true,
    title: parsed.title?.trim() || new URL(url).hostname,
    // The feed's own homepage is not something `parseFeed` extracts — it
    // exists to read items, not metadata. The feed's origin is a truthful
    // stand-in and is what a reader would click.
    homepage: new URL(url).origin,
  };
}

async function createSource(
  db: Db,
  canonical: string,
  title: string,
  homepage: string | null,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await db
    .from("sources")
    .insert({
      name: title.slice(0, 120),
      feed_url: canonical,
      homepage,
      kind: "rss",
      // Reader-requested, so it is demand coverage by definition — it exists
      // because somebody asked, which is exactly what `demand` means (0018).
      coverage_mode: "demand",
      // Three separate questions, answered separately (0039). This row is
      // private to the readers who follow it: `listed` stays false so it never
      // appears in another reader's catalogue, and `origin` records where it
      // came from without naming a person — ownership is the follow rows in
      // `user_custom_sources`, which is a many-to-many because one canonical
      // source serves every reader who asked for it.
      //
      // Both are written explicitly rather than left to the column defaults so
      // that reading this function tells you what a submitted source is.
      listed: false,
      origin: "user",
    })
    .select("id, name")
    .maybeSingle();

  // 23505 is unique_violation: somebody else created it first. Not an error
  // here, just a lost race the caller resolves by re-reading.
  if (error) return null;
  return data ?? null;
}

async function planOf(db: Db, userId: string): Promise<PlanTier> {
  const { data } = await db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.plan ?? "free";
}
