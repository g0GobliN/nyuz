import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signedInOnly } from "./guard";
import { backfill, WINDOW_HOURS } from "@/lib/pipeline/backfill";
import type { Database } from "@/lib/supabase/types";

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
 * refuses to analyse anything twice for one account, caps a run at three events,
 * and will not pay for an event whose headline names nothing the reader follows.
 * The brakes are in the pipeline module rather than in this file on purpose:
 * they have to hold for the CLI and the Worker too, not only for the browser.
 *
 * ---------------------------------------------------------------------------
 * This is not stage 8
 * ---------------------------------------------------------------------------
 *
 * `loadMatches` returns real rows, and the dashboard renders them above the
 * fixtures it still carries. It deliberately does not try to be the fixture
 * shape: there is no `why_it_matters` yet — that is stage 7, the one paragraph
 * per person — and no story page behind these events yet, so nothing here links
 * to one. Replacing `sample-data` outright is stage 8's box, and the sample
 * notice stays until it is a lie.
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
 * ordering the product promises — importance the model assigned, adjusted by how
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
 * Safe to call repeatedly: the free pass is idempotent by construction, and the
 * paid one runs at most once per account.
 */
export const startFirstBriefing = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<FirstBriefing> => {
    const report = await backfill(context.actor.db, { userId: context.actor.id });

    // Logged rather than only returned. This is the one reader-triggered path
    // that can spend model tokens, so the server keeps its own record of what it
    // decided, independent of a browser that may have navigated away.
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
