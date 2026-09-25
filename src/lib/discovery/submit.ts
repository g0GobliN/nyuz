/**
 * M2 -- the one seed source that can reach a subject nothing in the corpus
 * mentions: a URL the reader supplied.
 *
 * ---------------------------------------------------------------------------
 * Why this is a function and not (yet) a server function
 * ---------------------------------------------------------------------------
 *
 * The intake rule is the part worth getting right, and it is testable without a
 * browser: given a URL, decide whether a feed exists behind it, whether that
 * feed is about the subject at all, and what to do when the answer is "not
 * yet". The console/reader surface that calls it is a later, smaller change --
 * and this shape is what `followCustomSource` already does for a reader's own
 * sources, with the same `resolveFeed`/`registerDiscoveredSource` machinery.
 *
 * ---------------------------------------------------------------------------
 * The invariant: a source exists only behind a resolved feed
 * ---------------------------------------------------------------------------
 *
 * Nothing here registers a source because a URL looked plausible. A page that
 * answers 200 with HTML, a domain that exists, a URL the reader typed from
 * memory -- none of those are evidence. The order is fixed:
 *
 *   canonicalise -> resolveFeed (a real RSS/Atom/RDF document, or a declared
 *   link to one) -> relevance tripwire -> register + link
 *
 * A failure at any step is a refusal or a queued retry, never a row. That is
 * the same standard `custom-sources.ts` holds a reader-submitted feed to, and
 * the reason four dead feeds are documented in `0025_disable_dead_sources`.
 *
 * ---------------------------------------------------------------------------
 * The retry queue is the candidate registry
 * ---------------------------------------------------------------------------
 *
 * A transient failure (timeout, 5xx, a site that is briefly down) writes one
 * `source_candidates` row and stops. The next discovery tick picks it up
 * through the ordinary resolver pass -- the same code path a resolved
 * candidate takes -- so there is exactly one place where a candidate becomes a
 * source, and this module never duplicates it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicHttpUrl } from "@/lib/net/public-url";
import { canonicalUrl } from "@/lib/pipeline/canonical";
import type { Database } from "@/lib/supabase/types";
import { passesRelevanceTripwire, resolveFeed, type FeedFetcher } from "./feed";
import { registerDiscoveredSource } from "./register";

type Db = SupabaseClient<Database>;

export type SubmitRefusal = {
  ok: false;
  reason:
    /** Not a public http(s) URL, or not a URL at all. */
    | "unusable-url"
    /** Readable, and there is no feed on it or at the conventional addresses. */
    | "no-feed"
    /** A feed, but nothing in it or around it mentions the subject. */
    | "not-relevant"
    /** Network, timeout or 5xx. Queued for the next tick. */
    | "transient"
    /** Our database, not the site. Queued for the next tick. */
    | "storage";
  /** Whether the refusal is worth retrying. Drives whether a candidate is queued. */
  retryable: boolean;
  detail: string;
};

export type SubmitResult =
  | {
      ok: true;
      sourceId: string;
      /** True when this call created the `sources` row; false when it already existed. */
      created: boolean;
      feedUrl: string;
      detail: string;
    }
  | SubmitRefusal;

export type SubmitInput = {
  topicId: string;
  /** For the audit row and the source's name fallback only. Never stored as a topic. */
  topicLabel: string;
  terms: string[];
  /** The URL the reader typed. A site page or a feed; both are accepted. */
  url: string;
  fetcher?: FeedFetcher;
  now?: Date;
};

/**
 * A reader's URL for a subject, turned into a linked source or a stated refusal.
 *
 * Returns rather than throws, for the same reason the rest of this stage does:
 * the caller is a reader's save action or a console form, and neither has
 * anything useful to do with an exception.
 */
export async function submitSiteSource(db: Db, input: SubmitInput): Promise<SubmitResult> {
  const now = input.now ?? new Date();

  const canonical = canonicalUrl(input.url);
  if (canonical === null || !isPublicHttpUrl(canonical)) {
    return {
      ok: false,
      reason: "unusable-url",
      retryable: false,
      detail: "That is not a public http or https address.",
    };
  }

  const resolution = await resolveFeed(canonical, {
    ...(input.fetcher ? { fetcher: input.fetcher } : {}),
  });

  if (!resolution.ok) {
    if (resolution.retryable) {
      await queueCandidate(db, canonical, input.topicId, now);
      return {
        ok: false,
        reason: "transient",
        retryable: true,
        detail: `Could not read that address (${resolution.reason}). It will be tried again.`,
      };
    }
    return {
      ok: false,
      reason: "no-feed",
      retryable: false,
      detail:
        "That page has no RSS or Atom feed, and none at the usual addresses. " +
        "If the site publishes one, its feed URL will work here.",
    };
  }

  const relevant = passesRelevanceTripwire({
    terms: input.terms,
    candidateTitle: null,
    snippet: null,
    feedTitle: resolution.feed.title,
    itemTitles: resolution.feed.itemTitles,
  });

  if (!relevant) {
    return {
      ok: false,
      reason: "not-relevant",
      retryable: false,
      detail: "That feed does not mention this subject.",
    };
  }

  const registration = await registerDiscoveredSource(db, {
    topicId: input.topicId,
    feedUrl: resolution.feed.feedUrl,
    homepage: resolution.feed.homepage,
    name: resolution.feed.title ?? hostnameOf(resolution.feed.feedUrl),
    topicLabel: input.topicLabel,
  });

  if (!registration.ok) {
    // Ours, not theirs: the feed resolved and passed the tripwire, so the URL
    // is good and the next tick should try the write again.
    await queueCandidate(db, canonical, input.topicId, now);
    return {
      ok: false,
      reason: "storage",
      retryable: true,
      detail: `Could not add that source: ${registration.reason}`,
    };
  }

  return {
    ok: true,
    sourceId: registration.sourceId,
    created: registration.created,
    feedUrl: resolution.feed.feedUrl,
    detail: registration.created
      ? "Added as a new source for this subject."
      : "That feed is already collected; it is now linked to this subject.",
  };
}

/**
 * One candidate row, so the ordinary resolver pass can retry this URL.
 *
 * `ignoreDuplicates` is what stops a reader pressing the button five times from
 * becoming five rows: `source_candidates.url` is unique, and an existing row is
 * left exactly as it is, including its attempt count and its next attempt time.
 */
async function queueCandidate(db: Db, url: string, topicId: string, now: Date): Promise<void> {
  const { error } = await db.from("source_candidates").upsert(
    {
      url,
      domain: hostnameOf(url),
      title: null,
      first_topic_id: topicId,
      status: "discovered" as const,
      method: "reader" as const,
      next_attempt_at: now.toISOString(),
    },
    { onConflict: "url", ignoreDuplicates: true },
  );

  if (error) {
    console.warn(`discovery: queueing ${url} for a retry failed: ${error.message}`);
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
