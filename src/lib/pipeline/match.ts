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
import { keepUsableExclusions } from "@/lib/exclusions";
import { floorFor, thresholdFor } from "@/lib/density";
import { related } from "@/lib/relate";
import type { EmailEnv } from "@/lib/server/email/send";
import type { TelegramEnv } from "@/lib/server/telegram/send";
import type { PushEnv } from "@/lib/server/push/send";
import type {
  Database,
  PlanTier,
  SourcePref,
  TopicImportance,
  TopicKind,
} from "@/lib/supabase/types";
import { normaliseText } from "@/lib/topics";
import {
  evaluateSpec,
  customTopicSignal,
  specForTopic,
  specStatus,
  topicMatches,
  topicVetoes,
} from "@/lib/match-spec";
import {
  briefingScore,
  historyFrom,
  historyWithout,
  observationsFor,
  readerNovelty,
  relevanceStrength,
  significanceShadow,
  subjectSignificance,
  type SignificanceRow,
  type SignificanceShadow,
  type SubjectHistory,
  type SubjectObservations,
} from "./subject-significance";
import { PLAN_LIMITS, clipLabels } from "@/lib/plans";
import { fireAlerts } from "./alerts";
import { MAX_WEEKLY_AGE_HOURS, activeCutoff } from "./freshness";

type Db = SupabaseClient<Database>;

/**
 * Events considered per run, newest analysis first.
 *
 * Generous compared with the model stages, because this one is free. Keep the
 * page at PostgREST's default 1000-row cap; a smaller application limit can
 * starve eligible events in a busy rolling window. Larger backlogs need a
 * durable cursor rather than a larger request.
 */
const CANDIDATES = 1_000;

/** Ids per `in` filter. They travel in the URL, which has a limit around 16 KB. */
const IN_CHUNK = 100;

/** Keep every PostgREST page below the project default row cap. */
const READ_PAGE_SIZE = 500;

/** Rows per insert. The body is JSON, so this is about keeping one failure small. */
const WRITE_CHUNK = 500;

/**
 * Reopened relationships per reader per run.
 *
 * Reopening is one statement per pair rather than a batched upsert, because each
 * pair carries its own relevance and the list is expected to be empty or tiny.
 * The cap is the guarantee that stays true even if that expectation is wrong:
 * a pathological revision burst costs a bounded number of writes and the rest
 * wait for the next run.
 */
const REOPEN_CAP = 200;

/**
 * The feature flag for interest-conditional admission (P4).
 *
 * Off means the behaviour that shipped: an event reaches a topic when its shared
 * importance clears the topic's floor. On adds the subject-relative term, which
 * can only ever raise a topic's score -- see `subject-significance.ts`. The flag
 * exists because that term can admit events the shared score would not, and a
 * change of that kind is measured before it is enabled, never after.
 */
export const SUBJECT_SIGNIFICANCE_FLAG = "subject_significance_enabled";

/**
 * Confidence for a source→topic link this stage observed rather than an
 * operator asserting.
 *
 * Low on purpose. `source_topics.confidence` is "how strongly this source
 * covers this topic", and one event proves the source touched the subject
 * once — enough to count as demand, not enough to claim it is a beat. An
 * editorial mapping entered in the console keeps its own higher value, because
 * the upsert below never overwrites an existing row.
 */
const OBSERVED_CONFIDENCE = 0.3;

/** Source→topic links written per run. A brake, not a target. */
const OBSERVED_LINK_CAP = 200;

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
  /**
   * Skip out-of-schedule alerts. Day-one backfill sets this: matching a backlog
   * must not dump a week's worth of "breaking" mail into a new inbox.
   */
  skipAlerts?: boolean | undefined;
  /**
   * Interest-conditional admission. Absent means "read the feature flag", which
   * fails closed: an unreadable flag is the behaviour that shipped.
   */
  subjectSignificance?: boolean | undefined;
  /**
   * Measure the interest-conditional rule against the shipped one, over this
   * run's candidates and readers, without letting it decide anything (P4
   * shadow). The report then carries `significanceShadow`. Combine with
   * `dryRun` for a read-only operator run -- `npm run shadow:significance`.
   */
  significanceShadow?: boolean | undefined;
  /** Passed through to alert sends. Absent on a dry run, required on Cloudflare. */
  email?: EmailEnv | undefined;
  telegram?: TelegramEnv | undefined;
  push?: PushEnv | undefined;
};

/** Why an event did not reach a reader. Counted per reader, for the report. */
export type MissReason =
  | "no-topics" // follows nothing: an empty briefing is the correct answer
  | "no-topic-match"
  | "below-threshold"
  | "all-sources-muted"
  | "excluded"
  | "topic-muted";

export type Verdict =
  | {
      matched: true;
      relevance: number;
      topics: string[];
      /**
       * The interest-conditional signals over the topics that admitted the
       * event, present only when a significance context was given. What the
       * alert rule reads.
       */
      significance?: TopicSignals | undefined;
    }
  | { matched: false; reason: MissReason };

/** The P4 signals for one event, over some set of one reader's topics. */
export type TopicSignals = {
  /** At least one of the topics matched the event firmly. */
  relevanceStrong: boolean;
  /** The subject score of the firmest such topic (the best overall if none). */
  subject: number;
};

export type CandidateTopic = { id: string; slug: string; label: string };
export type CandidateSource = { id: string; name: string };

export type Candidate = {
  eventId: string;
  title: string;
  /** The shared briefing paragraph. Selection reads it; vetoes do not — see below. */
  whatHappened: string;
  /** 0..10, from the shared analysis pass. */
  importance: number;
  /** 0..10. */
  novelty: number;
  /** When the world saw the event — for alert freshness. */
  firstSeenAt: string;
  /**
   * Accepted material transitions (0097). 0 means the event has never moved
   * since its first finalization. A reader who holds revision N is reopened
   * only when this is greater than N.
   */
  materialRevision: number;
  /**
   * When the evidence behind the current material state was published. Null for
   * an event that has never been revised, where `firstSeenAt` is already the
   * right clock. This is what a re-delivered update ages on: occurrence, never
   * discovery.
   */
  materialOccurrenceAt: string | null;
  topics: CandidateTopic[];
  /**
   * Normalised concepts from the shared analysis pass (0049). Written once per
   * event, read by every reader — this is what a reader's own words match
   * against, and why custom interests cost no model call each.
   */
  tags: string[];
  /** The sources that reported it. Empty is possible: an event whose articles moved. */
  sources: CandidateSource[];
};

export type ReaderTopic = {
  topicId: string;
  slug: string;
  label: string;
  /**
   * `predefined` reaches events through `event_topics`, which analysis wrote.
   * `custom` reaches them through its match spec against the shared signal,
   * because the model was never given the vocabulary to classify it.
   */
  kind: TopicKind;
  /** Deterministic match terms. ALL must be present. Empty for predefined. */
  terms: string[];
  /**
   * The stored specification as the row holds it (0100), read by
   * `specForTopic`: null or `{}` derive from `terms` -- exactly the behaviour
   * this stage had before specifications existed -- a valid spec is itself, and
   * a malformed one selects nothing rather than falling back to something
   * broader.
   */
  spec: unknown;
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
  /**
   * Labels the reader muted from a story card (`muted_topics`, 0089). A veto
   * about a SUBJECT, not a string: it fires only when the event itself is
   * linked to the muted topic, never on free-text containment — a muted "AI"
   * must not swallow a story that merely says "AI" in passing.
   */
  mutedTopics: Set<string>;
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
  /**
   * Closed relationships reopened because the story materially moved since the
   * revision this reader holds. The only path by which a reader can receive an
   * event twice.
   */
  reopened: number;
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
  /** Material updates that reopened a reader's closed relationship. */
  reopened: number;
  /** Whether the interest-conditional admission rule was in force for this run. */
  subjectSignificance: boolean;
  /**
   * Where the subject baselines came from: the subjects' own history, or
   * nowhere (the history read failed, so every subject score is 0 and the rule
   * cannot lift anything), or not needed (neither the rule nor the shadow ran).
   */
  significanceHistory: "loaded" | "unavailable" | "not-needed";
  /** The P4 shadow comparison, when `significanceShadow` was asked for. */
  significanceShadow?: SignificanceShadow | undefined;
  /** Source→topic links this run observed. See `recordObservedCoverage`. */
  coverageLinks: number;
  outcomes: ReaderOutcome[];
};

/**
 * The fields a topic's own free-text keywords may match against.
 *
 * Topic slugs and labels, the sources that reported it, and the title analysis
 * wrote. Deliberately NOT `what_happened` or `tags`: the predicate here is
 * substring containment, and over one to three sentences of prose that produces
 * selections nobody asked for — a reader who added the keyword "art" would get
 * every story about startups. A term that appears only in the body is a passing
 * mention rather than the subject.
 *
 * Selection reads less than the matcher does (see `signalOf`), and that
 * asymmetry is deliberate: over-selecting costs one story a reader skims. The
 * VETO does not share it, because over-vetoing a story the reader excluded is
 * a promise this product makes out loud on the topics page — "Exclusions win
 * over topics. If a story matches both, it stays out." A veto that could not
 * see `tags` was not true to that sentence: a story tagged `art` kept arriving
 * to a reader who had excluded `art`, with nothing in the interface to
 * explain it. So the veto reads the wide signal and selection keeps the narrow
 * one.
 */
function haystack(candidate: Candidate): string[] {
  return [
    candidate.title,
    ...candidate.topics.flatMap((t) => [t.slug, t.label]),
    ...candidate.sources.map((s) => s.name),
  ];
}

/**
 * The shared signal a reader's own words are matched against, normalised once.
 *
 * Title, the briefing paragraph, the concepts the analysis pass extracted, the
 * curated labels and the outlet names — everything already computed for this
 * event, for everybody. A custom interest reaching an event is arithmetic over
 * this string, so "Nepal" finds a story headlined for Kathmandu because the
 * shared pass tagged it `nepal`, and no model is asked about any reader.
 *
 * Memoised per candidate object because `decide` runs once per reader per
 * event: without this, a thousand readers would re-normalise the same paragraph
 * a thousand times. The cache is a WeakMap so it dies with the candidate page.
 */
const SIGNALS = new WeakMap<Candidate, string>();

function signalOf(candidate: Candidate): string {
  const cached = SIGNALS.get(candidate);
  if (cached !== undefined) return cached;

  const signal = normaliseText(
    [
      candidate.title,
      candidate.whatHappened,
      ...candidate.tags,
      ...candidate.topics.flatMap((t) => [t.slug, t.label]),
      ...candidate.sources.map((s) => s.name),
    ].join(" "),
  );

  SIGNALS.set(candidate, signal);
  return signal;
}

const TOPIC_SIGNALS = new WeakMap<Candidate, Map<string, string>>();

/**
 * A custom topic cannot be evidence for itself. `event_topics` includes the
 * topic's own slug and label in `Candidate.topics`; feeding those back into its
 * evaluator would make a stale link satisfy a spec derived from that label.
 */
function signalForTopic(candidate: Candidate, topicId: string): string {
  const cached = TOPIC_SIGNALS.get(candidate)?.get(topicId);
  if (cached !== undefined) return cached;

  const signal = customTopicSignal(candidate, topicId);
  const byTopic = TOPIC_SIGNALS.get(candidate) ?? new Map<string, string>();
  byTopic.set(topicId, signal);
  TOPIC_SIGNALS.set(candidate, byTopic);
  return signal;
}

/**
 * Whether one followed topic reaches this event.
 *
 * Three routes, cheapest and most exact first, and none of them a model call.
 */
function selects(
  topic: ReaderTopic,
  candidate: Candidate,
  fields: string[],
  signal: string,
): boolean {
  const topicSignal = topic.kind === "custom" ? signalForTopic(candidate, topic.topicId) : signal;

  // A custom topic's own exclusions come first and veto every route below,
  // including the exact join: an `event_topics` link written by an earlier
  // finalization, before the topic gained an exclusion, must not be a way
  // around it. Predefined topics carry no spec, so this is a no-op for them.
  if (topic.kind === "custom" && topicVetoes(topic, topicSignal)) return false;

  // A custom topic whose stored spec cannot be read selects nothing, on every
  // route -- the fail-closed reading `specForTopic` gives the spec route, held
  // here for the join and the keywords too.
  if (topic.kind === "custom" && specStatus(topic) === "malformed") return false;

  // The exact join the plan asks for. `event_topics` against `user_topics`, on
  // the id — no text comparison can be looser or wrong, and it is what analysis
  // was constrained to write.
  // Predefined topics are editorially assigned and their ids remain
  // authoritative. A custom topic's link records the spec that was in force
  // when it was finalized, though; after an operator edits that spec, the link
  // cannot bypass its current require groups. Re-evaluate custom topics below
  // with the same signal and evaluator as classification.
  if (topic.kind !== "custom" && candidate.topics.some((t) => t.id === topic.topicId)) return true;

  // Free text the reader added to a topic. This is the only channel where
  // spelling matters, so it is the channel `related` exists for.
  if (topic.keywords.some((keyword) => fields.some((f) => related(f, keyword)))) return true;

  // A reader-created interest, which the model was never given the vocabulary
  // to classify. The spec decides: every `require` group must be satisfied and a
  // group may be satisfied by any of its aliases, so "Arsenal" reaches the North
  // London derby while "India vs China" still needs both countries. A topic with
  // no stored spec derives one from its terms, which is the previous AND-over-all
  // behaviour exactly -- see `match-spec.ts`.
  return topic.kind === "custom" && topicMatches(topic, topicSignal);
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
export function decide(
  candidate: Candidate,
  reader: Reader,
  context?: SignificanceContext,
): Verdict {
  // Following nothing must not mean "show everything". This is the bug
  // `src/lib/matching.ts` was written to fix, in its purest form.
  if (reader.topics.length === 0) return { matched: false, reason: "no-topics" };

  // A card mute is the reader's answer to "never send me stories about this
  // topic" — it outranks every topic that could select the event, so it fires
  // before any scoring work. Exact label against the event's own topic links,
  // never the wide signal: that scope is the ruling, and the reason the veto
  // lives beside `no-topics` rather than beside the exclusion pass.
  if (candidate.topics.some((t) => reader.mutedTopics.has(t.label))) {
    return { matched: false, reason: "topic-muted" };
  }

  const fields = haystack(candidate);
  const signal = signalOf(candidate);

  const selected = reader.topics.filter((topic) => selects(topic, candidate, fields, signal));
  if (selected.length === 0) return { matched: false, reason: "no-topic-match" };

  const dial = thresholdFor(reader.density);
  // Two ways to clear a topic's floor, and which one is in force is the feature
  // flag: the shared importance alone (shipped behaviour, no context), or the
  // larger of that and the subject-relative term (`subject-significance.ts`).
  // The second is per-topic on purpose -- a subject-significant development
  // reaches the readers of that subject and nobody else.
  const signalsOf = context
    ? new Map(
        selected.map(
          (t) => [t.topicId, topicSignals(candidate, t, fields, signal, context)] as const,
        ),
      )
    : null;
  const admitting = selected.filter((t) => {
    const signals = signalsOf?.get(t.topicId);
    const score = signals
      ? briefingScore({ importance: candidate.importance, ...signals, novelty: candidate.novelty })
      : candidate.importance;
    return score >= floorFor(t.importance, dial);
  });
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
  //
  // TWO passes, and both are needed. `signal` is the wide text selection used —
  // title, briefing paragraph, concept tags, curated labels, outlet names — so
  // a term that selected this event can always veto it; that is what closes the
  // case of a story whose only mention of "art" was a tag. But `related` floors
  // out loose containment for a term under three characters and lets an exact
  // match through first, and that exact match only ever held when the two sides
  // were one field: excluding "AI" against the joined signal compares "ai"
  // with a paragraph and finds neither equality nor containment. So the narrow
  // per-field pass stays, and the wide one is added rather than substituted.
  const vetoes = [...reader.exclusions, ...selected.flatMap((t) => t.excludeKeywords)];
  if (vetoes.some((term) => related(signal, term) || fields.some((f) => related(f, term)))) {
    return { matched: false, reason: "excluded" };
  }

  return {
    matched: true,
    relevance: relevanceOf(candidate, admitting, reader),
    topics: admitting.map((t) => t.label),
    ...(signalsOf
      ? {
          significance: strongest(
            admitting.flatMap((t) => {
              const signals = signalsOf.get(t.topicId);
              return signals ? [signals] : [];
            }),
          ),
        }
      : {}),
  };
}

/**
 * The P4 signals over every topic that *selected* the event for this reader,
 * whether or not it cleared the floor -- or null if no topic selected it.
 *
 * The shadow's view: it asks what the rule would do for a (reader, event) pair
 * the shipped rule already considered, so selection is the same on both sides
 * and only the floor comparison differs.
 */
export function shadowSignals(
  candidate: Candidate,
  reader: Reader,
  context: SignificanceContext,
): TopicSignals | null {
  const fields = haystack(candidate);
  const signal = signalOf(candidate);
  const selected = reader.topics.filter((topic) => selects(topic, candidate, fields, signal));
  if (selected.length === 0) return null;
  return strongest(selected.map((t) => topicSignals(candidate, t, fields, signal, context)));
}

/** One topic's signals for one event. */
function topicSignals(
  candidate: Candidate,
  topic: ReaderTopic,
  fields: string[],
  signal: string,
  context: SignificanceContext,
): TopicSignals {
  return {
    relevanceStrong: selectionIsStrong(topic, candidate, fields, signal),
    subject: context.significant(candidate.eventId, topic.topicId),
  };
}

/** The firmest of several topics' signals: strong ones first, then the higher score. */
function strongest(signals: readonly TopicSignals[]): TopicSignals {
  const strong = signals.filter((s) => s.relevanceStrong);
  const pool = strong.length > 0 ? strong : signals;
  return {
    relevanceStrong: strong.length > 0,
    subject: pool.reduce((best, s) => Math.max(best, s.subject), 0),
  };
}

/**
 * How firmly one topic selected this event, for the interest-conditional path.
 *
 * The exact join (`event_topics`) and a reader's own keyword are both strong by
 * construction: one is the analysis pass's own answer, and the other is a word
 * the reader attached to the subject. A match spec has to earn it -- see
 * `relevanceStrength`.
 */
function selectionIsStrong(
  topic: ReaderTopic,
  candidate: Candidate,
  fields: string[],
  signal: string,
): boolean {
  if (candidate.topics.some((t) => t.id === topic.topicId)) return true;
  if (topic.keywords.some((keyword) => fields.some((f) => related(f, keyword)))) return true;
  if (topic.kind !== "custom") return false;

  const spec = specForTopic(topic);
  const match = evaluateSpec(spec, signal);
  if (!match.matched) return false;
  return relevanceStrength(spec, match).strong;
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
  const now = options.now ?? new Date();

  // The topic table is read once per run and shared: readers, candidates and
  // the significance baselines all resolve topics from this one map.
  const topics = await topicIndex(db);
  const readers = await loadReaders(db, options, topics);
  const candidates = await loadCandidates(db, options, topics);

  // Interest-conditional admission, if it is on. The flag is read once per run
  // and fails closed; the baselines are built once per run and shared by every
  // reader that follows the same subject. The shadow builds the same context
  // but never lets it decide anything.
  const subjectSignificance = options.subjectSignificance ?? (await subjectSignificanceEnabled(db));
  const wantShadow = options.significanceShadow === true;
  const built =
    subjectSignificance || wantShadow
      ? await significanceContextFor(db, candidates, readers.readers, now)
      : null;
  const context = built?.context ?? null;
  const decisionContext = subjectSignificance ? context : null;

  const outcomes: ReaderOutcome[] = [];
  const shadowRows: SignificanceRow[] = [];
  let inserted = 0;
  let matched = 0;
  let reopened = 0;

  for (const reader of readers.readers) {
    const outcome = await matchReader(
      db,
      reader,
      candidates,
      options,
      decisionContext,
      subjectSignificance,
    );
    outcomes.push(outcome);
    inserted += outcome.inserted;
    matched += outcome.matched;
    reopened += outcome.reopened;
    if (wantShadow && context) {
      shadowRows.push(...(await significanceShadowRows(db, reader, candidates, context)));
    }
  }

  const coverageLinks = options.dryRun
    ? 0
    : await recordObservedCoverage(db, readers.readers, candidates);

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    readers: readers.readers.length,
    paused: readers.paused,
    candidates: candidates.length,
    matched,
    inserted,
    reopened,
    subjectSignificance,
    significanceHistory: built ? (built.historyLoaded ? "loaded" : "unavailable") : "not-needed",
    ...(wantShadow ? { significanceShadow: significanceShadow(shadowRows) } : {}),
    coverageLinks,
    outcomes,
  };
}

/**
 * One shadow row per (reader, event) the shipped rule considered: the event was
 * selected by one of the reader's topics, and either admitted or held below the
 * floor. Selection is identical under both rules, so every row is a pair on
 * which only the rule under test can disagree.
 */
async function significanceShadowRows(
  db: Db,
  reader: Reader,
  candidates: Candidate[],
  context: SignificanceContext,
): Promise<SignificanceRow[]> {
  const considered: { candidate: Candidate; signals: TopicSignals }[] = [];
  for (const candidate of candidates) {
    const shipped = decide(candidate, reader);
    if (!shipped.matched && shipped.reason !== "below-threshold") continue;
    const signals = shadowSignals(candidate, reader, context);
    if (signals) considered.push({ candidate, signals });
  }
  if (considered.length === 0) return [];

  const prior = await existingPairs(
    db,
    reader.userId,
    considered.map(({ candidate }) => candidate.eventId),
  );
  return considered.map(({ candidate, signals }) => ({
    eventId: candidate.eventId,
    importance: candidate.importance,
    novelty: candidate.novelty,
    relevanceStrong: signals.relevanceStrong,
    subject: signals.subject,
    deliveredRevision: prior.get(candidate.eventId)?.delivered_revision ?? null,
    currentRevision: candidate.materialRevision,
  }));
}

/**
 * Whether the interest-conditional rule is enabled, read from the flag table.
 *
 * Fails closed, and noisily: a rule that can admit events the shared score would
 * not is not one to switch on because a query errored. The flag is the same kind
 * of operational switch `source_discovery_enabled` is, read the same way.
 */
async function subjectSignificanceEnabled(db: Db): Promise<boolean> {
  const { data, error } = await db
    .from("feature_flags")
    .select("enabled")
    .eq("key", SUBJECT_SIGNIFICANCE_FLAG)
    .maybeSingle();

  if (error) {
    console.warn(`match: reading ${SUBJECT_SIGNIFICANCE_FLAG} failed: ${error.message}`);
    return false;
  }
  return data?.enabled === true;
}

/**
 * How a reader-created interest turns into demand for shared collection.
 *
 * A custom topic starts with nothing in `source_topics`, so it is invisible to
 * `admin_source_demand` (0020/0030), `events_with_demand` (0021) and
 * `refresh_source_demand` (0031) — the reader has expressed demand and the
 * collector cannot hear it. This closes that loop with evidence rather than
 * guesswork: when a custom topic reaches an event, the outlets that actually
 * reported it are recorded as covering that subject.
 *
 * That is the convergence the architecture depends on. A hundred readers
 * following Nepal produce one set of links onto the handful of feeds that
 * genuinely carry Nepal, and those feeds stay collected because a hundred
 * people want them — not a hundred fetch jobs, not one crawler each.
 *
 * Three things keep it from becoming a second, accidental editorial graph:
 *
 *   - it is set-based over the page already in memory, so it costs one upsert
 *     per run rather than anything per reader;
 *   - `ignoreDuplicates` means an operator's own mapping is never overwritten
 *     by an observation, and re-runs write nothing;
 *   - `OBSERVED_LINK_CAP` bounds a run, so a burst of new interests cannot turn
 *     one match cycle into a bulk write.
 *
 * Nothing here decides to *fetch* anything. It records what was observed; the
 * demand functions and the console decide what to do about it.
 */
async function recordObservedCoverage(
  db: Db,
  readers: Reader[],
  candidates: Candidate[],
): Promise<number> {
  // One entry per distinct custom topic across every reader — the same subject
  // followed by many people is one piece of work, which is the whole point.
  const custom = new Map<string, ReaderTopic>();
  for (const reader of readers) {
    for (const topic of reader.topics) {
      if (topic.kind !== "custom" || topic.terms.length === 0) continue;
      if (!custom.has(topic.topicId)) custom.set(topic.topicId, topic);
    }
  }
  if (custom.size === 0) return 0;

  const seen = new Set<string>();
  const rows: { source_id: string; topic_id: string; confidence: number }[] = [];

  for (const candidate of candidates) {
    if (candidate.sources.length === 0) continue;

    for (const topic of custom.values()) {
      // The same evaluator the reader join uses, so a subject recorded as
      // covered and a subject that matched a reader cannot disagree about what
      // the subject means. `specForTopic` falls back to the derived spec, which
      // is the AND-over-terms behaviour this line used to have.
      if (!topicMatches(topic, signalForTopic(candidate, topic.topicId))) continue;
      for (const source of candidate.sources) {
        const key = `${source.id}:${topic.topicId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          source_id: source.id,
          topic_id: topic.topicId,
          confidence: OBSERVED_CONFIDENCE,
        });
        if (rows.length >= OBSERVED_LINK_CAP) break;
      }
      if (rows.length >= OBSERVED_LINK_CAP) break;
    }
    if (rows.length >= OBSERVED_LINK_CAP) break;
  }

  if (rows.length === 0) return 0;

  const { error } = await db
    .from("source_topics")
    .upsert(rows, { onConflict: "source_id,topic_id", ignoreDuplicates: true });

  // A failed link is not a failed match. The reader has already been given the
  // event; this only affects what gets collected next time, and the next run
  // recomputes it from scratch.
  if (error) {
    console.warn(`match: recording observed coverage failed: ${error.message}`);
    return 0;
  }

  return rows.length;
}

async function matchReader(
  db: Db,
  reader: Reader,
  candidates: Candidate[],
  options: MatchOptions,
  context: SignificanceContext | null,
  subjectSignificance: boolean,
): Promise<ReaderOutcome> {
  const misses: Record<MissReason, number> = {
    "no-topics": 0,
    "no-topic-match": 0,
    "below-threshold": 0,
    "all-sources-muted": 0,
    excluded: 0,
    "topic-muted": 0,
  };

  const hits: { eventId: string; relevance: number; significance?: TopicSignals | undefined }[] =
    [];

  for (const candidate of candidates) {
    const verdict = decide(candidate, reader, context ?? undefined);
    if (verdict.matched)
      hits.push({
        eventId: candidate.eventId,
        relevance: verdict.relevance,
        significance: verdict.significance,
      });
    else misses[verdict.reason] += 1;
  }

  const known = await existingPairs(
    db,
    reader.userId,
    hits.map((h) => h.eventId),
  );
  const fresh = hits.filter((h) => !known.has(h.eventId));

  // Relationships that are closed -- delivered, or aged out -- and whose event
  // has since moved to a revision this reader has not received. Reopening is
  // the only path to re-delivery, it is gated on a revision delta rather than
  // on a re-match, and it is deliberately not an alert: a story that develops
  // over a week is a briefing, not an interruption.
  const revisionOf = new Map(candidates.map((c) => [c.eventId, c.materialRevision] as const));
  const reopened = options.dryRun
    ? []
    : hits.filter((hit) => {
        const prior = known.get(hit.eventId);
        if (!prior) return false;
        if (prior.briefed_at === null && prior.expired_at === null) return false;
        const current = revisionOf.get(hit.eventId) ?? 0;
        return current > prior.delivered_revision;
      });

  for (const hit of reopened.slice(0, REOPEN_CAP)) {
    // One statement per reopened pair, and the cap is what keeps that honest:
    // material transitions are the rarest event in the pipeline, so the common
    // case is an empty list rather than a loop.
    const { error } = await db
      .from("user_events")
      .update({
        relevance: hit.relevance,
        matched_at: (options.now ?? new Date()).toISOString(),
        briefed_at: null,
        expired_at: null,
      })
      .eq("user_id", reader.userId)
      .eq("event_id", hit.eventId);
    if (error) throw new Error(`reopening user_events: ${error.message}`);
  }

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

    if (!options.skipAlerts) {
      const candidateOf = new Map(candidates.map((c) => [c.eventId, c] as const));
      await fireAlerts(db, {
        userId: reader.userId,
        // Every hit carries its revision, so alert suppression is revision-aware
        // (a revision this reader was alerted to stays suppressed; a newer one is
        // reconsidered), and its occurrence clock once the event has materially
        // moved -- the development's time, never the discovery time.
        hits: fresh.map((h) => {
          const candidate = candidateOf.get(h.eventId);
          const revision = candidate?.materialRevision ?? 0;
          return {
            eventId: h.eventId,
            importance: candidate?.importance ?? 0,
            eventAt: candidate
              ? revision > 0
                ? (candidate.materialOccurrenceAt ?? candidate.firstSeenAt)
                : candidate.firstSeenAt
              : null,
            revision,
            // A fresh pair has never been delivered, so reader novelty is 1 --
            // computed, not assumed, so it stays revision-relative if this path
            // ever carries reopened pairs.
            ...(h.significance
              ? { significance: { ...h.significance, novelty: readerNovelty(null, revision) } }
              : {}),
          };
        }),
        subjectSignificance,
        ...(options.now ? { now: options.now } : {}),
        ...(options.email ? { email: options.email } : {}),
        ...(options.telegram ? { telegram: options.telegram } : {}),
        ...(options.push ? { push: options.push } : {}),
      });
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
    reopened: reopened.length,
    misses,
    detail:
      `${hits.length}/${candidates.length} matched at importance >= ${threshold}` +
      (options.dryRun ? " (dry run)" : `, ${fresh.length} new`) +
      (reopened.length > 0 ? `, ${reopened.length} reopened` : ""),
  };
}

/**
 * Which of these events this reader already has, and in what delivery state.
 *
 * The read used to return a bare set of ids, which was enough while a match was
 * final: a pair existed or it did not, and a second run wrote nothing. Material
 * revisions make "exists" insufficient -- the question is now *which revision
 * the reader holds* -- so this returns the delivery state alongside the id.
 * `matched_at` stays stable for pairs that need no action, exactly as before.
 */
type PriorPair = {
  event_id: string;
  briefed_at: string | null;
  expired_at: string | null;
  delivered_revision: number;
};

async function existingPairs(
  db: Db,
  userId: string,
  eventIds: string[],
): Promise<Map<string, PriorPair>> {
  const found = new Map<string, PriorPair>();

  for (const chunk of chunked(eventIds, IN_CHUNK)) {
    const { data, error } = await db
      .from("user_events")
      .select("event_id, briefed_at, expired_at, delivered_revision")
      .eq("user_id", userId)
      .in("event_id", chunk);

    if (error) throw new Error(`reading user_events: ${error.message}`);
    for (const row of (data ?? []) as PriorPair[]) found.set(row.event_id, row);
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
/** Rows bucketed by the reader they belong to, in one pass. */
function groupByUser<T extends { user_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = out.get(row.user_id);
    if (bucket) bucket.push(row);
    else out.set(row.user_id, [row]);
  }
  return out;
}

type PageResponse<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

async function readPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + READ_PAGE_SIZE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
}

async function readUserPages<T>(
  userIds: string[],
  fetchPage: (ids: string[], from: number, to: number) => PromiseLike<PageResponse<T>>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (const ids of chunked(userIds, IN_CHUNK)) {
    rows.push(...(await readPages((from, to) => fetchPage(ids, from, to), what)));
  }
  return rows;
}

export async function loadReaders(
  db: Db,
  options: MatchOptions,
  topicMap?: Map<string, IndexedTopic>,
): Promise<{ readers: Reader[]; paused: number }> {
  const rows = options.userIds
    ? await readUserPages(
        options.userIds,
        (ids, from, to) =>
          db
            .from("notification_preferences")
            .select("user_id, density, paused")
            .in("user_id", ids)
            .order("user_id")
            .range(from, to),
        "reading notification_preferences",
      )
    : await readPages(
        (from, to) =>
          db
            .from("notification_preferences")
            .select("user_id, density, paused")
            .order("user_id")
            .range(from, to),
        "reading notification_preferences",
      );
  const wanted = options.includePaused ? rows : rows.filter((r) => !r.paused);
  const paused = rows.length - wanted.length;
  if (wanted.length === 0) return { readers: [], paused };

  const userIds = wanted.map((r) => r.user_id);
  const topics = topicMap ?? (await topicIndex(db));

  const [followed, exclusions, sourcePrefs, subs, mutedTopics] = await Promise.all([
    readUserPages(
      userIds,
      (ids, from, to) =>
        db
          .from("user_topics")
          .select("user_id, topic_id, importance, weight, keywords, exclude_keywords, created_at")
          .in("user_id", ids)
          .order("user_id")
          .order("topic_id")
          // The keyword caps below slice stored arrays by position, so the
          // array order has to be the order the terms were saved in — Postgres
          // keeps jsonb array order, this line just makes that promise legible.
          .range(from, to),
      "reading user_topics",
    ),
    readUserPages(
      userIds,
      (ids, from, to) =>
        db
          .from("user_exclusions")
          .select("user_id, term")
          .in("user_id", ids)
          .order("user_id")
          .order("term")
          .range(from, to),
      "reading user_exclusions",
    ),
    readUserPages(
      userIds,
      (ids, from, to) =>
        db
          .from("user_source_prefs")
          .select("user_id, source_id, pref, created_at")
          .in("user_id", ids)
          .order("user_id")
          .order("source_id")
          .range(from, to),
      "reading user_source_prefs",
    ),
    readUserPages(
      userIds,
      (ids, from, to) =>
        db
          .from("subscriptions")
          .select("user_id, plan")
          .in("user_id", ids)
          .order("user_id")
          .range(from, to),
      "reading subscriptions",
    ),
    readUserPages(
      userIds,
      (ids, from, to) =>
        db
          .from("muted_topics")
          .select("user_id, topic")
          .in("user_id", ids)
          .order("user_id")
          .order("topic")
          .range(from, to),
      "reading muted_topics",
    ),
  ]);
  const planOf = new Map<string, PlanTier>(subs.map((row) => [row.user_id, row.plan] as const));

  // Indexed once rather than filtered per reader. These two used to be
  // `.filter(r => r.user_id === row.user_id)` inside the map below, which is
  // O(readers x rows): a thousand readers holding fifteen topics each is
  // fifteen million comparisons per run, and it grows with the square of
  // signups. Matching is already the stage nearest the Workers CPU limit, so
  // the scan that costs nothing at ten readers is the one that ends the run at
  // ten thousand.
  const followedBy = groupByUser(followed ?? []);
  const sourcePrefsBy = groupByUser(sourcePrefs ?? []);
  const exclusionsBy = groupByUser(exclusions ?? []);
  const mutedBy = groupByUser(mutedTopics ?? []);

  const readers = wanted.map((row) => {
    const plan = planOf.get(row.user_id) ?? "uno";
    const mine = (followedBy.get(row.user_id) ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const cap = PLAN_LIMITS[plan]?.topics ?? PLAN_LIMITS.uno.topics;
    const active = clipLabels(mine, cap);
    const mineSourcePrefs = sourcePrefsBy.get(row.user_id) ?? [];
    const priorityCap = PLAN_LIMITS[plan]?.prioritySources ?? PLAN_LIMITS.uno.prioritySources;
    const activePriority = new Set(
      clipLabels(
        mineSourcePrefs
          .filter((p) => p.pref === "priority")
          .slice()
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
        priorityCap,
      ).map((p) => p.source_id),
    );
    const effectiveSourcePrefs: [string, SourcePref][] = [];
    for (const pref of mineSourcePrefs) {
      if (pref.pref === "muted") effectiveSourcePrefs.push([pref.source_id, "muted"]);
      else if (pref.pref === "priority" && activePriority.has(pref.source_id)) {
        effectiveSourcePrefs.push([pref.source_id, "priority"]);
      }
    }

    return {
      userId: row.user_id,
      density: row.density,
      topics: active.flatMap<ReaderTopic>((f) => {
        const topic = topics.get(f.topic_id);
        // A followed topic whose row has gone is not an error and not a match.
        if (!topic) return [];
        // There used to be a second gate here dropping any topic outside
        // `TOPIC_POOL`. It was the last of the four that made a reader-created
        // interest unmatchable, and it is gone deliberately: a custom topic
        // reaches events through `terms`, which the loop below now carries.
        return [
          {
            topicId: f.topic_id,
            slug: topic.slug,
            label: topic.label,
            kind: topic.kind,
            terms: topic.terms,
            spec: topic.spec,
            // The dial is a Plura+ entitlement: basic plans match on the shared
            // importance alone. Nothing is written back — a reader who drops to
            // a plan without the dial goes quiet, not destroyed.
            importance:
              PLAN_LIMITS[plan].notificationControl === "basic" ? "notable" : f.importance,
            weight: f.weight,
            // Keyword terms are now an every-plan entitlement, capped per plan
            // (4/50/100, one pool across both directions). Rows keep whatever a
            // richer plan saved: the cap is applied here, at read time, in the
            // row's stored order — deterministic, never destructive. The combined
            // pool mirrors the save-time counter: prioritize and exclude are one
            // allowance.
            ...clipKeywordPool(f.keywords, f.exclude_keywords, PLAN_LIMITS[plan].topicKeywords),
          },
        ];
      }),
      exclusions: keepUsableExclusions((exclusionsBy.get(row.user_id) ?? []).map((e) => e.term))
        .kept,
      mutedTopics: new Set((mutedBy.get(row.user_id) ?? []).map((m) => m.topic)),
      sourcePrefs: new Map(effectiveSourcePrefs),
    };
  });

  return { readers, paused };
}

/**
 * The per-plan keyword pool, applied at read time.
 *
 * Prioritize and exclude share one allowance (the save-side counter counts
 * them together), and prioritize draws from it first — the order the panel
 * presents them in. The slice is always a prefix of the stored arrays, so the
 * result is deterministic and the stored rows are never rewritten: a reader
 * who downgrades goes quiet on the extra terms, and everything returns the
 * moment they upgrade again.
 */
export function clipKeywordPool(
  keywords: string[],
  excludeKeywords: string[],
  cap: number,
): { keywords: string[]; excludeKeywords: string[] } {
  if (keywords.length + excludeKeywords.length <= cap) return { keywords, excludeKeywords };
  const keepKeywords = Math.min(keywords.length, cap);
  return {
    keywords: keywords.slice(0, keepKeywords),
    excludeKeywords: excludeKeywords.slice(0, Math.max(0, cap - keepKeywords)),
  };
}

type IndexedTopic = {
  slug: string;
  label: string;
  kind: TopicKind;
  terms: string[];
  /** The stored `match_spec`, unparsed: `specForTopic` decides what it means. */
  spec: unknown;
};

async function topicIndex(db: Db): Promise<Map<string, IndexedTopic>> {
  const data = await readPages(
    (from, to) =>
      db
        .from("topics")
        .select("id, slug, label, kind, terms, match_spec")
        .order("id")
        .range(from, to),
    "reading topics",
  );
  return new Map(
    data.map(
      (t) =>
        [
          t.id,
          { slug: t.slug, label: t.label, kind: t.kind, terms: t.terms, spec: t.match_spec },
        ] as const,
    ),
  );
}

/**
 * Topic-relative baselines, computed once per run and shared by every reader.
 *
 * The whole cost argument for this product is that shared work happens once, so
 * subject significance is not per reader: one observation set per event, one
 * history per relevant topic, and a memo per (event, topic) pair. A thousand
 * readers following Rust pay for this once.
 *
 * The baseline is the subject's **own history**, read from the database
 * (`subject_history`, 0103): each relevant topic's most recent complete events
 * over `SUBJECT_HISTORY_DAYS`, at most `SUBJECT_HISTORY_PER_TOPIC` of them,
 * plus whatever this run's candidates the topic selects. The first version used
 * only the current candidate page, so a topic with fewer than
 * `MIN_BASELINE_EVENTS` events in one run scored zero and the baseline moved
 * every run.
 *
 * An event is never part of its own baseline (`historyWithout`): a marker that
 * only it carries must read as a first occurrence, not as "seen once".
 */
export type SignificanceContext = {
  observations: Map<string, SubjectObservations>;
  history: Map<string, SubjectHistory>;
  /** The event ids each topic's history was built from. */
  members: Map<string, Set<string>>;
  /** The subject score for one (event, topic) pair, computed at most once. */
  significant: (eventId: string, topicId: string) => number;
};

/** How far back a subject's own history reaches. */
export const SUBJECT_HISTORY_DAYS = 90;

/** Events per subject in the baseline: enough for a percentile, bounded per topic. */
export const SUBJECT_HISTORY_PER_TOPIC = 60;

/** Topics per `subject_history` call. */
const HISTORY_TOPIC_CHUNK = 100;

/** One row of `subject_history`. */
export type SubjectHistoryRow = {
  topic_id: string;
  event_id: string;
  title: string;
  what_happened: string;
  topic_kind?: string;
  tags?: string[];
  other_topics?: unknown;
  source_names?: string[];
};

const EMPTY_HISTORY: SubjectHistory = { markerCounts: new Map(), magnitudes: [], events: 0 };

/**
 * Which followed topics could be asked for a subject score this run, and which
 * of this run's candidates each one selects.
 *
 * Scoped, and that is the point: a topic enters only if somebody follows it and
 * it selects at least one candidate -- by the editorial join, or, for a custom
 * topic, by its own spec. The spec is evaluated for followed custom topics only,
 * so the cost is candidates x followed custom topics, never candidates x the
 * whole catalogue. (A topic reached only through a reader's private keyword has
 * no entry and scores 0: that route is the reader's, not the subject's.)
 */
export function relevantTopics(
  candidates: readonly Candidate[],
  readers: readonly Reader[],
): Map<string, Set<string>> {
  const followed = new Map<string, ReaderTopic>();
  for (const reader of readers) for (const t of reader.topics) followed.set(t.topicId, t);
  const custom = [...followed.values()].filter((t) => t.kind === "custom");

  const selections = new Map<string, Set<string>>();
  const add = (topicId: string, eventId: string) => {
    const set = selections.get(topicId) ?? new Set<string>();
    set.add(eventId);
    selections.set(topicId, set);
  };

  for (const candidate of candidates) {
    for (const linked of candidate.topics) {
      const topic = followed.get(linked.id);
      if (
        topic &&
        (topic.kind !== "custom" || topicMatches(topic, signalForTopic(candidate, topic.topicId)))
      )
        add(topic.topicId, candidate.eventId);
    }
    if (custom.length === 0) continue;
    for (const topic of custom) {
      if (topicMatches(topic, signalForTopic(candidate, topic.topicId)))
        add(topic.topicId, candidate.eventId);
    }
  }
  return selections;
}

/**
 * The baselines for one run, from this run's selections and the subjects' own
 * history. Pure, so the rule is testable without a database.
 */
export function buildSignificanceContext(
  candidates: readonly Candidate[],
  selections: ReadonlyMap<string, ReadonlySet<string>>,
  historyRows: readonly SubjectHistoryRow[],
): SignificanceContext {
  const observations = new Map<string, SubjectObservations>();
  for (const candidate of candidates) {
    observations.set(
      candidate.eventId,
      observationsFor(`${candidate.title}\n${candidate.whatHappened}`),
    );
  }
  for (const row of historyRows) {
    if (!observations.has(row.event_id)) {
      observations.set(row.event_id, observationsFor(`${row.title}\n${row.what_happened}`));
    }
  }

  const members = new Map<string, Set<string>>();
  for (const [topicId, eventIds] of selections) members.set(topicId, new Set(eventIds));
  for (const row of historyRows) {
    const set = members.get(row.topic_id) ?? new Set<string>();
    set.add(row.event_id);
    members.set(row.topic_id, set);
  }

  const history = new Map<string, SubjectHistory>();
  for (const [topicId, eventIds] of members) {
    const seen = [...eventIds].flatMap((id) => {
      const observation = observations.get(id);
      return observation ? [observation] : [];
    });
    history.set(topicId, historyFrom(seen));
  }

  const memo = new Map<string, number>();
  return {
    observations,
    history,
    members,
    significant: (eventId, topicId) => {
      const key = `${eventId}:${topicId}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const observation = observations.get(eventId);
      let score = 0;
      if (observation) {
        const full = history.get(topicId) ?? EMPTY_HISTORY;
        const own = members.get(topicId)?.has(eventId) === true;
        score = subjectSignificance(
          observation,
          own ? historyWithout(full, observation) : full,
        ).score;
      }
      memo.set(key, score);
      return score;
    },
  };
}

/**
 * The subjects' own history, for the topics that can be asked about this run.
 *
 * One bounded RPC per hundred topics. A failed read is not a failed match: the
 * context is built with no history, every subject score is then 0, and the rule
 * can lift nothing -- exactly the shipped behaviour -- while the report says the
 * history was unavailable.
 */
async function significanceContextFor(
  db: Db,
  candidates: Candidate[],
  readers: Reader[],
  now: Date,
): Promise<{ context: SignificanceContext; historyLoaded: boolean }> {
  const selections = relevantTopics(candidates, readers);
  const topicIds = [...selections.keys()];
  const since = new Date(now.getTime() - SUBJECT_HISTORY_DAYS * 24 * 3_600_000).toISOString();

  const rows: SubjectHistoryRow[] = [];
  let historyLoaded = true;
  for (const chunk of chunked(topicIds, HISTORY_TOPIC_CHUNK)) {
    const { data, error } = await db.rpc("subject_history", {
      p_topic_ids: chunk,
      p_since: since,
      p_per_topic: SUBJECT_HISTORY_PER_TOPIC,
    });
    if (error) {
      console.warn(`match: reading subject history failed: ${error.message}`);
      historyLoaded = false;
      rows.length = 0;
      break;
    }
    rows.push(...((data ?? []) as SubjectHistoryRow[]));
  }

  const topicById = new Map<string, ReaderTopic>();
  for (const reader of readers) {
    for (const topic of reader.topics) topicById.set(topic.topicId, topic);
  }
  const currentRows = rows.filter((row) => {
    const topic = topicById.get(row.topic_id);
    if (!topic || topic.kind !== "custom") return true;
    const otherTopics = Array.isArray(row.other_topics)
      ? row.other_topics.flatMap((value) => {
          if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
          const item = value as { id?: unknown; slug?: unknown; label?: unknown };
          return typeof item.id === "string" &&
            typeof item.slug === "string" &&
            typeof item.label === "string"
            ? [{ id: item.id, slug: item.slug, label: item.label }]
            : [];
        })
      : [];
    const signal = customTopicSignal(
      {
        title: row.title,
        whatHappened: row.what_happened,
        tags: row.tags ?? [],
        topics: otherTopics,
        sources: (row.source_names ?? []).map((name) => ({ name })),
      },
      topic.topicId,
    );
    return topicMatches(topic, signal);
  });

  return {
    context: historyLoaded
      ? buildSignificanceContext(candidates, selections, currentRows)
      : buildSignificanceContext(candidates, new Map(), []),
    historyLoaded,
  };
}

/**
 * The events that could reach anybody.
 *
 * `analysed_at is not null` is the gate, and it is the same one analysis uses in
 * reverse. An event that has not been read has no importance to compare against a
 * threshold and no topics to join, so matching it would be matching a placeholder.
 */
type CandidateEventRow = {
  id: string;
  title: string;
  what_happened: string;
  importance: number;
  novelty: number;
  tags: string[];
  first_seen_at: string;
  analysed_at: string | null;
  material_revision: number;
  material_occurrence_at: string | null;
  last_material_change_at: string | null;
};

/** The fields every candidate query reads. */
const CANDIDATE_COLUMNS =
  "id, title, what_happened, importance, novelty, tags, analysed_at, first_seen_at, material_revision, material_occurrence_at, last_material_change_at";

/**
 * When a candidate actually happened, for ordering and for freshness.
 *
 * A materially revised event is dated by its occurrence clock -- when the
 * evidence for its current state was published -- and everything else by when
 * the world first saw it. That is the one line that stops a late-discovered
 * development from being presented as newer than it is.
 */
function effectiveAt(event: CandidateEventRow): number {
  const occurrence = event.material_occurrence_at ?? event.first_seen_at;
  const parsed = Date.parse(occurrence);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadCandidates(
  db: Db,
  options: MatchOptions,
  topics: Map<string, IndexedTopic>,
): Promise<Candidate[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? CANDIDATES;

  // The candidate window is the WIDEST cadence's horizon, not the 72-hour work
  // horizon, and the clock is the occurrence clock.
  //
  // Two reasons, both from the same principle. The work horizon answers "what
  // should we spend analysis on"; this stage answers "what could reach a
  // reader", and what can reach a reader is whatever the briefing lanes would
  // accept -- the widest of which is the weekly band. Gating candidates on a
  // narrower window meant a late-discovered development could be analysed and
  // then never matched, which is the dead end this architecture removes.
  //
  // The occurrence clock, not `first_seen_at`, is what makes that safe: an event
  // whose current-state evidence is a week old is selected with a week-old
  // timestamp, so the lanes age it honestly rather than treating late discovery
  // as fresh news.
  const windowSince = new Date(now.getTime() - MAX_WEEKLY_AGE_HOURS * 3_600_000).toISOString();
  const fetchLimit = options.sinceHours === undefined ? limit : limit * 3;
  const base = () =>
    db
      .from("events")
      .select(CANDIDATE_COLUMNS)
      .not("analysed_at", "is", null)
      .eq("status", "complete");

  // Two lanes, merged, rather than one predicate over a coalesce: PostgREST
  // cannot express `coalesce(a, b) >= x`, and splitting it keeps each filter on a
  // column that is always populated -- `first_seen_at` is not null, and a
  // materially revised event always has an occurrence clock (the revision is
  // what wrote it). An event that has never been revised and is older than the
  // window is genuinely outside every cadence, so it is not a candidate.
  const [byFirstSeen, byOccurrence] = await Promise.all([
    base()
      .gte("first_seen_at", windowSince)
      .order("first_seen_at", { ascending: false })
      .limit(fetchLimit),
    base()
      .gt("material_revision", 0)
      .gte("material_occurrence_at", windowSince)
      .order("material_occurrence_at", { ascending: false })
      .limit(fetchLimit),
  ]);
  if (byFirstSeen.error) throw new Error(`reading events: ${byFirstSeen.error.message}`);
  if (byOccurrence.error) throw new Error(`reading revised events: ${byOccurrence.error.message}`);

  const merged = new Map<string, CandidateEventRow>();
  for (const event of (byFirstSeen.data ?? []) as CandidateEventRow[]) merged.set(event.id, event);
  for (const event of (byOccurrence.data ?? []) as CandidateEventRow[]) {
    if (!merged.has(event.id)) merged.set(event.id, event);
  }
  let rows = [...merged.values()];

  // "Established within N hours": analysed then for an event that has never
  // been revised, discovered then for one that has. Applied in memory because it
  // spans two columns and the page is already bounded; the over-fetch above is
  // what keeps the cap honest after filtering.
  if (options.sinceHours !== undefined) {
    const since = now.getTime() - options.sinceHours * 3_600_000;
    rows = rows.filter((event) => {
      const at =
        event.material_revision > 0
          ? (event.last_material_change_at ?? event.analysed_at)
          : event.analysed_at;
      const parsed = at === null ? Number.NaN : Date.parse(at);
      return Number.isFinite(parsed) && parsed >= since;
    });
  }

  const events = rows
    .sort((a, b) => effectiveAt(b) - effectiveAt(a) || a.id.localeCompare(b.id))
    .slice(0, limit);

  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const sources = await sourceIndex(db);

  const eventTopics = new Map<string, CandidateTopic[]>();
  const eventSources = new Map<string, CandidateSource[]>();
  /**
   * Events that still have at least one live article.
   *
   * An event whose articles have all moved elsewhere — which is what merging
   * two outlets' coverage of one story does to the loser — or lost them to
   * retention has no reporting behind it: its story page would have no sources
   * to open, no evidence to compose from, and its stored summary would be
   * describing coverage nyuz no longer holds. It stays in the database with its
   * analysis so a briefing already sent still renders, but it must not reach a
   * reader who has not seen it, so it is not a candidate.
   */
  const withArticles = new Set<string>();

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
      // Counted before the source checks below: an event's articles can all
      // have unknown sources and it still has reporting behind it. What makes an
      // event unmatched is having no articles at all.
      if (article.event_id !== null) withArticles.add(article.event_id);
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

  return events
    .filter((event) => withArticles.has(event.id))
    .map((event) => ({
      eventId: event.id,
      title: event.title,
      whatHappened: event.what_happened,
      importance: event.importance,
      novelty: event.novelty,
      firstSeenAt: event.first_seen_at,
      materialRevision: event.material_revision ?? 0,
      materialOccurrenceAt: event.material_occurrence_at ?? null,
      // Empty for every event analysed before 0049. Those stay reachable through
      // their title and briefing paragraph rather than being re-analysed, which
      // would cost the corpus twice to populate a matching aid.
      tags: event.tags,
      topics: eventTopics.get(event.id) ?? [],
      sources: eventSources.get(event.id) ?? [],
    }));
}

async function sourceIndex(db: Db): Promise<Map<string, string>> {
  const data = await readPages(
    (from, to) => db.from("sources").select("id, name").order("id").range(from, to),
    "reading sources",
  );
  return new Map(data.map((s) => [s.id, s.name] as const));
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
      "topic-muted": 0,
    },
  );

  const reasons = (Object.entries(misses) as [MissReason, number][])
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ");

  return (
    `match: ${report.readers} readers x ${report.candidates} events, ` +
    `${report.matched} matched, ${report.inserted} new, ` +
    (report.reopened > 0 ? `${report.reopened} reopened, ` : "") +
    `${report.paused} paused, ${report.coverageLinks} coverage links, ${seconds}s` +
    (reasons ? ` | misses: ${reasons}` : "")
  );
}
