/**
 * Where a discovery job's candidates come from, now that no search provider
 * supplies them.
 *
 * ---------------------------------------------------------------------------
 * A search index was never the discovery mechanism
 * ---------------------------------------------------------------------------
 *
 * The stage's job is to turn "somebody follows this subject and nothing is
 * collected for it" into "an ordinary `sources` row is linked to it". The
 * provider only ever contributed a *seed URL*: a page to hand to
 * `resolveFeed`, which does the actual work -- probe the URL, read a declared
 * `<link rel="alternate">`, try the conventional addresses, and only then
 * admit a feed exists. Remove the provider and the seed has to come from
 * somewhere deterministic instead.
 *
 * Two of the three sources of seeds are already inside the product, and cost
 * no network at all:
 *
 *   M0 registry   a source we already collect whose own name or domain names
 *                 the subject. The feed is in `sources` and often already
 *                 linked to a different topic; the only thing missing is the
 *                 link to this one.
 *
 *   M1 corpus     articles we already hold whose text mentions the subject.
 *                 Whoever published them covers the subject -- demonstrably,
 *                 because they wrote about it -- so link that source.
 *
 *   M2 reader     a URL the reader supplied (see `submit.ts`), which goes
 *                 through `resolveFeed` exactly as any other candidate does.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT do
 * ---------------------------------------------------------------------------
 *
 * No search API, no scraping, no browser automation, no sitemap walk, no
 * crawling, no model call. Every read here is bounded and every write is a
 * `source_topics` row for a source that already exists; nothing is fetched.
 * The stage is best-effort and says so: a subject nobody in the corpus has
 * ever written about yields nothing here, and that is a reason, not a failure.
 *
 * ---------------------------------------------------------------------------
 * Why SQL filters and a TypeScript decision, in that order
 * ---------------------------------------------------------------------------
 *
 * The queries use `ilike` as a *prefilter* and nothing else. It is a
 * deliberate superset of the real rule: `mentions` matches word prefixes, so
 * any text it accepts contains the term as a substring, and every row it would
 * accept therefore survives the SQL filter. The decision itself is made in
 * TypeScript by `matchesTerms`, the same evaluator `classify.ts` and
 * `match.ts` use, so this stage cannot disagree with the rest of the pipeline
 * about what a subject means. (The prefilter also has to keep a row that
 * matches on *any* term, which is why the filter is an OR across terms even
 * though the decision requires all of them.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { matchesTerms, normaliseText } from "@/lib/topics";
import type { Database, Json } from "@/lib/supabase/types";

type Db = SupabaseClient<Database>;

/* ---------------------------------------------------------------------- */
/* Bounds                                                                 */
/* ---------------------------------------------------------------------- */

/** Sources read per registry scan. There are ~90 in the corpus on a bad day. */
export const REGISTRY_SCAN_LIMIT = 500;

/** Articles read per corpus scan. Bounded for the query's cost, not the row count. */
export const CORPUS_SCAN_LIMIT = 300;

/**
 * Days of corpus a job looks at. Older articles describe an older subject.
 *
 * Measured on `fetched_at`, not `published_at`: a feed that omits dates is
 * legal (0006 notes arXiv does it at weekends), and an undated article we
 * ingested yesterday is still evidence that its source covers the subject.
 */
export const CORPUS_WINDOW_DAYS = 30;

/** Sources linked to one subject by one job. A brake, not a target. */
export const MAX_LINKS_PER_JOB = 20;

/**
 * Confidence for a source→topic link this stage inferred rather than was told.
 *
 * 0.3, matching `OBSERVED_CONFIDENCE` in `pipeline/match.ts`: it is the same
 * claim ("this source demonstrably carried something about this subject")
 * reached from a different place, and two numbers for one claim would be a
 * bug waiting to be read as meaningful. Below an editorial mapping (1.0), and
 * `ignoreDuplicates` means an operator's own link is never weakened by it.
 */
export const EVIDENCE_CONFIDENCE = 0.3;

/* ---------------------------------------------------------------------- */
/* The decision                                                           */
/* ---------------------------------------------------------------------- */

/** A source as the registry scan sees it. */
export type KnownSource = {
  id: string;
  name: string;
  homepage: string | null;
  feed_url: string;
};

/** An article as the corpus scan sees it. */
export type CorpusArticle = {
  source_id: string | null;
  title: string | null;
  excerpt: string | null;
};

/**
 * Whether a source we already collect names the subject itself.
 *
 * The haystack is the source's own name and homepage, never its articles --
 * this is the "the feed is already in the registry, nobody mapped it" case,
 * and it is answered without reading a single article or making a request.
 */
export function registryMentions(source: KnownSource, terms: string[]): boolean {
  return matchesTerms(haystackOf([source.name, source.homepage ?? ""]), terms);
}

/** The distinct sources behind articles that mention the subject. */
export function corpusSourcesFor(
  articles: readonly CorpusArticle[],
  terms: string[],
  cap: number = MAX_LINKS_PER_JOB,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const article of articles) {
    if (article.source_id === null) continue;
    if (seen.has(article.source_id)) continue;
    if (!matchesTerms(haystackOf([article.title ?? "", article.excerpt ?? ""]), terms)) continue;

    seen.add(article.source_id);
    found.push(article.source_id);
    if (found.length >= cap) break;
  }

  return found;
}

/**
 * A PostgREST `or=` expression matching any of these terms in any of these
 * columns, or `""` when there is nothing usable to ask.
 *
 * PostgREST parses this argument itself, so a term containing a comma, a
 * bracket, a percent or a period would change the shape of the query rather
 * than the value being searched for. `topicTerms` cannot produce one and this
 * refuses anyway, for the reason `shortlist.ts` gives for the same check: the
 * cost of being wrong is a malformed query at best and a filter bypass at
 * worst, and the check is one regex.
 *
 * Wildcards are `*`, which is PostgREST's spelling; `%` is not a wildcard in a
 * PostgREST filter and would match a literal percent sign.
 */
export function mentionFilter(columns: readonly string[], terms: readonly string[]): string {
  const safe = terms.filter((term) => /^[\p{L}\p{N}'’-]+$/u.test(term));
  if (safe.length === 0 || columns.length === 0) return "";

  return safe.flatMap((term) => columns.map((column) => `${column}.ilike.*${term}*`)).join(",");
}

function haystackOf(parts: readonly string[]): string {
  return normaliseText(parts.filter((part) => part !== "").join(" "));
}

/* ---------------------------------------------------------------------- */
/* The job's body                                                         */
/* ---------------------------------------------------------------------- */

export type SeedMethod = "registry" | "corpus" | "none";

export type SeedAttempt = {
  method: "registry" | "corpus";
  /** Rows the database offered before the decision was made. */
  considered: number;
  /** Rows the decision accepted. */
  matched: number;
  /** Links actually written. */
  linked: number;
};

export type SeedResult = {
  /** One entry per method tried, in the order they were tried. */
  attempts: SeedAttempt[];
  /** Sources linked to the subject by this run. */
  linked: number;
  /** The method that produced the links, or `none`. Stored on the job row. */
  method: SeedMethod;
  /** Terms the job looked for. Stored so an operator can see what was asked. */
  terms: string[];
};

/**
 * Links sources we already collect to a subject that has none.
 *
 * Registry first, then the corpus, and it stops at the first method that links
 * anything: M0 is a strictly cheaper answer to the same question, and a job
 * that already found the subject's own feed does not need to read thirty days
 * of articles to find the outlets that also cover it. Corpus results are
 * capped, so a subject the whole corpus discusses does not link everything.
 *
 * A failed read is a failed *method*, never a failed job: it is logged, counted
 * as zero, and the next one still runs. A failed write is the same --
 * `linkSourceToTopic` never throws, because a link lost this hour is
 * recomputed next hour.
 */
export async function linkExistingCoverage(
  db: Db,
  topic: { id: string; label: string; terms: string[] },
  options: { now?: Date } = {},
): Promise<SeedResult> {
  const now = options.now ?? new Date();
  const terms = topic.terms.filter((term) => term.trim() !== "");
  const attempts: SeedAttempt[] = [];
  const termsJson = terms as unknown as Json;

  if (terms.length === 0) {
    // No terms is not "match everything": a label made entirely of stopwords
    // gets `topicTerms`' own fallback, and an empty list arriving here means
    // the row is malformed. Refusing is the narrow direction.
    return { attempts, linked: 0, method: "none", terms };
  }

  // Read once, so "linked" means rows written rather than rows intended:
  // `ignoreDuplicates` silently skips a source this subject already has, and a
  // count that included those would overstate every repeat run.
  const already = await existingLinks(db, topic.id);

  const registry = await registryCandidates(db, terms);
  if (registry.matched.length > 0) {
    const linked = await linkSources(
      db,
      topic.id,
      registry.matched.map((row) => row.id),
      already,
    );
    attempts.push({
      method: "registry",
      considered: registry.considered,
      matched: registry.matched.length,
      linked,
    });
    return { attempts, linked, method: linked > 0 ? "registry" : "none", terms };
  }
  attempts.push({
    method: "registry",
    considered: registry.considered,
    matched: 0,
    linked: 0,
  });

  const corpus = await corpusCandidates(db, terms, now);
  const linked = await linkSources(db, topic.id, corpus.matched, already);
  attempts.push({
    method: "corpus",
    considered: corpus.considered,
    matched: corpus.matched.length,
    linked,
  });

  return {
    attempts,
    linked,
    method: linked > 0 ? "corpus" : "none",
    terms,
  };
}

/** Whether a job's seed result should be recorded as `attempts` on the row. */
export function attemptsJson(result: SeedResult): Json {
  return result.attempts as unknown as Json;
}

async function registryCandidates(
  db: Db,
  terms: string[],
): Promise<{ considered: number; matched: KnownSource[] }> {
  try {
    let query = db
      .from("sources")
      .select("id, name, homepage, feed_url")
      .eq("active", true)
      .limit(REGISTRY_SCAN_LIMIT);

    const filter = mentionFilter(["name", "homepage"], terms);
    if (filter !== "") query = query.or(filter);

    const { data, error } = await query;
    if (error) {
      console.warn(`discovery: reading the source registry failed: ${error.message}`);
      return { considered: 0, matched: [] };
    }

    const rows = (data ?? []) as KnownSource[];
    return { considered: rows.length, matched: rows.filter((row) => registryMentions(row, terms)) };
  } catch (error) {
    // A method that cannot be tried is that method's zero, never the job's
    // failure: the next method, and the next tick, carry on.
    console.warn(`discovery: reading the source registry failed: ${describe(error)}`);
    return { considered: 0, matched: [] };
  }
}

async function corpusCandidates(
  db: Db,
  terms: string[],
  now: Date,
): Promise<{ considered: number; matched: string[] }> {
  const since = new Date(now.getTime() - CORPUS_WINDOW_DAYS * 86_400_000).toISOString();

  try {
    let query = db
      .from("articles")
      .select("source_id, title, excerpt")
      .not("source_id", "is", null)
      .limit(CORPUS_SCAN_LIMIT);

    const filter = mentionFilter(["title", "excerpt"], terms);
    if (filter !== "") query = query.or(filter);

    query = query.gte("fetched_at", since);

    const { data, error } = await query;
    if (error) {
      console.warn(`discovery: reading the corpus failed: ${error.message}`);
      return { considered: 0, matched: [] };
    }

    const rows = (data ?? []) as CorpusArticle[];
    return { considered: rows.length, matched: corpusSourcesFor(rows, terms) };
  } catch (error) {
    console.warn(`discovery: reading the corpus failed: ${describe(error)}`);
    return { considered: 0, matched: [] };
  }
}

/** The sources this subject is already linked to. */
async function existingLinks(db: Db, topicId: string): Promise<Set<string>> {
  try {
    const { data, error } = await db
      .from("source_topics")
      .select("source_id")
      .eq("topic_id", topicId);

    if (error) {
      console.warn(`discovery: reading existing links for ${topicId} failed: ${error.message}`);
      return new Set();
    }

    return new Set((data ?? []).map((row) => row.source_id));
  } catch (error) {
    // Unknown links are not a reason to skip the write: `ignoreDuplicates`
    // makes a repeat harmless, and a lost count is not a lost link.
    console.warn(`discovery: reading existing links for ${topicId} failed: ${describe(error)}`);
    return new Set();
  }
}

/**
 * The write: one `source_topics` row per source that does not already have one.
 *
 * `ignoreDuplicates` is the whole safety property. An editorial mapping (1.0)
 * or an observation from `match.ts` (0.3) is never overwritten or weakened by
 * an inference made here, so this can run on every tick without ever changing
 * a link a human made. A failed write is logged, not raised: the link is the
 * only thing this produces, and the next job for the same subject recomputes
 * it from the same evidence.
 *
 * Two overlapping invocations can both count the same new link -- the unique
 * index on (source_id, topic_id) means the second write is a no-op, not a
 * duplicate row. Losing one to the counter is cheaper than a lease column.
 */
async function linkSources(
  db: Db,
  topicId: string,
  sourceIds: readonly string[],
  already: ReadonlySet<string>,
): Promise<number> {
  const rows = sourceIds
    .filter((sourceId) => !already.has(sourceId))
    .slice(0, MAX_LINKS_PER_JOB)
    .map((sourceId) => ({
      source_id: sourceId,
      topic_id: topicId,
      confidence: EVIDENCE_CONFIDENCE,
    }));

  try {
    const { error } = await db
      .from("source_topics")
      .upsert(rows, { onConflict: "source_id,topic_id", ignoreDuplicates: true });

    if (error) {
      console.warn(
        `discovery: linking ${rows.length} source(s) to ${topicId} failed: ${error.message}`,
      );
      return 0;
    }
  } catch (error) {
    console.warn(
      `discovery: linking ${rows.length} source(s) to ${topicId} failed: ${describe(error)}`,
    );
    return 0;
  }

  return rows.length;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
