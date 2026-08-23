/**
 * Stage 5 — matching events to readers.
 *
 * ---------------------------------------------------------------------------
 * The one stage that must not cost anything
 * ---------------------------------------------------------------------------
 *
 * Everything upstream of here happens once for everybody: an event is grouped
 * once and understood once, however many people eventually read it. Everything
 * downstream is one short paragraph per person. This stage is the join between
 * the two, and it is the only stage whose work grows with the number of
 * subscribers — so it calls no model, and it never will. It is set arithmetic
 * over rows that already exist.
 *
 * That constraint is the whole cost argument. A matcher that asked a model "would
 * this reader care?" would be `events × readers` model calls a day, which is the
 * business this product exists not to be.
 *
 * ---------------------------------------------------------------------------
 * Why this is TypeScript and not a SQL function
 * ---------------------------------------------------------------------------
 *
 * The plan calls this stage "a SQL query", and as a single `insert ... select` it
 * would be one. It is written here instead for the same reason stage 3's
 * shortlist was: DDL cannot be applied from this environment, so a
 * `security definer` function would be a file nobody had run. `0007_source_stats.sql`
 * is already sitting unapplied as the demonstration.
 *
 * Nothing is lost in the translation. The reads are set-based and bounded — one
 * page of events, one of their topics, one of their sources, and one row per
 * reader preference — and the decision is a pure function over what came back. It
 * is still arithmetic, it still costs no tokens, and every rule is in one place
 * where a test can reach it.
 *
 * ---------------------------------------------------------------------------
 * Idempotence, and what `matched_at` means
 * ---------------------------------------------------------------------------
 *
 * Existing pairs are read first and never rewritten. So `user_events.matched_at`
 * is the moment a reader first matched an event, not the last time this stage
 * ran, and running it twice writes nothing the second time. That matters more
 * than it looks: `importance` is fixed once analysis writes it, so a re-run can
 * only ever reach the same verdict, and rewriting `matched_at` would turn a
 * stable timestamp into "whenever the cron last fired" for no gain.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { floorFor, thresholdFor } from "@/lib/density";
import { related } from "@/lib/relate";
import type { Database, SourcePref, TopicImportance } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

/**
 * Events considered per run, newest analysis first.
 *
 * Generous compared with the model stages, because this one is free: the ceiling
 * is PostgREST's 1000-row response cap and the size of the `in` filters that
 * follow, not money. 400 events is a few thousand articles' worth of coverage,
 * which is more than a day of real feeds produces.
 */
const CANDIDATES = 400;

/** Ids per `in` filter. They travel in the URL, which has a limit around 16 KB. */
const IN_CHUNK = 100;

/** Rows per insert. The body is JSON, so this is about keeping one failure small. */
const WRITE_CHUNK = 500;

export type MatchOptions = {
  /** Restrict to specific readers, for checking a known case. */
  userIds?: string[] | undefined;
  /** Only events analysed within this many hours. Absent means every analysed event. */
  sinceHours?: number | undefined;
  /** Candidate events to consider. Absent means `CANDIDATES`. */
  limit?: number | undefined;
  /** Decide and report, write nothing. */
  dryRun?: boolean | undefined;
  /** Include readers who have paused their briefings. Off by default, and honestly so. */
  includePaused?: boolean | undefined;
  now?: Date | undefined;
};

/** Why an event did not reach a reader. Counted per reader, for the report. */
export type MissReason =
  | "no-topics" // follows nothing: an empty briefing is the correct answer
  | "no-topic-match"
  | "below-threshold"
  | "all-sources-muted"
  | "excluded";

export type Verdict =
  { matched: true; relevance: number; topics: string[] } | { matched: false; reason: MissReason };

export type CandidateTopic = { id: string; slug: string; label: string };
export type CandidateSource = { id: string; name: string };

export type Candidate = {
  eventId: string;
  title: string;
  /** 0..10, from the shared analysis pass. */
  importance: number;
  /** 0..10. */
  novelty: number;
  topics: CandidateTopic[];
  /** The sources that reported it. Empty is possible: an event whose articles moved. */
  sources: CandidateSource[];
};

export type ReaderTopic = {
  topicId: string;
  slug: string;
  label: string;
  importance: TopicImportance;
  weight: number;
  keywords: string[];
  excludeKeywords: string[];
};

export type Reader = {
  userId: string;
  /** 0 = minimal .. 100 = deep. */
  density: number;
  topics: ReaderTopic[];
  exclusions: string[];
  /** source_id -> pref. Absent means `normal`. */
  sourcePrefs: Map<string, SourcePref>;
};

export type ReaderOutcome = {
  userId: string;
  density: number;
  threshold: number;
  follows: number;
  considered: number;
  matched: number;
  inserted: number;
  /** Already in `user_events` from an earlier run. Not rewritten. */
  known: number;
  misses: Record<MissReason, number>;
  detail: string;
};

export type MatchReport = {
  startedAt: string;
  finishedAt: string;
  /** Readers considered. */
  readers: number;
  /** Readers skipped because their briefings are paused. */
  paused: number;
  candidates: number;
  matched: number;
  inserted: number;
  outcomes: ReaderOutcome[];
};

/**
 * Everything a reader's own words could reasonably match against.
 *
 * Topic slugs and labels, the sources that reported it, and the title analysis
 * wrote. Not `what_happened`: the predicate is substring containment, and over
 * one to three sentences of prose that produces vetoes nobody asked for — a
 * reader who excluded "art" would lose every story about startups. A term that
 * appears only in the body is a passing mention rather than the subject.
 */
function haystack(candidate: Candidate): string[] {
  return [
    candidate.title,
    ...candidate.topics.flatMap((t) => [t.slug, t.label]),
    ...candidate.sources.map((s) => s.name),
  ];
}

/** Whether one followed topic reaches this event: by id, or by a keyword of its own. */
function selects(topic: ReaderTopic, candidate: Candidate, fields: string[]): boolean {
  // The exact join the plan asks for. `event_topics` against `user_topics`, on
  // the id — no text comparison can be looser or wrong, and it is what analysis
  // was constrained to write.
  if (candidate.topics.some((t) => t.id === topic.topicId)) return true;

  // Free text the reader added to a topic. This is the only channel where
  // spelling matters, so it is the channel `related` exists for.
  return topic.keywords.some((keyword) => fields.some((f) => related(f, keyword)));
}

/**
 * Whether one event reaches one reader, and how relevant it is if so.
 *
 * The order of the gates below is a product rule rather than an implementation
 * detail, and the last one is the reason:
 *
 *   1. no followed topics    an empty briefing, not a full one
 *   2. topic selection       `event_topics` against `user_topics`
 *   3. importance threshold  the density dial, per topic
 *   4. muted sources         only if every source is muted
 *   5. exclusions            **last, and they win**
 *
 * Checking exclusions last rather than first changes nobody's briefing — a veto
 * is a veto whenever it runs — but it changes what the report can say. An
 * operator seeing `excluded` knows a topic selected the event and the reader's
 * own term overruled it, which is the promise the landing page makes out loud.
 */
export function decide(candidate: Candidate, reader: Reader): Verdict {
  // Following nothing must not mean "show everything". This is the bug
  // `src/lib/matching.ts` was written to fix, in its purest form.
  if (reader.topics.length === 0) return { matched: false, reason: "no-topics" };

  const fields = haystack(candidate);

  const selected = reader.topics.filter((topic) => selects(topic, candidate, fields));
  if (selected.length === 0) return { matched: false, reason: "no-topic-match" };

  const dial = thresholdFor(reader.density);
  const admitting = selected.filter((t) => candidate.importance >= floorFor(t.importance, dial));
  if (admitting.length === 0) return { matched: false, reason: "below-threshold" };

  // Muting a source is not excluding a story. Three outlets covered it and the
  // reader muted one; the story stands, and the sources panel still has two
  // links they did not object to. Only an event reported solely by muted sources
  // is dropped, because for that one there is nothing left to show them.
  const muted = (s: CandidateSource) => reader.sourcePrefs.get(s.id) === "muted";
  if (candidate.sources.length > 0 && candidate.sources.every(muted)) {
    return { matched: false, reason: "all-sources-muted" };
  }

  // Exclusions are drawn from every topic that selected the event, not only the
  // ones that cleared the bar. A veto should be as easy to trigger as possible:
  // the cost of over-excluding is a story the reader asked not to see, and the
  // cost of under-excluding is a broken promise.
  const vetoes = [...reader.exclusions, ...selected.flatMap((t) => t.excludeKeywords)];
  if (vetoes.some((term) => fields.some((f) => related(f, term)))) {
    return { matched: false, reason: "excluded" };
  }

  return {
    matched: true,
    relevance: relevanceOf(candidate, admitting, reader),
    topics: admitting.map((t) => t.label),
  };
}

/**
 * The ordering key for a briefing. Deterministic, and deliberately dull.
 *
 * Importance leads, because it is the only term a model assigned after reading the
 * coverage. Everything after it is personal, and is allowed to outrank it: novelty
 * contributes up to five points, each extra interest the event touches one, and a
 * source the reader marked priority two. So an importance-4 story in three of
 * someone's interests can and does sit above an importance-7 story in one of them.
 *
 * That is a decision rather than an accident. `relevance` is not a second copy of
 * `importance` — sorting a personal briefing strictly by the shared score would put
 * the field-wide event a reader barely cares about above the thing squarely in
 * their interests, which is the generic-digest failure this product exists to
 * avoid. Ties are real ties: two events with an equal claim on one reader's
 * attention, arrived at by different routes.
 *
 * `weight` multiplies at the end, so a reader who has weighted a topic moves its
 * stories relative to everything else rather than by a fixed step. Nothing in the
 * interface sets it yet; the column defaults to 1, which is the identity.
 */
function relevanceOf(candidate: Candidate, admitting: ReaderTopic[], reader: Reader): number {
  const priority = candidate.sources.some((s) => reader.sourcePrefs.get(s.id) === "priority");
  const weight = Math.max(...admitting.map((t) => t.weight));

  const score =
    (candidate.importance + candidate.novelty / 2 + (admitting.length - 1) + (priority ? 2 : 0)) *
    weight;

  // Two decimals: the column is `real`, and a value that renders differently on
  // every read is a value nobody can assert against.
  return Math.round(score * 100) / 100;
}

/**
 * Matches every reader against every recently-analysed event.
 *
 * Reads are set-based rather than per reader: one page of candidates and their
 * topics and sources, then one query per preference table. The nested loop that
 * follows is in memory, where it costs nothing.
 */
export async function match(db: Db, options: MatchOptions = {}): Promise<MatchReport> {
  const startedAt = (options.now ?? new Date()).toISOString();

  const readers = await loadReaders(db, options);
  const candidates = await loadCandidates(db, options);

  const outcomes: ReaderOutcome[] = [];
  let inserted = 0;
  let matched = 0;

  for (const reader of readers.readers) {
    const outcome = await matchReader(db, reader, candidates, options);
    outcomes.push(outcome);
    inserted += outcome.inserted;
    matched += outcome.matched;
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    readers: readers.readers.length,
    paused: readers.paused,
    candidates: candidates.length,
    matched,
    inserted,
    outcomes,
  };
}

async function matchReader(
  db: Db,
  reader: Reader,
  candidates: Candidate[],
  options: MatchOptions,
): Promise<ReaderOutcome> {
  const misses: Record<MissReason, number> = {
    "no-topics": 0,
    "no-topic-match": 0,
    "below-threshold": 0,
    "all-sources-muted": 0,
    excluded: 0,
  };

  const hits: { eventId: string; relevance: number }[] = [];

  for (const candidate of candidates) {
    const verdict = decide(candidate, reader);
    if (verdict.matched) hits.push({ eventId: candidate.eventId, relevance: verdict.relevance });
    else misses[verdict.reason] += 1;
  }

  const already = await existingPairs(
    db,
    reader.userId,
    hits.map((h) => h.eventId),
  );
  const fresh = hits.filter((h) => !already.has(h.eventId));

  if (!options.dryRun && fresh.length > 0) {
    for (let i = 0; i < fresh.length; i += WRITE_CHUNK) {
      const rows = fresh.slice(i, i + WRITE_CHUNK).map((h) => ({
        user_id: reader.userId,
        event_id: h.eventId,
        relevance: h.relevance,
      }));

      // `ignoreDuplicates` as well as the read above: the read makes the count
      // right, and this makes a second worker harmless.
      const { error } = await db
        .from("user_events")
        .upsert(rows, { onConflict: "user_id,event_id", ignoreDuplicates: true });

      if (error) throw new Error(`writing user_events: ${error.message}`);
    }
  }

  const threshold = thresholdFor(reader.density);

  return {
    userId: reader.userId,
    density: reader.density,
    threshold,
    follows: reader.topics.length,
    considered: candidates.length,
    matched: hits.length,
    inserted: options.dryRun ? 0 : fresh.length,
    known: hits.length - fresh.length,
    misses,
    detail:
      `${hits.length}/${candidates.length} matched at importance >= ${threshold}` +
      (options.dryRun ? " (dry run)" : `, ${fresh.length} new`),
  };
}

/** Which of these events this reader already has. Keeps `matched_at` stable. */
async function existingPairs(db: Db, userId: string, eventIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();

  for (const chunk of chunked(eventIds, IN_CHUNK)) {
    const { data, error } = await db
      .from("user_events")
      .select("event_id")
      .eq("user_id", userId)
      .in("event_id", chunk);

    if (error) throw new Error(`reading user_events: ${error.message}`);
    for (const row of data ?? []) found.add(row.event_id);
  }

  return found;
}

/**
 * The readers this run will decide for, with every preference they have set.
 *
 * Exported because stage 6 needs the same reader, assembled the same way. The
 * day-one backfill will not spend a token analysing an event until it knows what
 * a brand-new account follows, and a second copy of this assembly would be a
 * second answer to the question "what does this person follow".
 */
export async function loadReaders(
  db: Db,
  options: MatchOptions,
): Promise<{ readers: Reader[]; paused: number }> {
  let query = db.from("notification_preferences").select("user_id, density, paused");
  if (options.userIds) query = query.in("user_id", options.userIds);

  const { data: prefs, error } = await query;
  if (error) throw new Error(`reading notification_preferences: ${error.message}`);

  const rows = prefs ?? [];
  const wanted = options.includePaused ? rows : rows.filter((r) => !r.paused);
  const paused = rows.length - wanted.length;
  if (wanted.length === 0) return { readers: [], paused };

  const userIds = wanted.map((r) => r.user_id);
  const topics = await topicIndex(db);

  const { data: followed, error: followError } = await db
    .from("user_topics")
    .select("user_id, topic_id, importance, weight, keywords, exclude_keywords, muted")
    .in("user_id", userIds)
    // A muted topic is a topic the reader switched off. It selects nothing, and
    // its exclude_keywords veto nothing either, because it is not in play.
    .eq("muted", false);
  if (followError) throw new Error(`reading user_topics: ${followError.message}`);

  const { data: exclusions, error: exclusionError } = await db
    .from("user_exclusions")
    .select("user_id, term")
    .in("user_id", userIds);
  if (exclusionError) throw new Error(`reading user_exclusions: ${exclusionError.message}`);

  const { data: sourcePrefs, error: sourceError } = await db
    .from("user_source_prefs")
    .select("user_id, source_id, pref")
    .in("user_id", userIds);
  if (sourceError) throw new Error(`reading user_source_prefs: ${sourceError.message}`);

  const readers = wanted.map((row) => {
    const mine = (followed ?? []).filter((f) => f.user_id === row.user_id);

    return {
      userId: row.user_id,
      density: row.density,
      topics: mine.flatMap<ReaderTopic>((f) => {
        const topic = topics.get(f.topic_id);
        // A followed topic whose row has gone is not an error and not a match.
        if (!topic) return [];
        return [
          {
            topicId: f.topic_id,
            slug: topic.slug,
            label: topic.label,
            importance: f.importance,
            weight: f.weight,
            keywords: f.keywords,
            excludeKeywords: f.exclude_keywords,
          },
        ];
      }),
      exclusions: (exclusions ?? []).filter((e) => e.user_id === row.user_id).map((e) => e.term),
      sourcePrefs: new Map(
        (sourcePrefs ?? [])
          .filter((p) => p.user_id === row.user_id)
          .map((p) => [p.source_id, p.pref] as const),
      ),
    };
  });

  return { readers, paused };
}

async function topicIndex(db: Db): Promise<Map<string, { slug: string; label: string }>> {
  const { data, error } = await db.from("topics").select("id, slug, label");
  if (error) throw new Error(`reading topics: ${error.message}`);
  return new Map((data ?? []).map((t) => [t.id, { slug: t.slug, label: t.label }] as const));
}

/**
 * The events that could reach anybody.
 *
 * `analysed_at is not null` is the gate, and it is the same one analysis uses in
 * reverse. An event that has not been read has no importance to compare against a
 * threshold and no topics to join, so matching it would be matching a placeholder.
 */
async function loadCandidates(db: Db, options: MatchOptions): Promise<Candidate[]> {
  let query = db
    .from("events")
    .select("id, title, importance, novelty, analysed_at")
    .not("analysed_at", "is", null)
    .eq("status", "complete")
    .order("analysed_at", { ascending: false })
    .limit(options.limit ?? CANDIDATES);

  if (options.sinceHours !== undefined) {
    const since = new Date((options.now ?? new Date()).getTime() - options.sinceHours * 3_600_000);
    query = query.gte("analysed_at", since.toISOString());
  }

  const { data: events, error } = await query;
  if (error) throw new Error(`reading events: ${error.message}`);
  if (!events || events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const topics = await topicIndex(db);
  const sources = await sourceIndex(db);

  const eventTopics = new Map<string, CandidateTopic[]>();
  const eventSources = new Map<string, CandidateSource[]>();

  for (const chunk of chunked(eventIds, IN_CHUNK)) {
    const { data: links, error: linkError } = await db
      .from("event_topics")
      .select("event_id, topic_id")
      .in("event_id", chunk);
    if (linkError) throw new Error(`reading event_topics: ${linkError.message}`);

    for (const link of links ?? []) {
      const topic = topics.get(link.topic_id);
      if (!topic) continue;
      const list = eventTopics.get(link.event_id) ?? [];
      list.push({ id: link.topic_id, slug: topic.slug, label: topic.label });
      eventTopics.set(link.event_id, list);
    }

    const { data: articles, error: articleError } = await db
      .from("articles")
      .select("event_id, source_id")
      .in("event_id", chunk);
    if (articleError) throw new Error(`reading articles: ${articleError.message}`);

    for (const article of articles ?? []) {
      if (article.event_id === null || article.source_id === null) continue;
      const source = sources.get(article.source_id);
      if (!source) continue;
      const list = eventSources.get(article.event_id) ?? [];
      // One source can report an event twice. Muting and priority are decisions
      // about the source, so the duplicate would change nothing but is dropped
      // to keep the report readable.
      if (!list.some((s) => s.id === article.source_id)) {
        list.push({ id: article.source_id, name: source });
      }
      eventSources.set(article.event_id, list);
    }
  }

  return events.map((event) => ({
    eventId: event.id,
    title: event.title,
    importance: event.importance,
    novelty: event.novelty,
    topics: eventTopics.get(event.id) ?? [],
    sources: eventSources.get(event.id) ?? [],
  }));
}

async function sourceIndex(db: Db): Promise<Map<string, string>> {
  const { data, error } = await db.from("sources").select("id, name");
  if (error) throw new Error(`reading sources: ${error.message}`);
  return new Map((data ?? []).map((s) => [s.id, s.name] as const));
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * One line per run, for `wrangler tail`.
 *
 * The miss counts are here rather than in a debug flag because they are the only
 * evidence of why a briefing was empty, and "0 matched" on its own cannot
 * distinguish a reader who follows nothing from a threshold set too high.
 */
export function describeMatch(report: MatchReport): string {
  const seconds = Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000);

  const misses = report.outcomes.reduce<Record<MissReason, number>>(
    (acc, o) => {
      for (const key of Object.keys(acc) as MissReason[]) acc[key] += o.misses[key];
      return acc;
    },
    {
      "no-topics": 0,
      "no-topic-match": 0,
      "below-threshold": 0,
      "all-sources-muted": 0,
      excluded: 0,
    },
  );

  const reasons = (Object.entries(misses) as [MissReason, number][])
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ");

  return (
    `match: ${report.readers} readers x ${report.candidates} events, ` +
    `${report.matched} matched, ${report.inserted} new, ` +
    `${report.paused} paused, ${seconds}s` +
    (reasons ? ` | misses: ${reasons}` : "")
  );
}
