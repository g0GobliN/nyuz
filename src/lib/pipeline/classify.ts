/**
 * Stage 3.5 — what an event is about, before anyone pays to understand it.
 *
 * ---------------------------------------------------------------------------
 * The gap this fills
 * ---------------------------------------------------------------------------
 *
 * `pre_analysis_demand_gate` asks a good question badly. The question — "is any
 * reachable reader interested in this?" — is the whole cost argument: analysis
 * is the expensive stage, it runs once per event for everybody, and running it
 * on stories nobody follows is money burned. The bad part was the only signal it
 * had to answer with. Demand was measured through `source_topics`, a static
 * publisher→topic map, which asserts that everything Wired publishes is about
 * the same subjects and everything the Guardian publishes is about one beat.
 *
 * Measured against the live database on 2026-09-08, that gate admitted **zero**
 * of the fifteen newest pending events, while returning a hundred from 25 August
 * — because the outlets producing today's news (Engadget, ESPN, Polygon, BBC
 * Health, Wired) had no mapping reaching the reader's topics, and a fortnight-old
 * arXiv batch did. Analysis fell from ~120 events a day to one.
 *
 * The signal that was missing is not expensive or clever. It is the event's own
 * text, matched against the topic taxonomy the product already has, with the
 * same arithmetic `match.ts` already uses on the far side of analysis. This
 * stage moves that arithmetic to the near side, where it can decide what is
 * worth analysing rather than only describing what already was.
 *
 * ---------------------------------------------------------------------------
 * What it costs
 * ---------------------------------------------------------------------------
 *
 * Nothing. No model, no provider, no ledger row. It is `matchesTerms` over a
 * normalised string, once per event per topic, against a taxonomy of a few dozen
 * rows. The result is written once and read by every reader, so this is the
 * cheapest possible place to answer a question that would otherwise be asked
 * `events × readers` times, or worse, asked of a model.
 *
 * ---------------------------------------------------------------------------
 * Candidate topics are not `event_topics`
 * ---------------------------------------------------------------------------
 *
 * `event_topics` is what the analysis pass concluded, with a model's judgement
 * behind it, and it is what a reader is *matched* on. `event_topic_candidates`
 * is a cheap guess made from headlines to decide whether that judgement is worth
 * buying. Keeping them in separate tables keeps the distinction honest: a guess
 * must never be able to masquerade as an editorial fact on a story page, and
 * `match.ts` is deliberately left reading the curated table.
 *
 * Over-admitting here costs one analysis; under-admitting costs a reader a story
 * they follow. So the matching is the same as stage 5's — every term of a topic
 * must appear — but the haystack is generous: every article's title and excerpt,
 * not just the event's own title.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";
import { matchesTerms, normaliseText } from "@/lib/topics";
import { assignTopics } from "./topic-assign";
import { LIVE_QUEUE_HOURS, backlogLaneSize, liveLaneSize } from "./freshness";

type Db = SupabaseClient<Database>;

/**
 * Events classified per scheduled invocation.
 *
 * Far larger than the model stages, because this one is CPU and two queries.
 * The bound is PostgREST's response size and the `in` filter that follows, not
 * money — 200 events is a busy day's clustering in a single pass, which is what
 * lets the queue keep up with ingestion rather than becoming the new bottleneck.
 */
export const CLASSIFY_LIMIT = 200;

/**
 * Articles read per batch. A brake on the response body, not on correctness:
 * an event with more coverage than this is already well described by the first
 * few dozen headlines.
 */
const ARTICLES_PER_BATCH = 1200;

/** Excerpt characters folded into the haystack, per article. */
const EXCERPT_CHARS = 400;

/** Ids per `in` filter. They travel in the URL, which has a limit around 16 KB. */
const IN_CHUNK = 100;

/** Rows per insert, keeping one failure small. */
const WRITE_CHUNK = 500;

/**
 * Topics a single event may be linked to.
 *
 * An event matching more than this is matching on something too generic to be
 * a subject — the cap keeps one pathological headline from writing a row for
 * every topic in the taxonomy.
 */
const MAX_TOPICS_PER_EVENT = 8;

/**
 * Confidence for a link this stage inferred from headlines.
 *
 * Deliberately below `match.ts`'s `OBSERVED_CONFIDENCE` of 0.3. Both are
 * observations rather than assertions, but that one has an analysed event
 * behind it and this one has a substring. Nothing reads the number as a
 * threshold today; it is recorded so that when something does, the ordering
 * between the three ways a link can arise is already right.
 */
const CANDIDATE_CONFIDENCE = 0.2;

export type ClassifyOptions = {
  limit?: number | undefined;
  /** Restrict to specific events, for checking a known case. */
  eventIds?: string[] | undefined;
  /** Re-classify events that already have candidates. Off by default. */
  force?: boolean | undefined;
  /** Decide and report, write nothing. */
  dryRun?: boolean | undefined;
  now?: Date | undefined;
};

export type ClassifyOutcome = {
  eventId: string;
  title: string;
  topics: string[];
};

export type ClassifyReport = {
  startedAt: string;
  finishedAt: string;
  /** Events read from the queue. */
  considered: number;
  /** Events that matched at least one topic. */
  classified: number;
  /** Events that matched nothing — recorded as done, not retried forever. */
  unmatched: number;
  /** Candidate links written. */
  links: number;
  outcomes: ClassifyOutcome[];
};

export type TopicRow = { id: string; slug: string; label: string; terms: string[] };

type EventRow = { id: string; title: string; first_seen_at: string };

/**
 * The taxonomy, once per run.
 *
 * Every topic, not only followed ones. Classifying against the full taxonomy
 * costs the same and means a reader who adds an interest tomorrow finds today's
 * events already labelled, instead of a gap the width of whatever was clustered
 * before they signed up.
 */
async function loadTopics(db: Db): Promise<TopicRow[]> {
  const { data, error } = await db.from("topics").select("id, slug, label, terms");
  if (error) throw new Error(`reading topics: ${error.message}`);
  // Rows are NOT filtered on `terms` here. Every predefined topic in the live
  // taxonomy has `terms = []` — terms were added in 0049 for reader-created
  // interests, and the editorial vocabulary reaches events through
  // `TOPIC_KEYWORDS` instead. Dropping termless rows would therefore discard the
  // entire predefined taxonomy and leave one custom topic behind.
  return (data ?? []) as TopicRow[];
}

/**
 * The queue, in two lanes for the same reason the analysis queue has them.
 *
 * Classification is free, so starvation here is less costly than downstream —
 * but it is the stage that decides what analysis can even see, so a backlog that
 * monopolised it would recreate the original bug one step earlier.
 */
async function selectEvents(db: Db, options: ClassifyOptions): Promise<EventRow[]> {
  const columns = "id, title, first_seen_at";

  if (options.eventIds && options.eventIds.length > 0) {
    const { data, error } = await db.from("events").select(columns).in("id", options.eventIds);
    if (error) throw new Error(`selecting events: ${error.message}`);
    return (data ?? []) as EventRow[];
  }

  const limit = options.limit ?? CLASSIFY_LIMIT;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - LIVE_QUEUE_HOURS * 3_600_000).toISOString();

  const base = () => {
    let q = db.from("events").select(columns);
    if (options.force !== true) q = q.is("classified_at", null);
    return q;
  };

  const { data: live, error: liveError } = await base()
    .gte("first_seen_at", cutoff)
    .order("first_seen_at", { ascending: false })
    .limit(liveLaneSize(limit));
  if (liveError) throw new Error(`selecting live events: ${liveError.message}`);

  const backlogRoom = backlogLaneSize(limit) + (liveLaneSize(limit) - (live ?? []).length);
  if (backlogRoom <= 0) return (live ?? []) as EventRow[];

  const { data: old, error: oldError } = await base()
    .lt("first_seen_at", cutoff)
    .order("first_seen_at", { ascending: false })
    .limit(backlogRoom);
  if (oldError) throw new Error(`selecting backlog events: ${oldError.message}`);

  return [...(live ?? []), ...(old ?? [])] as EventRow[];
}

/**
 * The name and feed path of every source, for the section signal.
 *
 * A section feed is the one case where the publisher genuinely does state the
 * subject: "BBC Sport", "The Guardian Film", "NPR Health" and
 * `bbc.co.uk/sport/rss.xml` are precise, and folding them into the haystack
 * recovers exactly the mapping `source_topics` was supposed to hold and mostly
 * did not. It is free — 87 rows, once per run — and it costs nothing in
 * precision, because a publisher-wide feed like "Wired" contributes a word that
 * matches no topic keyword and simply drops out.
 *
 * The URL path is included with separators flattened so `/sport/` reads as a
 * word; the host is not, or every `theguardian.com` story would carry
 * "guardian" into the signal for no gain.
 */
async function loadSourceSignals(db: Db): Promise<Map<string, string>> {
  const { data, error } = await db.from("sources").select("id, name, feed_url");
  if (error) throw new Error(`reading sources: ${error.message}`);

  const byId = new Map<string, string>();
  for (const row of data ?? []) {
    let path = "";
    try {
      path = new URL(row.feed_url).pathname.replaceAll(/[^\p{L}\p{N}]+/gu, " ");
    } catch {
      // A feed_url that will not parse is a source problem, not a reason to
      // classify this event with less information than we have.
      path = "";
    }
    byId.set(row.id, `${row.name} ${path}`.trim());
  }
  return byId;
}

/** Every article attached to these events, plus its source's section, for the haystack. */
async function loadArticleText(
  db: Db,
  eventIds: string[],
  sourceSignals: Map<string, string>,
): Promise<Map<string, string[]>> {
  const byEvent = new Map<string, string[]>();
  if (eventIds.length === 0) return byEvent;

  for (let i = 0; i < eventIds.length; i += IN_CHUNK) {
    const chunk = eventIds.slice(i, i + IN_CHUNK);
    const { data, error } = await db
      .from("articles")
      .select("event_id, source_id, title, excerpt")
      .in("event_id", chunk)
      .limit(ARTICLES_PER_BATCH);
    if (error) throw new Error(`reading articles: ${error.message}`);

    const seenSource = new Map<string, Set<string>>();
    for (const row of data ?? []) {
      if (row.event_id === null) continue;
      const parts = byEvent.get(row.event_id) ?? [];
      parts.push(row.title);
      if (row.excerpt) parts.push(row.excerpt.slice(0, EXCERPT_CHARS));

      // Once per source per event. Repeating "BBC Sport" for each of eight
      // articles would not change any match — the keyword test is containment —
      // but it would inflate the string this runs over for nothing.
      const already = seenSource.get(row.event_id) ?? new Set<string>();
      const signal = row.source_id === null ? undefined : sourceSignals.get(row.source_id);
      if (signal !== undefined && !already.has(signal)) {
        already.add(signal);
        seenSource.set(row.event_id, already);
        parts.push(signal);
      }

      byEvent.set(row.event_id, parts);
    }
  }

  return byEvent;
}

/**
 * The whole decision, as a pure function.
 *
 * Exported because this is the rule that decides what nyuz spends money
 * understanding, and it must be the same rule in a test as in a run.
 */
export function topicsFor(
  event: { title: string },
  articleText: readonly string[],
  topics: readonly TopicRow[],
): string[] {
  const raw = [event.title, ...articleText].join(" ");
  if (raw.trim() === "") return [];

  // Two routes, mirroring exactly how the two kinds of topic already reach an
  // event on the far side of analysis. Nothing new is invented here, which is
  // the point: a second implementation of "what is this about" would drift from
  // the first, and 0054 is the record of what that costs.
  //
  //   predefined — `assignTopics`, the keyword pool `analyse.ts` already uses to
  //     write `event_topics`. Needed because the editorial labels are
  //     categories: a Griezmann goal is Sports and contains no word "sports",
  //     so matching the label literally finds nothing at all.
  //
  //   custom — the reader's own terms, all of which must appear, which is the
  //     rule `match.ts` applies to the same rows.
  const labels = new Set(assignTopics(raw).map((label) => label.toLowerCase()));
  const signal = normaliseText(raw);

  const matched: string[] = [];
  for (const topic of topics) {
    const byKeyword = labels.has(topic.label.toLowerCase());
    // The length guard is load-bearing: `matchesTerms` uses `every`, which is
    // vacuously true on an empty list, and every predefined row has one.
    const byTerms = topic.terms.length > 0 && matchesTerms(signal, topic.terms);
    if (!byKeyword && !byTerms) continue;
    matched.push(topic.id);
    if (matched.length >= MAX_TOPICS_PER_EVENT) break;
  }
  return matched;
}

/**
 * Label every event the queue hands over.
 *
 * An event that matches nothing is still stamped `classified_at`. That is the
 * difference between "we have not looked" and "we looked and it is about
 * nothing anyone here follows", and without it the queue would re-examine the
 * same unmatched events forever while never reaching the ones behind them.
 */
export async function classify(db: Db, options: ClassifyOptions = {}): Promise<ClassifyReport> {
  const started = options.now ?? new Date();
  const startedAt = started.toISOString();

  const [topics, events, sourceSignals] = await Promise.all([
    loadTopics(db),
    selectEvents(db, options),
    loadSourceSignals(db),
  ]);
  const articleText = await loadArticleText(
    db,
    events.map((e) => e.id),
    sourceSignals,
  );

  const outcomes: ClassifyOutcome[] = [];
  const links: { event_id: string; topic_id: string; confidence: number }[] = [];

  for (const event of events) {
    const matched = topicsFor(event, articleText.get(event.id) ?? [], topics);
    outcomes.push({ eventId: event.id, title: event.title, topics: matched });
    for (const topicId of matched) {
      links.push({ event_id: event.id, topic_id: topicId, confidence: CANDIDATE_CONFIDENCE });
    }
  }

  if (options.dryRun !== true && events.length > 0) {
    for (let i = 0; i < links.length; i += WRITE_CHUNK) {
      const chunk = links.slice(i, i + WRITE_CHUNK);
      const { error } = await db
        .from("event_topic_candidates")
        .upsert(chunk, { onConflict: "event_id,topic_id", ignoreDuplicates: true });
      if (error) throw new Error(`writing candidate topics: ${error.message}`);
    }

    // Stamped after the links, never before. A crash between the two leaves an
    // event unstamped and re-examined, which costs one more pass; the other
    // order would leave it stamped with no links, which reads as "nobody wants
    // this" and would quietly withhold it from analysis for good.
    const stampedAt = new Date().toISOString();
    const ids = events.map((e) => e.id);
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { error } = await db
        .from("events")
        .update({ classified_at: stampedAt })
        .in("id", ids.slice(i, i + IN_CHUNK));
      if (error) throw new Error(`stamping classified_at: ${error.message}`);
    }
  }

  const classified = outcomes.filter((o) => o.topics.length > 0).length;

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    considered: events.length,
    classified,
    unmatched: outcomes.length - classified,
    links: links.length,
    outcomes,
  };
}

/** One line per run, for `wrangler tail`. */
export function describeClassify(report: ClassifyReport): string {
  const seconds = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000);
  return (
    `classify: ${report.considered} events, ${report.classified} labelled, ` +
    `${report.unmatched} about nothing followed, ${report.links} links, ${seconds}s`
  );
}
