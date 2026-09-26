/**
 * Every write to `topics.match_spec`, in one place.
 *
 * ---------------------------------------------------------------------------
 * The lifecycle
 * ---------------------------------------------------------------------------
 *
 *   creation     a reader's new custom topic is inserted with the spec derived
 *                from its own `terms` -- source `derived`. Semantically identical
 *                to the `{}` every older row holds (both evaluate as
 *                `deriveSpecFromTerms(terms)`), but now recorded, dated and
 *                visible, so the console can tell a derived interest from one an
 *                operator or the evidence has shaped.
 *   authoring    an operator writes an explicit spec (aliases, exclusions,
 *                optional boosters) -- source `enriched`. Validated with
 *                `validateAuthoredSpec` before it is stored; a malformed value is
 *                refused, never stored and never "repaired".
 *   promotion    an optional term that the topic's own coverage kept confirming
 *                is moved into the require group it aliases -- source stays
 *                `enriched`. Evidence is recomputed server-side at the moment of
 *                acceptance; the caller only names which candidates to accept.
 *   reset        back to `{}`: derive from `terms`, source null.
 *
 * Reads go through `specForTopic`, which every matching stage calls. That is the
 * whole contract: what is written here is what classification, finalization,
 * the reader join, observed coverage and the backfill all evaluate.
 *
 * Only custom topics carry a spec. The editorial pool reaches events through
 * `TOPIC_KEYWORDS` and `event_topics`; a spec on a predefined row would be read
 * by classification and ignored by the reader join, which is two rules for one
 * topic -- so the writes below refuse it.
 *
 * ---------------------------------------------------------------------------
 * Concurrency
 * ---------------------------------------------------------------------------
 *
 * Writes are compare-and-set on `match_spec_updated_at`: an operator editing a
 * spec that a promotion just changed gets an error instead of silently undoing
 * it. No background job writes here -- promotion is an operator action -- so a
 * conflict is two people, and telling one of them is the right answer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { normaliseText } from "@/lib/topics";
import {
  customTopicSignal,
  deriveSpecFromTerms,
  isEmptySpec,
  parseMatchSpec,
  promoteTerms,
  promotionCandidates,
  specForTopic,
  termEvidence,
  validateAuthoredSpec,
  type EvidenceObservation,
  type MatchSpec,
  type MatchTerm,
  type TermEvidence,
} from "@/lib/match-spec";

type Db = SupabaseClient<Database>;

export type MatchSpecSource = "derived" | "enriched";

export class MatchSpecError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500 = 400,
  ) {
    super(message);
    this.name = "MatchSpecError";
  }
}

/** The three columns, always written together. */
export type SpecColumns = {
  match_spec: Json;
  match_spec_source: MatchSpecSource | null;
  match_spec_updated_at: string;
};

function columns(spec: MatchSpec | null, source: MatchSpecSource | null, now: Date): SpecColumns {
  return {
    // A plain JSON round trip: the spec is data, and nothing undefined-valued
    // may reach the column.
    match_spec: (spec === null ? {} : JSON.parse(JSON.stringify(spec))) as Json,
    match_spec_source: source,
    match_spec_updated_at: now.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

export type NewTopic = { slug: string; label: string; predefined: boolean; terms: string[] };

/**
 * The row `preferences.ts` inserts for a topic nobody has created yet.
 *
 * Predefined rows keep `terms = []` and `{}`: they reach events through
 * `event_topics`, and giving them terms or a spec would widen the editorial list
 * by a side effect. A custom row stores the spec derived from exactly the terms
 * it is created with, so `specForTopic` reads the same value it would have
 * derived -- the equivalence `match-spec.test.ts` asserts over a corpus.
 */
export function newTopicRow(topic: NewTopic, createdBy: string, now: Date) {
  const base = {
    slug: topic.slug,
    label: topic.label,
    kind: topic.predefined ? ("predefined" as const) : ("custom" as const),
    terms: topic.predefined ? [] : topic.terms,
    created_by: createdBy,
  };
  if (topic.predefined) return base;
  return { ...base, ...columns(deriveSpecFromTerms(topic.terms), "derived", now) };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

type TopicSpecRow = {
  id: string;
  kind: string;
  label: string;
  terms: string[];
  match_spec: unknown;
  match_spec_source: string | null;
  match_spec_updated_at: string | null;
};

async function readTopic(db: Db, topicId: string): Promise<TopicSpecRow> {
  const { data, error } = await db
    .from("topics")
    .select("id, kind, label, terms, match_spec, match_spec_source, match_spec_updated_at")
    .eq("id", topicId)
    .maybeSingle();
  if (error) throw new MatchSpecError(`reading topic: ${error.message}`, 500);
  if (!data) throw new MatchSpecError("Topic not found.", 404);
  const row = data as TopicSpecRow;
  if (row.kind !== "custom") {
    throw new MatchSpecError(
      "Only reader-created topics carry a match specification; the editorial pool is matched by its keyword list.",
    );
  }
  return row;
}

/**
 * Compare-and-set on `match_spec_updated_at`, so a concurrent edit is a
 * conflict rather than a lost update.
 */
async function writeColumns(db: Db, row: TopicSpecRow, patch: SpecColumns): Promise<void> {
  let query = db.from("topics").update(patch).eq("id", row.id);
  query =
    row.match_spec_updated_at === null
      ? query.is("match_spec_updated_at", null)
      : query.eq("match_spec_updated_at", row.match_spec_updated_at);
  const { data, error } = await query.select("id");
  if (error) throw new MatchSpecError(`writing match spec: ${error.message}`, 500);
  if (!data || data.length === 0) {
    throw new MatchSpecError("The specification changed while you were editing it.", 409);
  }
}

/* -------------------------------------------------------------------------- */
/* Authoring and reset                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Store an operator-authored specification. Refuses anything that does not pass
 * `validateAuthoredSpec` -- a malformed spec is an error at the door, never a
 * stored value that matching has to cope with.
 */
export async function writeTopicMatchSpec(
  db: Db,
  topicId: string,
  value: unknown,
  now: Date,
): Promise<MatchSpec> {
  const validated = validateAuthoredSpec(value);
  if (!validated.ok) throw new MatchSpecError(`Invalid match specification: ${validated.reason}`);
  const row = await readTopic(db, topicId);
  await writeColumns(db, row, columns(validated.spec, "enriched", now));
  return validated.spec;
}

/** Back to "derive from `terms`" -- the behaviour before 0100. */
export async function resetTopicMatchSpec(db: Db, topicId: string, now: Date): Promise<void> {
  const row = await readTopic(db, topicId);
  await writeColumns(db, row, columns(null, null, now));
}

/* -------------------------------------------------------------------------- */
/* Promotion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Events read per topic as promotion evidence. Bounded so an operator action on
 * a busy subject is a few queries, not a scan of its history.
 */
export const PROMOTION_EVIDENCE_EVENTS = 200;

const IN_CHUNK = 100;

export type PromotionReport = {
  topicId: string;
  spec: MatchSpec;
  /** Evidence per optional term, keyed by normalised text. */
  evidence: Record<string, TermEvidence>;
  /** Optional terms that have earned promotion right now. */
  candidates: MatchTerm[];
};

/**
 * What the topic's own coverage says about its optional terms.
 *
 * The observations are the events already linked to the topic in
 * `event_topics`, read with the same fields the reader join matches against.
 * Engagement is a *follower of this topic* having engaged with the event
 * (`user_events.engaged_at`), so one reader's interest in a story reached
 * through some other topic cannot promote a name for this one.
 */
export async function promotionEvidence(db: Db, topicId: string): Promise<PromotionReport> {
  return evidenceFor(db, await readTopic(db, topicId));
}

async function evidenceFor(db: Db, row: TopicSpecRow): Promise<PromotionReport> {
  const topicId = row.id;
  if (!isEmptySpec(row.match_spec) && !parseMatchSpec(row.match_spec).ok) {
    throw new MatchSpecError("The stored specification is malformed; fix it before promoting.");
  }
  const spec = specForTopic(row);
  const empty: PromotionReport = { topicId, spec, evidence: {}, candidates: [] };
  if ((spec.optional ?? []).length === 0) return empty;

  const links = await db
    .from("event_topics")
    .select("event_id")
    .eq("topic_id", topicId)
    .order("event_id", { ascending: false })
    .limit(PROMOTION_EVIDENCE_EVENTS);
  if (links.error) throw new MatchSpecError(`reading event_topics: ${links.error.message}`, 500);
  const eventIds = [...new Set((links.data ?? []).map((link) => link.event_id))];
  if (eventIds.length === 0) return empty;

  const followers = await db.from("user_topics").select("user_id").eq("topic_id", topicId);
  if (followers.error) {
    throw new MatchSpecError(`reading followers: ${followers.error.message}`, 500);
  }
  const followerIds = new Set((followers.data ?? []).map((f) => f.user_id));

  const [topicLinks, articleLinks] = await Promise.all([
    db.from("event_topics").select("event_id, topic_id").in("event_id", eventIds),
    db
      .from("articles")
      .select("event_id, source_id")
      .in("event_id", eventIds)
      .not("source_id", "is", null),
  ]);
  if (topicLinks.error) {
    throw new MatchSpecError(`reading linked topics: ${topicLinks.error.message}`, 500);
  }
  if (articleLinks.error) {
    throw new MatchSpecError(`reading article sources: ${articleLinks.error.message}`, 500);
  }
  const relatedTopicIds = [...new Set((topicLinks.data ?? []).map((link) => link.topic_id))];
  const sourceIds = [...new Set((articleLinks.data ?? []).map((link) => link.source_id))];
  const [relatedTopics, sources] = await Promise.all([
    lookupTopicNames(db, relatedTopicIds),
    lookupSourceNames(db, sourceIds),
  ]);
  const topicsByEvent = new Map<string, { id: string; slug: string; label: string }[]>();
  for (const link of topicLinks.data ?? []) {
    const topic = relatedTopics.get(link.topic_id);
    if (!topic) continue;
    const bucket = topicsByEvent.get(link.event_id) ?? [];
    bucket.push(topic);
    topicsByEvent.set(link.event_id, bucket);
  }
  const sourcesByEvent = new Map<string, { name: string }[]>();
  for (const link of articleLinks.data ?? []) {
    if (!link.event_id || !link.source_id) continue;
    const name = sources.get(link.source_id);
    if (!name) continue;
    const bucket = sourcesByEvent.get(link.event_id) ?? [];
    if (!bucket.some((source) => source.name === name)) bucket.push({ name });
    sourcesByEvent.set(link.event_id, bucket);
  }

  const observations: EvidenceObservation[] = [];
  for (let i = 0; i < eventIds.length; i += IN_CHUNK) {
    const chunk = eventIds.slice(i, i + IN_CHUNK);
    const [events, engaged] = await Promise.all([
      db.from("events").select("id, title, what_happened, tags").in("id", chunk),
      db
        .from("user_events")
        .select("event_id, user_id")
        .in("event_id", chunk)
        .not("engaged_at", "is", null),
    ]);
    if (events.error) throw new MatchSpecError(`reading events: ${events.error.message}`, 500);
    if (engaged.error) {
      throw new MatchSpecError(`reading engagement: ${engaged.error.message}`, 500);
    }
    const engagedEvents = new Set(
      (engaged.data ?? []).filter((row) => followerIds.has(row.user_id)).map((row) => row.event_id),
    );
    for (const event of events.data ?? []) {
      observations.push({
        eventId: event.id,
        signal: customTopicSignal(
          {
            title: event.title,
            whatHappened: event.what_happened,
            tags: event.tags ?? [],
            topics: topicsByEvent.get(event.id) ?? [],
            sources: sourcesByEvent.get(event.id) ?? [],
          },
          topicId,
        ),
        engaged: engagedEvents.has(event.id),
      });
    }
  }

  const evidence = termEvidence(spec, observations);
  return {
    topicId,
    spec,
    evidence: Object.fromEntries(evidence),
    candidates: promotionCandidates(spec, evidence),
  };
}

async function lookupTopicNames(
  db: Db,
  ids: string[],
): Promise<Map<string, { id: string; slug: string; label: string }>> {
  const output = new Map<string, { id: string; slug: string; label: string }>();
  for (let offset = 0; offset < ids.length; offset += IN_CHUNK) {
    const chunk = ids.slice(offset, offset + IN_CHUNK);
    const { data, error } = await db.from("topics").select("id, slug, label").in("id", chunk);
    if (error) throw new MatchSpecError(`reading topics: ${error.message}`, 500);
    for (const row of data ?? []) {
      output.set(row.id, { id: row.id, slug: row.slug, label: row.label });
    }
  }
  return output;
}

async function lookupSourceNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  const sourceIds = ids.filter((id): id is string => id !== null);
  for (let offset = 0; offset < sourceIds.length; offset += IN_CHUNK) {
    const chunk = sourceIds.slice(offset, offset + IN_CHUNK);
    const { data, error } = await db.from("sources").select("id, name").in("id", chunk);
    if (error) throw new MatchSpecError(`reading sources: ${error.message}`, 500);
    for (const row of data ?? []) output.set(row.id, row.name);
  }
  return output;
}

/**
 * Accept some of the terms that have earned promotion, and store the result.
 *
 * The evidence is recomputed here rather than trusted from the caller: the
 * request names terms, and only a term that is a candidate *now* is promoted. A
 * request naming nothing promotable is refused, so a stale console cannot
 * promote a term whose evidence has since aged out.
 */
export async function acceptPromotions(
  db: Db,
  topicId: string,
  terms: readonly string[],
  now: Date,
): Promise<{ spec: MatchSpec; promoted: MatchTerm[] }> {
  // One read of the row for both the evidence and the compare-and-set, so an
  // edit that lands between them is a conflict rather than a lost update.
  const row = await readTopic(db, topicId);
  const report = await evidenceFor(db, row);
  const wanted = new Set(terms.map((term) => normaliseText(term)));
  const accepted = report.candidates.filter((term) => wanted.has(normaliseText(term.text)));
  if (accepted.length === 0) {
    throw new MatchSpecError("None of the requested terms has earned promotion.", 409);
  }

  const next = promoteTerms(report.spec, accepted);
  const validated = validateAuthoredSpec(next);
  if (!validated.ok)
    throw new MatchSpecError(`Promotion produced an invalid spec: ${validated.reason}`, 500);

  await writeColumns(db, row, columns(validated.spec, "enriched", now));
  return { spec: validated.spec, promoted: accepted };
}
