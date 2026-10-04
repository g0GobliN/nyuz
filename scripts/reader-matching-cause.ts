/**
 * Why the never-matched events were never matched. (Audit 30.)
 *
 * The enrichment cause census ends with ~492 events in the 30-day window that
 * carry no `user_events` row at all: no reader was ever matched, so the
 * enrichment arms could only reach them through the 72-hour fallback while
 * they were fresh. This script asks the matching layer's question: which of
 * those events SHOULD have reached somebody?
 *
 * The matching stage (`src/lib/pipeline/match.ts`) considers complete,
 * analysed events whose occurrence clock is inside the weekly band
 * (`MAX_WEEKLY_AGE_HOURS`, 192h), requires at least one live article, pages
 * the newest `CANDIDATES` (1000) of them, and then asks the shipped
 * `decide()` per reader. Replaying that decision over the never-matched events
 * against the readers as they exist NOW classifies each event into exactly one
 * class:
 *
 *   pending_match_tick        a current reader would match it, and the next
 *                             15-minute match tick has simply not run yet
 *   gap_would_match_now       a current reader would match it, not pending --
 *                             a genuine pipeline gap (the row was never
 *                             written even though the decision says it should
 *                             have been)
 *   below_threshold_follower  a follower's topic selected it; the density
 *                             floor held it back (real, tunable loss)
 *   excluded_follower         a follower's exclusion vetoed it (deliberate)
 *   all_sources_muted         the only selecting readers muted every source
 *                             (deliberate)
 *   correct_no_follower       inside the horizon and no reader's follows
 *                             select it at all (correct behaviour)
 *   aged_out_would_reach_now  outside the 8-day candidate horizon, but a
 *                             current reader would take it if it were still a
 *                             candidate (interest arrived after the event --
 *                             only backfillable on demand, 48h)
 *   correct_aged_out          outside the horizon and nobody follows it
 *   no_articles               complete but dropped from candidates: no live
 *                             article behind it
 *   not_analysed              complete but analysed_at is null (should not
 *                             exist; reported rather than hidden)
 *   outside_candidate_page    inside the horizon but beyond the 1000-newest
 *                             candidate page (should not exist at this volume)
 *
 * The replay is a FLOOR, not a verdict: `decide()` runs without the
 * significance context, so a below-threshold event whose subject score would
 * lift it under the interest-conditional rule is still reported as
 * below-threshold. The flag state is printed alongside so the floor is
 * explicit.
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import { bestAbsence, type ArticleRow, type EnrichmentStatus } from "@/lib/enrichment-census";
import { MAX_WEEKLY_AGE_HOURS } from "@/lib/pipeline/freshness";
import {
  SUBJECT_SIGNIFICANCE_FLAG,
  decide,
  loadReaders,
  type Candidate,
  type MissReason,
} from "@/lib/pipeline/match";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

const DEFAULT_DAYS = 30;
const WINDOW_LIMIT = 1000;
const PAGE = 1000;
const CHUNK = 200;
/** A candidate analysed within this window may simply await the next tick. */
const PENDING_MINUTES = 30;

type EventDbRow = {
  id: string;
  title: string;
  what_happened: string;
  importance: number | null;
  novelty: number | null;
  tags: string[] | null;
  first_seen_at: string;
  analysed_at: string | null;
  material_revision: number | null;
  material_occurrence_at: string | null;
  last_material_change_at: string | null;
};
type TopicDbRow = { id: string; slug: string; label: string };
type LinkDbRow = { event_id: string; topic_id: string };
type ArticleDbRow = { id: string; event_id: string | null; source_id: string | null };
type EvidenceDbRow = { article_id: string; status: string; evidence: unknown };
type SourceDbRow = { id: string; name: string };
type FlagDbRow = { enabled: boolean | null };

/** The replay classes, in report order. */
const CLASSES = [
  "pending_match_tick",
  "gap_would_match_now",
  "below_threshold_follower",
  "excluded_follower",
  "all_sources_muted",
  "correct_no_follower",
  "aged_out_would_reach_now",
  "correct_aged_out",
  "no_articles",
  "not_analysed",
  "outside_candidate_page",
] as const;
type CauseClass = (typeof CLASSES)[number];

main(async () => {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const days = Number(flag("--days") ?? DEFAULT_DAYS);
  const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
  const now = Date.now();
  const client = db();

  heading(`Window: complete events from the last ${days} days`);
  const { data: eventRows, error: eventError } = await client
    .from("events")
    .select(
      "id, title, what_happened, importance, novelty, tags, first_seen_at, analysed_at, material_revision, material_occurrence_at, last_material_change_at",
    )
    .eq("status", "complete")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(WINDOW_LIMIT);
  if (eventError) throw new Error(`events: ${eventError.message}`);
  const events = (eventRows ?? []) as unknown as EventDbRow[];
  const ids = events.map((event) => event.id);
  say(rowLine("complete events in window", events.length));

  /**
   * Every match row, paged. `user_events` is small. Kept as pairs, not just a
   * set: the replay is calibrated against the pairs the stage actually wrote
   * (see the calibration section below).
   */
  type PairDbRow = {
    user_id: string;
    event_id: string;
    matched_at: string;
    briefed_at: string | null;
  };
  const pairs: PairDbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("user_events")
      .select("user_id, event_id, matched_at, briefed_at")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`user_events: ${error.message}`);
    if (!data || data.length === 0) break;
    pairs.push(...((data ?? []) as unknown as PairDbRow[]));
    if (data.length < PAGE) break;
  }
  const matched = new Set(pairs.map((pair) => pair.event_id));
  const neverMatched = events.filter((event) => !matched.has(event.id));
  say(rowLine("matched pairs, all readers all-time", pairs.length));
  say(rowLine("never matched (no user_events row)", neverMatched.length));

  /** Articles of the window events: candidate construction + census cross-tab. */
  const articles: ArticleDbRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, source_id")
      .in("event_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`articles: ${error.message}`);
    articles.push(...((data ?? []) as unknown as ArticleDbRow[]));
  }
  say(rowLine("articles attached", articles.length));

  /** Evidence rows, only to reproduce the census's never_attempted definition. */
  const evidenceByArticle = new Map<string, EvidenceDbRow>();
  const articleIds = articles.map((article) => article.id);
  for (let i = 0; i < articleIds.length; i += CHUNK) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, status, evidence")
      .in("article_id", articleIds.slice(i, i + CHUNK));
    if (error) throw new Error(`article_evidence: ${error.message}`);
    for (const item of (data ?? []) as EvidenceDbRow[])
      evidenceByArticle.set(item.article_id, item);
  }
  say(rowLine("evidence rows present", evidenceByArticle.size));

  /** The census's never_attempted set, restated so the cross-tab stays honest. */
  const neverAttempted = new Set<string>();
  for (const event of neverMatched) {
    const own = articles.filter((article) => article.event_id === event.id);
    if (own.length === 0) continue;
    const rows: ArticleRow[] = own.map((article): ArticleRow => {
      const evidence = evidenceByArticle.get(article.id);
      return {
        articleId: article.id,
        status: (evidence?.status as EnrichmentStatus | undefined) ?? null,
        evidenceUnits: Array.isArray(evidence?.evidence) ? evidence.evidence.length : 0,
        wordCount: 0,
      };
    });
    if (rows.every((article) => article.status === null) && bestAbsence(rows) === "never_attempted")
      neverAttempted.add(event.id);
  }
  say(rowLine("never-matched AND never_attempted", neverAttempted.size));

  const topicRows: TopicDbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("topics")
      .select("id, slug, label")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`topics: ${error.message}`);
    if (!data || data.length === 0) break;
    topicRows.push(...((data ?? []) as unknown as TopicDbRow[]));
    if (data.length < PAGE) break;
  }
  const topicById = new Map(topicRows.map((topic) => [topic.id, topic]));
  const sourceRows: SourceDbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("sources")
      .select("id, name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sources: ${error.message}`);
    if (!data || data.length === 0) break;
    sourceRows.push(...((data ?? []) as unknown as SourceDbRow[]));
    if (data.length < PAGE) break;
  }
  const sourceName = new Map(sourceRows.map((source) => [source.id, source.name]));

  const eventTopics = new Map<string, Candidate["topics"]>();
  const eventSources = new Map<string, Candidate["sources"]>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: links, error: linkError } = await client
      .from("event_topics")
      .select("event_id, topic_id")
      .in("event_id", ids.slice(i, i + CHUNK));
    if (linkError) throw new Error(`event_topics: ${linkError.message}`);
    for (const link of (links ?? []) as LinkDbRow[]) {
      const topic = topicById.get(link.topic_id);
      if (!topic) continue;
      const list = eventTopics.get(link.event_id) ?? [];
      list.push({ id: topic.id, slug: topic.slug, label: topic.label });
      eventTopics.set(link.event_id, list);
    }

    const { data: arts, error: artError } = await client
      .from("articles")
      .select("event_id, source_id")
      .in("event_id", ids.slice(i, i + CHUNK));
    if (artError) throw new Error(`articles(sources): ${artError.message}`);
    for (const article of (arts ?? []) as ArticleDbRow[]) {
      if (article.event_id === null || article.source_id === null) continue;
      const name = sourceName.get(article.source_id);
      if (!name) continue;
      const list = eventSources.get(article.event_id) ?? [];
      if (!list.some((s) => s.id === article.source_id)) list.push({ id: article.source_id, name });
      eventSources.set(article.event_id, list);
    }
  }

  const readers = await loadReaders(client, {});
  say(rowLine("active readers", readers.readers.length));
  say(rowLine("paused readers", readers.paused));

  const { data: flagRow, error: flagError } = await client
    .from("feature_flags")
    .select("enabled")
    .eq("key", SUBJECT_SIGNIFICANCE_FLAG)
    .maybeSingle();
  if (flagError) throw new Error(`feature_flags: ${flagError.message}`);
  const significanceOn = (flagRow as FlagDbRow | null)?.enabled === true;
  say(rowLine("subject-significance flag", significanceOn ? "on" : "off"));

  /**
   * Candidates exactly as `loadCandidates` builds them: complete + analysed,
   * at least one live article, occurrence clock inside the weekly band, then
   * the 1000 newest by that clock (id as the tiebreak, same as the stage).
   */
  const horizonMs = MAX_WEEKLY_AGE_HOURS * 3_600_000;
  const effectiveAt = (event: EventDbRow): number => {
    const occurrence = event.material_occurrence_at ?? event.first_seen_at;
    const parsed = Date.parse(occurrence);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const inHorizon = events.filter(
    (event) =>
      event.analysed_at !== null &&
      event.importance !== null &&
      now - effectiveAt(event) <= horizonMs,
  );
  inHorizon.sort((a, b) => effectiveAt(b) - effectiveAt(a) || a.id.localeCompare(b.id));
  const candidatePage = new Set(inHorizon.slice(0, WINDOW_LIMIT).map((event) => event.id));
  say(rowLine("candidate-eligible in horizon", inHorizon.length));
  say(rowLine("candidate page (1000 cap)", candidatePage.size));

  const candidateOf = new Map<string, Candidate>();
  for (const event of events) {
    if (event.analysed_at === null || event.importance === null) continue;
    if (!articles.some((a) => a.event_id === event.id)) continue;
    candidateOf.set(event.id, {
      eventId: event.id,
      title: event.title,
      whatHappened: event.what_happened ?? "",
      importance: event.importance,
      novelty: event.novelty ?? 0,
      firstSeenAt: event.first_seen_at,
      materialRevision: event.material_revision ?? 0,
      materialOccurrenceAt: event.material_occurrence_at ?? null,
      tags: event.tags ?? [],
      topics: eventTopics.get(event.id) ?? [],
      sources: eventSources.get(event.id) ?? [],
    });
  }

  /**
   * The replay. One class per event; the miss ranking below prefers the
   * strongest evidence of a loss (a follower's floor) over the weakest (a
   * reader who follows nothing), because the actionable question is whether a
   * follower existed at all.
   */
  const missRank: Record<MissReason, number> = {
    "below-threshold": 3,
    excluded: 2,
    "all-sources-muted": 1,
    "no-topic-match": 0,
    "no-topics": -1,
  };
  const classes = new Map<CauseClass, number>(CLASSES.map((name) => [name, 0]));
  const examples = new Map<CauseClass, { title: string; importance: number }[]>();
  const bump = (cls: CauseClass, event: EventDbRow) => {
    classes.set(cls, (classes.get(cls) ?? 0) + 1);
    if (event.importance === null || event.importance < 7) return;
    const list = examples.get(cls) ?? [];
    if (list.length < 5) list.push({ title: event.title, importance: event.importance });
    examples.set(cls, list);
  };

  for (const event of neverMatched) {
    if (event.analysed_at === null || event.importance === null) {
      bump("not_analysed", event);
      continue;
    }
    if (!articles.some((a) => a.event_id === event.id)) {
      bump("no_articles", event);
      continue;
    }
    const candidate = candidateOf.get(event.id);
    if (!candidate) {
      bump("no_articles", event);
      continue;
    }
    if (!candidatePage.has(event.id)) {
      bump("outside_candidate_page", event);
      continue;
    }

    let hit = false;
    let bestMiss: MissReason = "no-topics";
    for (const reader of readers.readers) {
      const verdict = decide(candidate, reader);
      if (verdict.matched) {
        hit = true;
        break;
      }
      if (missRank[verdict.reason] > missRank[bestMiss]) bestMiss = verdict.reason;
    }

    const inside = now - effectiveAt(event) <= horizonMs;
    if (hit) {
      const revised = (event.material_revision ?? 0) > 0;
      const enteredAt = revised
        ? (event.last_material_change_at ?? event.analysed_at)
        : event.analysed_at;
      const entered = enteredAt === null ? Number.NaN : Date.parse(enteredAt);
      const pending = Number.isFinite(entered) && now - entered <= PENDING_MINUTES * 60_000;
      bump(
        inside
          ? pending
            ? "pending_match_tick"
            : "gap_would_match_now"
          : "aged_out_would_reach_now",
        event,
      );
      continue;
    }
    if (!inside) {
      bump("correct_aged_out", event);
      continue;
    }
    if (bestMiss === "below-threshold") bump("below_threshold_follower", event);
    else if (bestMiss === "excluded") bump("excluded_follower", event);
    else if (bestMiss === "all-sources-muted") bump("all_sources_muted", event);
    else bump("correct_no_follower", event);
  }

  heading("Replay calibration — does the replay agree with the stage's own writes?");
  const eventById = new Map(events.map((event) => [event.id, event]));
  const windowIds = new Set(ids);
  const windowPairs = pairs.filter((pair) => windowIds.has(pair.event_id));
  say(rowLine("pairs inside the window", windowPairs.length));
  let agree = 0;
  let diverge = 0;
  let notReplayable = 0;
  const divergeReasons = new Map<string, number>();
  const divergentExamples: { title: string; reason: string }[] = [];
  for (const pair of windowPairs) {
    const candidate = candidateOf.get(pair.event_id);
    const event = eventById.get(pair.event_id);
    const reader = readers.readers.find((r) => r.userId === pair.user_id);
    if (!candidate || !event || !candidatePage.has(pair.event_id) || !reader) {
      // The pair predates the current horizon, its articles moved, or the
      // reader paused. The current rule cannot be asked about it.
      notReplayable += 1;
      continue;
    }
    const verdict = decide(candidate, reader);
    if (verdict.matched) {
      agree += 1;
      continue;
    }
    diverge += 1;
    divergeReasons.set(verdict.reason, (divergeReasons.get(verdict.reason) ?? 0) + 1);
    if (divergentExamples.length < 5 && event.importance !== null && event.importance >= 7)
      divergentExamples.push({ title: event.title, reason: verdict.reason });
  }
  say(rowLine("replay agrees (still matches)", agree));
  say(rowLine("replay diverges (pair exists)", diverge));
  say(rowLine("not replayable (left horizon/paused)", notReplayable));
  if (diverge > 0) {
    say();
    say("Divergence reasons (current rule, current preferences):");
    for (const [reason, count] of [...divergeReasons.entries()].sort((a, b) => b[1] - a[1]))
      say(rowLine(reason, count));
    for (const item of divergentExamples) say(`  ${item.reason}: ${item.title}`);
  }

  heading("Why each never-matched event was never matched");
  for (const name of CLASSES) say(rowLine(name, classes.get(name) ?? 0));

  heading("Importance >= 7 among the actionable classes");
  for (const name of [
    "gap_would_match_now",
    "below_threshold_follower",
    "aged_out_would_reach_now",
  ] as const)
    say(rowLine(name, (examples.get(name) ?? []).length));

  for (const [name, list] of examples) {
    if (list.length === 0) continue;
    say();
    say(`${name}:`);
    for (const item of list) say(`  imp ${String(item.importance).padStart(2)}  ${item.title}`);
  }

  heading("Reader-visible evidence coverage (what the reader actually sees)");
  for (const reader of readers.readers) {
    const own = windowPairs.filter((pair) => pair.user_id === reader.userId);
    if (own.length === 0) {
      say(`  ${reader.userId.slice(0, 8)}  no pairs in window`);
      continue;
    }
    const distinct = [...new Set(own.map((pair) => pair.event_id))];
    let covered = 0;
    let importantZero = 0;
    let briefedZero = 0;
    for (const eventId of distinct) {
      const ownArticles = articles.filter((article) => article.event_id === eventId);
      const units = ownArticles.reduce((sum, article) => {
        const evidence = evidenceByArticle.get(article.id);
        return sum + (Array.isArray(evidence?.evidence) ? evidence.evidence.length : 0);
      }, 0);
      if (units > 0) {
        covered += 1;
        continue;
      }
      const event = eventById.get(eventId);
      if (event?.importance !== null && (event?.importance ?? 0) >= 7) {
        importantZero += 1;
        if (importantZero <= 3 && event)
          say(`    imp ${event.importance} zero-evidence: ${event.title}`);
      }
      if (own.some((pair) => pair.event_id === eventId && pair.briefed_at !== null))
        briefedZero += 1;
    }
    const share = Math.round((covered / distinct.length) * 1000) / 10;
    say(
      `  ${reader.userId.slice(0, 8)}  events ${distinct.length}  covered ${covered} (${share}%)  ` +
        `imp>=7 zero-evidence ${importantZero}  briefed-but-zero-evidence ${briefedZero}`,
    );
  }

  heading("Reader base");
  for (const reader of readers.readers) {
    say(
      `  ${reader.userId.slice(0, 8)}  density ${String(reader.density).padStart(3)}  ` +
        `follows ${String(reader.topics.length).padStart(3)}  exclusions ${reader.exclusions.length}`,
    );
  }
  if (significanceOn)
    say(
      "\nNote: subject-significance is ON in production; this replay ran without the\n" +
        "context, so below_threshold_follower is a floor — some of those may already\n" +
        "be admitted by the live rule and pending nothing.",
    );

  const out = flag("--out");
  if (out) {
    const payload = {
      windowDays: days,
      since,
      horizonHours: MAX_WEEKLY_AGE_HOURS,
      pendingMinutes: PENDING_MINUTES,
      significanceFlagOn: significanceOn,
      activeReaders: readers.readers.length,
      pausedReaders: readers.paused,
      neverMatched: neverMatched.length,
      neverMatchedAndNeverAttempted: neverAttempted.size,
      classes: Object.fromEntries(classes),
      examples: Object.fromEntries([...examples]),
    };
    writeFileSync(out, `${JSON.stringify(payload, null, 1)}\n`);
    say();
    say(`written to ${out}`);
  }
});
