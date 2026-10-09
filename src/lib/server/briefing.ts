import { createServerFn } from "@tanstack/react-start";
import { parseInput } from "@/lib/server/validate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { scoreRelatedEvent } from "@/lib/related-events";
import { rankEventTopics } from "@/lib/pipeline/topic-assign";
import { reasonFor } from "@/lib/pipeline/inclusion";
import { signedInOnly } from "./guard";
import { countOrThrow } from "@/lib/supabase/count";
import { backfill, WINDOW_HOURS } from "@/lib/pipeline/backfill";
import { nextSlot } from "@/lib/pipeline/schedule";
import { PLAN_LIMITS, STANDARD_DELIVERY_TIME, clipLabels } from "@/lib/plans";
import { defaultMonthKey, describeMonth, type HistoryMonth } from "@/lib/history-window";
import {
  digestInWindow,
  historyWindowStart,
  readHistoryDays,
  readHistoryMonths,
  storyVisible,
} from "./history";
import { asPercent, clockOf, importanceBand, type Story } from "@/lib/story";
import type { EvidenceUnit } from "@/lib/understand";
import { aiRateLimit } from "./rate-limit";
import type {
  Database,
  DigestStatus,
  PlanTier,
  SourceKind,
  SourcePref,
} from "@/lib/supabase/types";

/**
 * The reader's real matched events, and the call that fills them on day one.
 *
 * ---------------------------------------------------------------------------
 * Why the backfill is triggered from here rather than from a cron
 * ---------------------------------------------------------------------------
 *
 * Every other stage of the pipeline runs on a schedule, because every other
 * stage is about the corpus. This one is about a person who is looking at the
 * screen right now: they finished onboarding thirty seconds ago and the matcher
 * next fires at twenty-five past. The work is a single query over events that
 * were analysed for somebody else, so making them wait for a cron would be
 * waiting for nothing.
 *
 * ---------------------------------------------------------------------------
 * What stops this being an endpoint that spends money on demand
 * ---------------------------------------------------------------------------
 *
 * Nothing here takes a user id. `context.actor.id` comes from a verified access
 * token, so a caller can only ever backfill themselves — and `backfill()` itself
 * finalizes at most three relevant pending events using deterministic code.
 * The brakes are in the pipeline module rather than in this file on purpose:
 * they have to hold for the CLI and the Worker too, not only for the browser.
 *
 * ---------------------------------------------------------------------------
 * This is not the fixture dashboard. `loadHomeFeed` reads `digest_items` when a
 * briefing exists and `user_events` when it does not, and the story page reads
 * real `articles`. The sample notice comes down because nothing here is a fixture.
 */

/** One matched event, flattened for the dashboard. */
export type MatchedEvent = {
  eventId: string;
  title: string;
  whatHappened: string;
  /** 0..10, shared. The same number every reader sees. */
  importance: number;
  novelty: number;
  /** 0..∞, personal. Stage 5's ordering key for this reader. */
  relevance: number;
  matchedAt: string;
  /** Labels from `event_topics`, which is what the reader was matched on. */
  topics: string[];
  /** The outlets that reported it. */
  sources: string[];
};

export type Matches = {
  events: MatchedEvent[];
  /** Hours of corpus day one considers, so the empty state can say so. */
  windowHours: number;
};

/** Rows read per request. A dashboard page, not a corpus. */
const PAGE = 24;

/**
 * Everything this reader has matched, most relevant first.
 *
 * Ordered by `relevance` rather than `matched_at` because relevance is the
 * ordering the product promises — shared event importance, adjusted by how
 * many of *this* reader's interests the event touches. Sorting by arrival time
 * would be a feed, which is the thing being replaced.
 */
export const loadMatches = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<Matches> => {
    const { actor } = context;

    const { data: rows, error } = await actor.db
      .from("user_events")
      .select(
        "event_id, relevance, matched_at, events ( title, what_happened, importance, novelty )",
      )
      .eq("user_id", actor.id)
      .order("relevance", { ascending: false })
      .limit(PAGE);

    if (error) throw new Error(`reading your matches: ${error.message}`);

    const matched = (rows ?? []).flatMap((row) => {
      const event = row.events as {
        title?: string;
        what_happened?: string;
        importance?: number;
        novelty?: number;
      } | null;
      // A match whose event has gone is not an error and not a story.
      if (!event?.title) return [];
      return [
        {
          eventId: row.event_id,
          title: event.title,
          whatHappened: event.what_happened ?? "",
          importance: event.importance ?? 0,
          novelty: event.novelty ?? 0,
          relevance: row.relevance,
          matchedAt: row.matched_at,
          topics: [] as string[],
          sources: [] as string[],
        },
      ];
    });

    if (matched.length === 0) return { events: [], windowHours: WINDOW_HOURS };

    const ids = matched.map((m) => m.eventId);
    const [topics, sources] = await Promise.all([
      topicsFor(actor.db, ids),
      sourcesFor(actor.db, ids),
    ]);

    return {
      events: matched.map((m) => ({
        ...m,
        topics: topics.get(m.eventId) ?? [],
        sources: sources.get(m.eventId) ?? [],
      })),
      windowHours: WINDOW_HOURS,
    };
  });

type Db = SupabaseClient<Database>;

/** Topic labels per event, in one round trip rather than one per card. */
async function topicsFor(db: Db, eventIds: string[]): Promise<Map<string, string[]>> {
  const { data, error } = await db
    .from("event_topics")
    .select("event_id, topics ( label )")
    .in("event_id", eventIds);

  if (error) throw new Error(`reading event topics: ${error.message}`);

  const out = new Map<string, string[]>();
  for (const row of data ?? []) {
    const label = (row.topics as { label?: string } | null)?.label;
    if (!label) continue;
    out.set(row.event_id, [...(out.get(row.event_id) ?? []), label]);
  }
  return out;
}

/** Outlet names per event, de-duplicated: one outlet can report a story twice. */
async function sourcesFor(db: Db, eventIds: string[]): Promise<Map<string, string[]>> {
  const { data, error } = await db
    .from("articles")
    .select("event_id, sources ( name )")
    .in("event_id", eventIds);

  if (error) throw new Error(`reading sources: ${error.message}`);

  const out = new Map<string, string[]>();
  for (const row of data ?? []) {
    const name = (row.sources as { name?: string } | null)?.name;
    if (!row.event_id || !name) continue;
    const seen = out.get(row.event_id) ?? [];
    if (!seen.includes(name)) out.set(row.event_id, [...seen, name]);
  }
  return out;
}

export type FirstBriefing = {
  outcome: string;
  matched: number;
  analysed: number;
  detail: string;
};

/**
 * Runs day one for the caller.
 *
 * Called when onboarding finishes and once more the first time a signed-in
 * reader's answers reach the account — a visitor can complete onboarding before
 * signing up, in which case the topics only exist server-side after that first
 * authenticated sync, and matching them before it would match an empty list.
 *
 * Safe to call repeatedly: matching is idempotent and finalization uses database claims.
 */
export const startFirstBriefing = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<FirstBriefing> => {
    const report = await backfill(context.actor.db, { userId: context.actor.id });

    // Keep finalization visible even if the reader navigates away.
    if (report.analysed > 0) {
      console.log(`backfill: ${report.userId} analysed ${report.analysed} for ${report.tokens}`);
    }

    return {
      outcome: report.outcome,
      matched: report.matched,
      analysed: report.analysed,
      detail: report.detail,
    };
  });

/* ---------------------------------------------------------------------- */
/* Home, briefing, history, story                                          */
/* ---------------------------------------------------------------------- */

export type HomeFeed = {
  stories: Story[];
  /** `digest` when today's briefing exists, `matches` when only user_events do. */
  source: "digest" | "matches" | "empty";
  digestStatus: DigestStatus | null;
  scheduledFor: string | null;
  nextAt: string | null;
  windowHours: number;
};

export const loadHomeFeed = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<HomeFeed> => {
    const { actor } = context;
    const nextAt = await nextSend(actor.db, actor.id);

    const latest = await latestDigest(actor.db, actor.id);
    if (latest && (latest.status === "ready" || latest.status === "sent")) {
      const stories = await storiesFromDigest(actor.db, latest.digest_id);
      return {
        stories,
        source: "digest",
        digestStatus: latest.status,
        scheduledFor: latest.scheduled_for,
        nextAt,
        windowHours: WINDOW_HOURS,
      };
    }

    if (latest?.status === "skipped") {
      // A skipped briefing is a verdict about the moment it ran, not a
      // standing claim that nothing exists. Matching runs every ~15 minutes
      // and the next briefing slot can be hours away, so without this check
      // a story matched one minute after a skipped briefing is invisible
      // until that next slot -- the reader's homepage says "nothing" while
      // `user_events` already holds it.
      const since = await loadMatchedStories(actor.db, actor.id, PAGE, latest.scheduled_for);
      if (since.length > 0) {
        return {
          stories: since,
          source: "matches",
          digestStatus: latest.status,
          scheduledFor: latest.scheduled_for,
          nextAt,
          windowHours: WINDOW_HOURS,
        };
      }
      return {
        stories: [],
        source: "empty",
        digestStatus: "skipped",
        scheduledFor: latest.scheduled_for,
        nextAt,
        windowHours: WINDOW_HOURS,
      };
    }

    const matches = await loadMatchedStories(actor.db, actor.id, PAGE);
    return {
      stories: matches,
      source: matches.length > 0 ? "matches" : "empty",
      digestStatus: latest?.status ?? null,
      scheduledFor: latest?.scheduled_for ?? null,
      nextAt,
      windowHours: WINDOW_HOURS,
    };
  });

export type HistoryDay = {
  digestId: string;
  iso: string;
  date: string;
  weekday: string;
  count: number;
  headline: string;
  skipped: boolean;
};

export type HistoryFeed = {
  /** Days of the one month in `month`, never the whole retention window. */
  days: HistoryDay[];
  /** Every calendar month overlapping the current plan window. Newest first. */
  months: HistoryMonth[];
  /** Which month `days` belongs to, or null when there is no history at all. */
  month: string | null;
  retentionDays: number;
  retention: string;
  plan: PlanTier;
  /** Set only while a downgrade's 30-day grace is still running. */
  graceUntil: string | null;
};

/**
 * One month of history, plus the shape of the whole archive.
 *
 * ---------------------------------------------------------------------------
 * Why a month at a time
 * ---------------------------------------------------------------------------
 *
 * The previous version asked for `retentionDays + 5` rows, which is 370 for an
 * Omni reader: a year of briefings and their headlines fetched on every visit
 * so that the page could render one long scroll of them. Months are the
 * navigation now, and only the selected one is read.
 *
 * ---------------------------------------------------------------------------
 * Where each part of the answer comes from
 * ---------------------------------------------------------------------------
 *
 * The window is `history_window_start()` — the same function the digests policy
 * calls, asked for here because a server function runs with the service-role
 * client and RLS does not apply to it (see `./history`).
 *
 * The month list uses that same boundary to generate each calendar month the
 * plan reaches, including months with no briefings. It returns only bounds and
 * counts from inside the window; retained rows from a previous plan stay out
 * of both the selector and this response.
 *
 * Month bounds arrive already resolved in the reader's own timezone, so the
 * range scan below needs no date arithmetic and cannot disagree with the month
 * heading it is rendered under.
 */
export const loadHistory = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    parseInput(
      z.object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        digestId: z.string().uuid().optional(),
      }),
      input ?? {},
    ),
  )
  .handler(async ({ context, data }): Promise<HistoryFeed> => {
    const { actor } = context;
    const [{ plan, graceUntil }, windowStart, zone] = await Promise.all([
      planStateOf(actor.db, actor.id),
      historyWindowStart(actor.db, actor.id),
      timezoneOf(actor.db, actor.id),
    ]);
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.uno;

    const bounds = await readHistoryMonths(actor.db, actor.id, windowStart);
    const now = new Date();
    const months = bounds.map((facts) => describeMonth(facts, now));

    // Opening a specific briefing (History → "Open briefing") names the digest
    // rather than the month, and an out-of-window id resolves to nothing here
    // exactly as it does in `loadDigestStories`.
    let wanted = data.month ?? null;
    if (!wanted && data.digestId) {
      const digest = await digestInWindow(actor.db, actor.id, data.digestId, windowStart);
      const at = digest ? Date.parse(digest.scheduled_for) : NaN;
      if (!Number.isNaN(at)) {
        wanted =
          bounds.find((b) => at >= Date.parse(b.startsAt) && at < Date.parse(b.endsAt))?.monthKey ??
          null;
      }
    }

    const selected =
      bounds.find((b) => b.monthKey === wanted) ??
      bounds.find((b) => b.monthKey === defaultMonthKey(months)) ??
      null;

    const rows = selected
      ? await readHistoryDays(actor.db, actor.id, {
          startsAt: selected.startsAt,
          endsAt: selected.endsAt,
          windowStart,
        })
      : [];

    const headlines = await headlinesFor(
      actor.db,
      rows.filter((r) => r.item_count > 0).map((r) => r.digest_id),
    );

    const days: HistoryDay[] = rows.map((row) => {
      const at = new Date(row.scheduled_for);
      return {
        digestId: row.digest_id,
        iso: row.scheduled_for,
        date: at.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: zone }),
        weekday: at.toLocaleDateString(undefined, { weekday: "long", timeZone: zone }),
        count: row.item_count,
        headline: headlines.get(row.digest_id) ?? "Nothing important for your nyuz",
        skipped: row.status === "skipped" || row.item_count === 0,
      };
    });

    return {
      days,
      months,
      month: selected?.monthKey ?? null,
      retentionDays: limits.retentionDays,
      retention: limits.retention,
      plan,
      graceUntil,
    };
  });

export const loadDigestStories = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    parseInput(z.object({ digestId: z.string().uuid().optional() }), input ?? {}),
  )
  .handler(async ({ context, data }): Promise<Story[]> => {
    const { actor } = context;
    if (data.digestId) {
      // Owning the digest is not enough. A reader who has dropped to Uno still
      // owns every briefing Plura sent them, and this is the route their old
      // bookmarks and back button go through.
      const windowStart = await historyWindowStart(actor.db, actor.id);
      const row = await digestInWindow(actor.db, actor.id, data.digestId, windowStart);
      if (!row) return [];
      return storiesFromDigest(actor.db, row.digest_id);
    }
    const latest = await latestDigest(actor.db, actor.id);
    if (!latest || latest.item_count === 0) return [];
    return storiesFromDigest(actor.db, latest.digest_id);
  });

export const loadSavedStories = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<Story[]> => {
    const { data, error } = await context.actor.db
      .from("saved_stories")
      .select("event_id")
      .eq("user_id", context.actor.id)
      .order("saved_at", { ascending: false });
    if (error) throw new Error(`reading saved stories: ${error.message}`);
    const ids = (data ?? []).map((r) => r.event_id);
    return storiesFromEventIds(context.actor.db, context.actor.id, ids);
  });

export const searchStories = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) => parseInput(z.object({ q: z.string().max(120) }), input))
  .handler(async ({ context, data }): Promise<Story[]> => {
    const term = data.q.trim();
    if (term.length < 2) return [];
    // Search is a view of the archive, so it ends where the archive ends.
    // Unbounded, it was the widest of the three ways round the window: no id to
    // guess, no link to keep — just a common word and every match ever made.
    const windowStart = await historyWindowStart(context.actor.db, context.actor.id);
    const stories = await loadMatchedStories(context.actor.db, context.actor.id, 80, windowStart);
    const needle = term.toLowerCase();
    return stories.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        s.org.toLowerCase().includes(needle) ||
        s.what.toLowerCase().includes(needle) ||
        s.topics.some((t) => t.toLowerCase().includes(needle)),
    );
  });

const RELATED_EVENTS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** Topics bound the candidate lookup; semantic anchors decide acceptance. */
async function relatedEventsFor(
  db: Db,
  eventId: string,
  beforeIso: string,
  story: Story,
): Promise<NonNullable<Story["relatedEvents"]>> {
  const own = await db.from("event_topics").select("topic_id").eq("event_id", eventId);
  const topicIds = [...new Set((own.data ?? []).map((t) => t.topic_id))];
  if (own.error || topicIds.length === 0) return [];

  const overlap = await db
    .from("event_topics")
    .select("event_id")
    .in("topic_id", topicIds)
    .neq("event_id", eventId)
    .limit(300);
  if (overlap.error) return [];

  const counts = new Map<string, number>();
  for (const row of overlap.data ?? [])
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  if (counts.size === 0) return [];

  const cutoff = new Date(new Date(beforeIso).getTime() - RELATED_EVENTS_WINDOW_MS).toISOString();
  const candidates = await db
    .from("events")
    .select("id, title, what_happened, first_seen_at, status")
    .in("id", [...counts.keys()].slice(0, 100))
    .eq("status", "complete")
    .gte("first_seen_at", cutoff)
    .lt("first_seen_at", beforeIso);
  if (candidates.error) return [];

  return candidates.data
    .map((e) => ({
      event: e,
      score: scoreRelatedEvent(
        { title: story.title, summary: story.what, publishedAt: beforeIso },
        { title: e.title, summary: e.what_happened, publishedAt: e.first_seen_at },
        counts.get(e.id) ?? 0,
      ),
    }))
    .filter((e) => e.score.accepted)
    .sort((a, b) => b.score.finalScore - a.score.finalScore || a.event.id.localeCompare(b.event.id))
    .slice(0, 2)
    .map(({ event: e }) => ({
      id: e.id,
      title: e.title,
      summary: e.what_happened,
      publishedAt: e.first_seen_at,
    }));
}

/** Attach grounded prior-event background to the deterministic reader. */
async function withRelatedEvents(db: Db, story: Story): Promise<Story> {
  const relatedEvents = await relatedEventsFor(db, story.id, story.publishedAt, story);
  return relatedEvents.length ? { ...story, relatedEvents } : story;
}

export const loadStory = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    parseInput(
      z.object({
        id: z.string().min(1).max(80),
      }),
      input,
    ),
  )
  .handler(async ({ context, data }): Promise<Story | null> => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)) {
      return null;
    }
    // A uuid in the address bar is the last way into expired personal history:
    // the digest is gated, search is gated, and this used to hydrate any event
    // in the corpus for anyone who asked. Saved stories are the deliberate
    // exception — a bookmark outlives the window.
    const { actor } = context;
    const windowStart = await historyWindowStart(actor.db, actor.id);
    if (!(await storyVisible(actor.db, actor.id, data.id, windowStart))) return null;

    const stories = await storiesFromEventIds(actor.db, actor.id, [data.id]);
    const story = stories[0] ?? null;
    return story ? await withRelatedEvents(actor.db, story) : null;
  });

export type AskResult =
  | { ok: true; answer: string }
  | {
      ok: false;
      reason:
        | "disabled"
        | "not-found"
        | "empty"
        | "failed"
        | "plan"
        | "quota"
        | "cooldown"
        | "off-topic"
        | "at-capacity";
      detail: string;
    };

/**
 * Story Ask is not part of Nyuz V1.
 *
 * The endpoint is kept, and kept returning a well-formed result, because the
 * story page still imports it and a reader mid-session should get a clean
 * answer rather than a 404. What is gone is everything behind it: the plan
 * lookup, the quota and cooldown ledger, the coverage prompt, and the
 * `completeRouted` call that made this the only per-reader, per-question model
 * call in the product.
 *
 * Deleted rather than left behind `ask_nyuz_enabled`, because a dormant paid
 * path is one console toggle away from spending again and nothing in V1 should
 * be able to reach it. `ask_cache` (0062) and the historical ledger rows are
 * untouched — no data is dropped, only the ability to spend.
 */
export const askStory = createServerFn({ method: "POST" })
  .middleware([aiRateLimit])
  .validator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        question: z.string().trim().min(4).max(400),
      })
      .parse(input),
  )
  .handler(async (): Promise<AskResult> => {
    return {
      ok: false,
      reason: "disabled",
      detail: "Ask is not part of this version of nyuz.",
    };
  });

export type WatchedSource = {
  id: string;
  name: string;
  kind: SourceKind;
  homepage: string | null;
  pref: SourcePref;
  /** False only when a downgrade preserved a priority beyond the new plan cap. */
  priorityActive: boolean;
};

export type SourceGroup = { group: string; items: WatchedSource[] };

const KIND_LABEL: Record<SourceKind, string> = {
  company_blog: "Official company blogs",
  news: "News sites",
  rss: "RSS",
  github: "GitHub",
  research: "Research",
  product: "Product announcements",
  other: "Other",
};

/**
 * The reader's source page.
 *
 * This used to be `select id, name, kind, homepage from sources where active`
 * with no limit — every reader pulled the entire global table on every visit.
 * Two things were wrong with that, and only one of them was performance.
 *
 * `sources` became reader-writable in 0030: a feed one person adds is a row in
 * the same global table everyone reads. So the unbounded select showed every
 * account every other account's private sources. 0039 adds `listed` and
 * replaces the `using (true)` policy; this function is the application half of
 * the same fix, and it matters independently because `actor.db` holds the
 * service-role key and therefore bypasses RLS entirely.
 *
 * What a reader now gets: catalogue sources (`listed`) that cover a subject
 * they actually follow, through `source_topics`, plus every source they follow
 * themselves regardless of topic — they asked for those by name, so a topic
 * filter has no business hiding them. Bounded and paged in SQL, so the page
 * cost does not grow with the size of the catalogue.
 */
export const loadWatchedSources = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    parseInput(
      z.object({
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      }),
      input ?? {},
    ),
  )
  .handler(async ({ context, data }): Promise<SourceGroup[]> => {
    const { actor } = context;
    const [{ data: rows, error }, { data: prefs, error: prefError }, { data: subscription }] =
      await Promise.all([
        actor.db.rpc("reader_sources", {
          p_user_id: actor.id,
          p_limit: data.limit,
          p_offset: data.offset,
        }),
        actor.db
          .from("user_source_prefs")
          .select("source_id, pref, created_at")
          .eq("user_id", actor.id),
        actor.db.from("subscriptions").select("plan").eq("user_id", actor.id).maybeSingle(),
      ]);
    if (error) throw new Error(`reading sources: ${error.message}`);
    if (prefError) throw new Error(`reading source prefs: ${prefError.message}`);

    return groupForReader(rows ?? [], prefs ?? [], subscription?.plan ?? "uno");
  });

/**
 * Explicit search, for finding a source you do not already have.
 *
 * Deliberately wider than the list above: the whole catalogue rather than only
 * the subjects already followed, because somebody typing a publication's name
 * is looking for something outside what they have. Never wider than the
 * catalogue plus their own follows — the bound that matters is unchanged.
 */
export const searchSources = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .validator((input: unknown) => parseInput(z.object({ q: z.string().max(120) }), input ?? {}))
  .handler(async ({ context, data }): Promise<SourceGroup[]> => {
    const { actor } = context;
    const term = data.q.trim();
    if (term.length < 2) return [];

    const [{ data: rows, error }, { data: prefs }, { data: subscription }] = await Promise.all([
      actor.db.rpc("search_reader_sources", { p_user_id: actor.id, p_query: term, p_limit: 40 }),
      actor.db
        .from("user_source_prefs")
        .select("source_id, pref, created_at")
        .eq("user_id", actor.id),
      actor.db.from("subscriptions").select("plan").eq("user_id", actor.id).maybeSingle(),
    ]);
    if (error) throw new Error(`searching sources: ${error.message}`);

    return groupForReader(rows ?? [], prefs ?? [], subscription?.plan ?? "uno");
  });

/**
 * Shared shaping for both of the above.
 *
 * The priority-cap arithmetic is the fiddly part and duplicating it would let
 * the list and the search disagree about which of a reader's priorities are
 * live — the same figure the billing page quotes.
 */
function groupForReader(
  rows: { id: string; name: string; kind: SourceKind; homepage: string | null }[],
  prefs: { source_id: string; pref: SourcePref; created_at: string }[],
  plan: PlanTier,
): SourceGroup[] {
  const prefOf = new Map(prefs.map((p) => [p.source_id, p.pref] as const));
  const priorityCap = PLAN_LIMITS[plan]?.prioritySources ?? PLAN_LIMITS.uno.prioritySources;
  const activePriorities = new Set(
    clipLabels(
      prefs
        .filter((p) => p.pref === "priority")
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      priorityCap,
    ).map((p) => p.source_id),
  );

  const grouped = new Map<SourceKind, WatchedSource[]>();
  for (const row of rows) {
    const item: WatchedSource = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      homepage: row.homepage,
      pref: prefOf.get(row.id) ?? "normal",
      priorityActive: activePriorities.has(row.id),
    };
    grouped.set(row.kind, [...(grouped.get(row.kind) ?? []), item]);
  }

  return (Object.keys(KIND_LABEL) as SourceKind[])
    .map((kind) => ({ group: KIND_LABEL[kind], items: grouped.get(kind) ?? [] }))
    .filter((g) => g.items.length > 0);
}

export const setSourcePref = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    z
      .object({ sourceId: z.string().uuid(), pref: z.enum(["normal", "priority", "muted"]) })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: boolean; reason?: "plan" }> => {
    if (data.pref === "priority") {
      const { data: existing, error: readError } = await context.actor.db
        .from("user_source_prefs")
        .select("pref")
        .eq("user_id", context.actor.id)
        .eq("source_id", data.sourceId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (existing?.pref === "priority") return { ok: true };
      const plan = await planOf(context.actor.db, context.actor.id);
      const cap = PLAN_LIMITS[plan]?.prioritySources ?? PLAN_LIMITS.uno.prioritySources;
      if (Number.isFinite(cap)) {
        const { count, error } = await context.actor.db
          .from("user_source_prefs")
          .select("source_id", { count: "exact", head: true })
          .eq("user_id", context.actor.id)
          .eq("pref", "priority");
        // The database also refuses an over-cap save by raising
        // `priority source cap exceeded`, so this is a fast path rather than
        // the guard. It still may not read an unreadable count as room to
        // spare; if this throws, the upsert below is still the authority.
        if (countOrThrow("priority sources", { count, error }) >= cap) {
          return { ok: false, reason: "plan" };
        }
      }
    }
    const { error } = await context.actor.db.from("user_source_prefs").upsert({
      user_id: context.actor.id,
      source_id: data.sourceId,
      pref: data.pref,
    });
    if (error?.message.includes("priority source cap exceeded")) {
      return { ok: false, reason: "plan" };
    }
    if (error) throw new Error(`saving source preference: ${error.message}`);
    return { ok: true };
  });

/* ---------------------------------------------------------------------- */
/* Mapping                                                                 */
/* ---------------------------------------------------------------------- */

type DigestHead = {
  digest_id: string;
  scheduled_for: string;
  status: DigestStatus;
  item_count: number;
};

async function latestDigest(db: Db, userId: string): Promise<DigestHead | null> {
  const { data, error } = await db
    .from("digests")
    .select("digest_id, scheduled_for, status, item_count")
    .eq("user_id", userId)
    .eq("kind", "briefing")
    .in("status", ["ready", "sent", "skipped", "generating", "failed"])
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`reading latest digest: ${error.message}`);
  return data;
}

async function nextSend(db: Db, userId: string): Promise<string | null> {
  const { data } = await db
    .from("notification_preferences")
    .select("send_at, timezone, days, frequency, paused")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || data.paused) return null;
  const plan = await planOf(db, userId);
  const slot = nextSlot(
    {
      sendAt: PLAN_LIMITS[plan].customDeliveryTime ? data.send_at : STANDARD_DELIVERY_TIME,
      timezone: data.timezone,
      days: data.days,
      frequency: "daily",
    },
    new Date(),
  );
  return slot?.toISOString() ?? null;
}

async function planOf(db: Db, userId: string): Promise<PlanTier> {
  const { data } = await db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.plan ?? "uno";
}

/**
 * Plan plus the downgrade grace deadline, for the History page's copy.
 *
 * Only the deadline is exposed, never `history_grace_days`: the page needs to
 * say "until 7 October", and how far back the rows physically reach is a purge
 * detail rather than an entitlement the reader has.
 */
async function planStateOf(
  db: Db,
  userId: string,
): Promise<{ plan: PlanTier; graceUntil: string | null }> {
  const { data } = await db
    .from("subscriptions")
    .select("plan, history_grace_until")
    .eq("user_id", userId)
    .maybeSingle();
  const until = data?.history_grace_until ?? null;
  const running = until !== null && Date.parse(until) > Date.now();
  return { plan: data?.plan ?? "uno", graceUntil: running ? until : null };
}

/**
 * The reader's own timezone, for day labels.
 *
 * `history_months` buckets months in this zone, so formatting the days in the
 * server's zone instead would put "September 1" under an August heading for
 * anyone west of UTC. An unrecognised zone falls back rather than throwing —
 * a stale IANA name should cost a reader correct labels, not their archive.
 */
async function timezoneOf(db: Db, userId: string): Promise<string> {
  const { data } = await db
    .from("notification_preferences")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const zone = data?.timezone?.trim();
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "UTC";
  }
}

async function headlinesFor(db: Db, digestIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (digestIds.length === 0) return out;
  const { data, error } = await db
    .from("digest_items")
    .select("digest_id, position, events ( title )")
    .in("digest_id", digestIds)
    .eq("position", 0);
  if (error) throw new Error(`reading digest headlines: ${error.message}`);
  for (const row of data ?? []) {
    const title = (row.events as { title?: string } | null)?.title;
    if (title) out.set(row.digest_id, title);
  }
  return out;
}

async function storiesFromDigest(db: Db, digestId: string): Promise<Story[]> {
  const { data, error } = await db
    .from("digest_items")
    .select("event_id, position, why_it_matters")
    .eq("digest_id", digestId)
    .order("position", { ascending: true });
  if (error) throw new Error(`reading digest_items: ${error.message}`);
  const items = data ?? [];
  const why = new Map(items.map((i) => [i.event_id, i.why_it_matters] as const));
  const order = items.map((i) => i.event_id);
  const stories = await hydrateEvents(db, order);
  // Digests archive what was sent, so a stored `why_it_matters` is the truth
  // for what the email said — until it is a line the ladder has since retired
  // (the follow fallback, the subject line), which `whyLinesFor` recomputes
  // from the event's own fields alongside the empty era before impacts. The
  // reader's own personalization — computed the same way the home feed
  // computes it, from their real follow graph — rides as its own block where
  // the ladder has nothing to say, and where even that is absent the line is
  // omitted (the preview component renders nothing for an empty why) rather
  // than printed empty.
  const userId = await digestReaderOf(db, digestId);
  const [personalization, lines] = await Promise.all([
    userId
      ? personalizationFor(db, userId, order)
      : new Map<string, { heading: string; explanation: string }>(),
    whyLinesFor(db, stories, why),
  ]);
  return stories.map((s) =>
    withWhyAndProvenance(s, lines.get(s.id) ?? "", personalization.get(s.id)),
  );
}

/**
 * Significance and provenance, kept apart — the arbiter's ruling of 2026-10-09.
 *
 * `why` carries what the briefing said about the story and nothing else: an
 * empty significance slot stays empty. The reader's own follow graph rides as
 * `personalization`, which the card prints under its own heading. Folding the
 * follow explanation into `why` when the ladder was silent put provenance under
 * the significance heading the moment the card split the two apart — found live
 * on the 2026-10-09 sample.
 *
 * A stored line that *is* the follow explanation — every briefing generated
 * before the follow rung was deleted on 2026-10-08 has one — is provenance too,
 * whatever column it was written to. It moves to `personalization` and leaves
 * the significance slot silent, so the heading claim is true on old briefings
 * as well as new ones. Equality is exact after case and punctuation collapse:
 * the ladder's rungs state figures, changes and coverage counts, and none of
 * them can collide with "You follow AI." by accident.
 */
export function withWhyAndProvenance(
  story: Story,
  line: string,
  fallback: { heading: string; explanation: string } | undefined,
): Story {
  const trimmed = line.trim();
  const flatten = (value: string) => value.replace(/[^a-z]/gi, "").toLowerCase();
  const isProvenance = fallback !== undefined && flatten(fallback.explanation) === flatten(trimmed);
  if (trimmed !== "" && !isProvenance) {
    return { ...story, why: trimmed, ...(fallback ? { personalization: fallback } : {}) };
  }
  if (fallback) return { ...story, why: "", personalization: fallback };
  // No follow graph to compare against: the line is all we know, so it stays.
  return { ...story, why: trimmed };
}

/** Whose digest this is — one reader, by construction. */
async function digestReaderOf(db: Db, digestId: string): Promise<string | null> {
  const { data } = await db
    .from("digests")
    .select("user_id")
    .eq("digest_id", digestId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/**
 * This reader's matches, most relevant first.
 *
 * `since` is optional because the home feed is a view of now — today's matches,
 * bounded by the pipeline rather than by a plan — while search is a view of the
 * archive and must stop where the archive stops. Passing the window in rather
 * than deriving it here keeps the boundary a single value fetched once per
 * request, from the same function RLS uses.
 */
async function loadMatchedStories(
  db: Db,
  userId: string,
  limit: number,
  since?: string,
): Promise<Story[]> {
  let query = db
    .from("user_events")
    .select("event_id, relevance, matched_at")
    .eq("user_id", userId);
  if (since) query = query.gte("matched_at", since);
  const { data, error } = await query.order("relevance", { ascending: false }).limit(limit);
  if (error) throw new Error(`reading user_events: ${error.message}`);
  const rows = data ?? [];
  const stories = await hydrateEvents(
    db,
    rows.map((r) => r.event_id),
  );
  const relevance = new Map(rows.map((r) => [r.event_id, r.relevance] as const));
  // The occurrence clock, not `matched_at`, and not the analysis write time:
  // every list and the story page have to print the same moment for the same
  // story. A card that says 01:00 over a story page that says 04:03 looks like
  // two different stories, and neither of those was when it happened.
  // `hydrateEvents` already stamps `publishedAt` from `first_seen_at`, which is
  // what `MatchRow.eventAt` calls the material occurrence clock — this used to
  // overwrite it with `matched_at`, which diverges from the news by exactly the
  // amount the pipeline was behind.
  return stories.map((s) => ({
    ...s,
    score: { ...s.score, relevance: asPercent(relevance.get(s.id) ?? 0) },
  }));
}

async function storiesFromEventIds(db: Db, userId: string, eventIds: string[]): Promise<Story[]> {
  if (eventIds.length === 0) return [];
  const [stories, why, personalization, relevance] = await Promise.all([
    hydrateEvents(db, eventIds),
    whyFor(db, userId, eventIds),
    personalizationFor(db, userId, eventIds),
    matchRelevanceFor(db, userId, eventIds),
  ]);
  const lines = await whyLinesFor(db, stories, why);
  return stories.map((s) => {
    // `hydrateEvents` has no reader, so it leaves relevance equal to importance.
    // This path does, and the story page's own score panel was therefore showing
    // the event's importance twice -- 0% on a story the reader had been matched
    // to and could open. The real match relevance, where there is one, wins.
    const matched = relevance.get(s.id);
    const scored =
      matched === undefined ? s : { ...s, score: { ...s.score, relevance: asPercent(matched) } };
    return withWhyAndProvenance(scored, lines.get(scored.id) ?? "", personalization.get(scored.id));
  });
}

/**
 * The reader's own match relevance per event, 0-10, or absent when the reader
 * never matched it (a story opened from Saved, or one that predates matching).
 */
async function matchRelevanceFor(
  db: Db,
  userId: string,
  eventIds: string[],
): Promise<Map<string, number>> {
  const { data } = await db
    .from("user_events")
    .select("event_id, relevance")
    .eq("user_id", userId)
    .in("event_id", eventIds);
  return new Map((data ?? []).map((row) => [row.event_id, row.relevance] as const));
}

async function whyFor(db: Db, userId: string, eventIds: string[]): Promise<Map<string, string>> {
  const { data } = await db
    .from("digest_items")
    .select("event_id, why_it_matters, digests ( user_id, scheduled_for )")
    .in("event_id", eventIds);
  const why = new Map<string, string>();
  for (const row of data ?? []) {
    const digest = row.digests as { user_id?: string } | null;
    if (digest?.user_id !== userId) continue;
    if (!why.has(row.event_id)) why.set(row.event_id, row.why_it_matters);
  }
  return why;
}

/**
 * The archived shapes the ladder no longer writes: the follow fallback, the
 * subject line in both its eras ("This is a funding story from The Register."
 * and "A funding and cybersecurity story from The Register, in your AI and
 * OpenAI topics."). One of those was every card's line in the era the arbiter
 * scored, so an archive holding one is recomputed rather than echoed. Anchored
 * tightly enough not to touch a stored impact that merely starts with
 * "This is a ..." — the subject line ends in "story" (optionally with an
 * outlet), while a sentence keeps going after the word.
 */
const RETIRED_LINE =
  /^(?:you follow\b|this is an?\b[^.]*\bstory(?: from [^.]*)?\.?$)|,\s*in your\b[^.]*\btopics?\b/iu;

/**
 * The inclusion ladder (inclusion.ts), recomputed at read time.
 *
 * A digest archives the line it sent, and for a briefing generated by the
 * current ladder the archive already *is* the ladder's output — so a stored
 * line is kept verbatim unless it is one the ladder has since retired (see
 * `RETIRED_LINE`). Those stories are recomputed from the event's own stored
 * fields, so a reader opening an older briefing sees story-specific lines —
 * or nothing — without the digest being regenerated.
 *
 * No query here throws, and no rung is load-bearing: `event_impacts` may be
 * unreadable from a browser session, and an event with no impact, no
 * before/after and no figure simply has no line. A missing input costs one
 * line, never the page — the caller then falls back to `personalizationFor`,
 * the reader's own follow graph under its own heading.
 */
async function whyLinesFor(
  db: Db,
  stories: Story[],
  archived: Map<string, string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (stories.length === 0) return out;
  const ids = stories.map((s) => s.id);
  const impacts = await db
    .from("event_impacts")
    .select("event_id, text")
    .in("event_id", ids)
    .eq("status", "complete");
  const impactOf = new Map(
    (impacts.data ?? []).map((row) => [row.event_id, row.text ?? null] as const),
  );

  for (const s of stories) {
    const stored = (archived.get(s.id) ?? "").trim();
    // Archived text the ladder still writes — an impact, a change, an
    // after-state, a figure, a coverage count — is the ladder's own rung
    // frozen at send time, and is what the email said, so it wins verbatim.
    if (stored !== "" && !RETIRED_LINE.test(stored)) {
      out.set(s.id, stored);
      continue;
    }
    // The story's own article-page evidence, already on the hydrated story
    // because the Read page renders it — the consequence rung reads the same
    // material the article does, so the line and the body agree about what the
    // source says. No extra query: absence costs a rung, never the page.
    const evidence = s.sourceList.flatMap(
      (source) => source.enrichedEvidence?.map((unit) => unit.text) ?? [],
    );
    const line = reasonFor({
      storedImpact: impactOf.get(s.id) ?? null,
      beforeState: s.before || null,
      afterState: s.after || null,
      sourceCount: s.sources,
      evidence,
      title: s.title,
      whatHappened: s.what,
    }).text;
    // Never below nothing: an archived follow line is not a significance
    // line, and the card renders the reader's follow explanation itself
    // under its own heading. A blank here is the honest answer.
    out.set(s.id, line);
  }
  return out;
}

/**
 * "Why you're seeing this", computed, never generated.
 *
 * Two things both have to be true: the event actually reached this reader
 * through their own subscriptions (a `user_events` row exists -- a reader who
 * found this by search or a shared link gets nothing here, correctly), and it
 * shares a topic label with what they follow. No LLM call: `user_topics` and
 * `event_topics` both store the reader-facing label directly, so this is a
 * plain intersection.
 */
async function personalizationFor(
  db: Db,
  userId: string,
  eventIds: string[],
): Promise<Map<string, { heading: string; explanation: string }>> {
  const out = new Map<string, { heading: string; explanation: string }>();
  const [matches, followed, eventLabels] = await Promise.all([
    db.from("user_events").select("event_id").eq("user_id", userId).in("event_id", eventIds),
    db.from("user_topics").select("topics ( label )").eq("user_id", userId),
    topicsFor(db, eventIds),
  ]);

  const matchedIds = new Set((matches.data ?? []).map((row) => row.event_id));
  if (matchedIds.size === 0) return out;

  const followedLabels = new Set(
    (followed.data ?? [])
      .map((row) => (row.topics as { label?: string } | null)?.label)
      .filter((label): label is string => Boolean(label))
      .map((label) => label.toLowerCase()),
  );
  if (followedLabels.size === 0) return out;

  for (const eventId of matchedIds) {
    const labels = eventLabels.get(eventId) ?? [];
    const overlap = labels.filter((label) => followedLabels.has(label.toLowerCase()));
    if (overlap.length === 0) continue;
    out.set(eventId, {
      heading: "Why you're seeing this",
      explanation: `You follow ${joinLabels(overlap)}.`,
    });
  }
  return out;
}

function joinLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

type EventBits = {
  publisher_count: number;
  id: string;
  title: string;
  what_happened: string;
  importance: number;
  novelty: number;
  before_state: string | null;
  after_state: string | null;
  first_seen_at: string;
  last_updated_at: string;
  analysed_at: string | null;
};

async function hydrateEvents(db: Db, eventIds: string[]): Promise<Story[]> {
  if (eventIds.length === 0) return [];

  const { data: events, error } = await db
    .from("events")
    .select(
      "id, title, what_happened, importance, novelty, before_state, after_state, first_seen_at, last_updated_at, analysed_at, publisher_count",
    )
    .in("id", eventIds);
  if (error) throw new Error(`reading events: ${error.message}`);

  const byId = new Map(((events ?? []) as EventBits[]).map((e) => [e.id, e] as const));
  const [topics, articles] = await Promise.all([
    topicsFor(db, eventIds),
    articlesFor(db, eventIds),
  ]);

  return eventIds.flatMap((id) => {
    const event = byId.get(id);
    if (!event) return [];
    const coverage = articles.get(id) ?? [];
    const publishedAt = event.first_seen_at;
    // Hydration serves feed cards and the story shell; it is not the article
    // composition pass. Re-running full evidence selection for every card made
    // a 25-story feed spend CPU ranking all entities in every source excerpt.
    // The source-based event summary is enough to order topic labels here;
    // detailed evidence selection belongs to article composition.
    const lead = event.what_happened ?? "";
    return [
      {
        id: event.id,
        org: coverage[0]?.name ?? topics.get(id)?.[0] ?? "Unattributed",
        title: event.title,
        what: event.what_happened,
        why: "",
        importance: importanceBand(event.importance),
        score: {
          relevance: asPercent(event.importance),
          importance: asPercent(event.importance),
          novelty: asPercent(event.novelty),
        },
        sources: event.publisher_count || new Set(coverage.map((c) => c.name)).size,
        topics: rankEventTopics(event.title, lead, topics.get(id) ?? []),
        time: clockOf(publishedAt),
        publishedAt,
        updatedAt: event.last_updated_at,
        sourceList: coverage.map((c) => ({
          articleId: c.id,
          name: c.name,
          at: clockOf(c.publishedAt),
          url: c.url,
          headline: c.headline,
          ...(c.excerpt ? { excerpt: c.excerpt } : {}),
          ...(c.enrichedEvidence ? { enrichedEvidence: c.enrichedEvidence } : {}),
        })),
        before: event.before_state ?? "",
        after: event.after_state ?? "",
        timeline: coverage.map((c) => ({
          at: clockOf(c.publishedAt),
          label: `${c.name} published`,
        })),
      },
    ];
  });
}

type Coverage = {
  id: string;
  name: string;
  url: string;
  headline: string;
  publishedAt: string;
  excerpt: string;
  enrichedEvidence?: EvidenceUnit[];
};

/**
 * Article-page enrichment (0090), joined in as a second query rather than a
 * PostgREST embed: `article_evidence` is one row per article keyed on
 * `article_id`, and most events have no enriched rows yet (the stage ships
 * flag-gated), so a left-join-shaped embed would return a null object for
 * almost every card while still costing the same round trip either way.
 */
async function enrichedEvidenceFor(
  db: Db,
  articleIds: string[],
): Promise<Map<string, EvidenceUnit[]>> {
  const out = new Map<string, EvidenceUnit[]>();
  if (articleIds.length === 0) return out;
  const { data, error } = await db
    .from("article_evidence")
    .select("article_id, evidence")
    .in("article_id", articleIds)
    .eq("status", "enriched");
  if (error) return out;
  for (const row of data ?? []) {
    const evidence = Array.isArray(row.evidence) ? (row.evidence as unknown as EvidenceUnit[]) : [];
    if (evidence.length) out.set(row.article_id, evidence);
  }
  return out;
}

async function articlesFor(db: Db, eventIds: string[]): Promise<Map<string, Coverage[]>> {
  const { data, error } = await db
    .from("articles")
    .select("id, event_id, url, title, published_at, excerpt, sources ( name )")
    .in("event_id", eventIds)
    .order("published_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`reading articles: ${error.message}`);

  const rows = data ?? [];
  const evidence = await enrichedEvidenceFor(
    db,
    rows.map((r) => r.id),
  );

  const out = new Map<string, Coverage[]>();
  for (const row of rows) {
    if (!row.event_id) continue;
    const name = (row.sources as { name?: string } | null)?.name ?? "Unattributed";
    const publishedAt = row.published_at ?? "";
    const excerpt = (row.excerpt ?? "").trim();
    const list = out.get(row.event_id) ?? [];
    if (!list.some((c) => c.url === row.url)) {
      const enrichedEvidence = evidence.get(row.id);
      list.push({
        id: row.id,
        name,
        url: row.url,
        headline: row.title,
        publishedAt,
        excerpt,
        ...(enrichedEvidence ? { enrichedEvidence } : {}),
      });
    }
    out.set(row.event_id, list);
  }
  return out;
}
