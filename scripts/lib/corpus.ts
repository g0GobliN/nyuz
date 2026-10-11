/**
 * The live corpus, read as the reader's own composer receives it.
 *
 * Shared by `reader-composer-audit` (what the composer publishes now) and
 * `reader-composer-snapshot` (the same stories as JSON, so two checkouts can be
 * diffed story by story). Both must see the events the same way: a measurement
 * that loads the corpus differently from the other one is not a comparison.
 *
 * SELECT only, service-role client, same as `db:status`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { EvidenceUnit } from "@/lib/understand";
import type { Story } from "@/lib/story";
import { db } from "./db.ts";

export const CORPUS_SIZE = 200;

export type CorpusEvent = {
  id: string;
  title: string;
  what: string;
  status: string;
  org: string;
  sources: number;
  /** The event's date, which is the anchor for a source's relative time. */
  publishedAt: string;
  sourceList: Story["sourceList"];
  /**
   * The coverage's `sources.kind` values, in reading order and deduplicated.
   *
   * The reader-readiness gate decides with these since the arbiter's ruling of
   * 2026-10-11 (D5): a marketing-shaped title only refuses when the publisher was
   * speaking for itself, and `company_blog` is what says so. Empty means *not
   * carried* -- fixtures have no kinds, and a corpus frozen before this field
   * existed has none either -- which the gate reads as "not first-party" and the
   * audit prints as a caveat, because a measurement of that decision needs the
   * live window rather than a corpus that cannot see it.
   */
  sourceKinds: string[];
  /**
   * The same coverage as `sourceList`, unaugmented, for the reports.
   *
   * `sourceList` is the composer's own input and is left exactly as the composer
   * receives it. This is the loader's view of the rows behind it -- each source's
   * own `kind` and its own publication time -- because the D6 silence
   * classification (arbiter's ruling, 2026-10-11) has to judge "too thin to
   * publish" against the material that was actually there and the clock the rules
   * anchored to. Absent on a corpus frozen before this field existed, so every
   * reader of it must tolerate `[]`.
   */
  coverage: {
    name: string;
    kind: string;
    publishedAt: string;
    headline: string;
    excerpt: string;
    /**
     * The article's `article_evidence.status`, or "none" when there is no row.
     *
     * The D6 silence classification turns on this and nothing else could settle
     * it: `units=0` on a silent story means either the enrichment pass looked at
     * the article and found nothing to keep ("enriched"), or it never produced a
     * row at all ("none"), or it recorded a failure. "The rules chose silence"
     * and "nyuz never fetched the page" are different findings with different
     * owners, and the composer's own report cannot tell them apart.
     */
    enrichment: string;
  }[];
};

export async function loadFixtureEvents(): Promise<CorpusEvent[]> {
  const fixtures = (await import("../../src/lib/test-support/reader-production.json")).default as {
    id: string;
    title: string;
    what_happened: string;
    sources: { headline: string; excerpt: string }[];
  }[];
  return fixtures.map((fixture) => ({
    id: fixture.id,
    title: fixture.title,
    what: fixture.what_happened,
    status: "complete",
    org: "The Register",
    sources: fixture.sources.length,
    publishedAt: "",
    sourceList: fixture.sources.map((source) => ({
      name: "The Register",
      at: "",
      headline: source.headline,
      excerpt: source.excerpt,
    })),
    // The production fixture is one outlet and carries no kind; the gate reads
    // that as "not first-party", which is the honest answer for a fixture read
    // outside the database.
    sourceKinds: [],
    // A fixture read outside the database has no enrichment state to report;
    // "none" is the honest answer rather than an invented "enriched".
    coverage: fixture.sources.map((source) => ({
      name: "The Register",
      kind: "",
      publishedAt: "",
      headline: source.headline,
      excerpt: source.excerpt,
      enrichment: "none",
    })),
  }));
}

/**
 * The corpus as it stood when it was frozen.
 *
 * The live corpus is the newest 200 completed events, so it slides: two runs hours
 * apart share no events at all, and a before/after diff over them compares
 * populations rather than rules. A frozen file is the same events for every run,
 * including a run inside a worktree at another commit -- which is what makes "the
 * same 200 stories" true instead of aspirational.
 */
export async function loadCorpusEvents(
  limit: number,
  find?: string,
  from?: string,
  /**
   * Read these events and no others, by id.
   *
   * Added for the alert audit (2026-10-11), which has to ask the readiness gate
   * about a specific list — the stories an alert would carry — rather than about
   * whatever happens to be newest. Without it the only way to reach a chosen set
   * was to load a window large enough to contain it and filter afterwards, which
   * silently measures a different population whenever the window moves.
   * Absent, every existing caller reads exactly what it read before.
   */
  only?: string[],
): Promise<CorpusEvent[]> {
  if (only && only.length > 0) {
    return loadEventsByIds(limit, only);
  }
  if (from) {
    const frozen = JSON.parse(readFileSync(from, "utf8")) as CorpusEvent[];
    const rows = find
      ? frozen.filter((event) => event.title.toLowerCase().includes(find.toLowerCase()))
      : frozen;
    // Normalised, because a corpus frozen before `sourceKinds` existed has no such
    // key and the gate now reads it: an absent field means *not carried*, which is
    // an empty list rather than a crash or a silent first-party.
    return rows.slice(0, limit).map((event) => ({
      ...event,
      sourceKinds: event.sourceKinds ?? [],
      // Older frozen files predate `coverage` and its `enrichment` field; an
      // absent value must read as *not recorded*, never as "enriched".
      coverage: (event.coverage ?? []).map((entry) => ({
        ...entry,
        enrichment: entry.enrichment ?? "unknown",
      })),
    }));
  }
  const client = db();
  let query = client
    .from("events")
    .select("id, title, what_happened, status, publisher_count, first_seen_at")
    .order("first_seen_at", { ascending: false })
    .limit(limit);
  if (find) query = query.ilike("title", `%${find}%`);
  else query = query.eq("status", "complete");
  const { data: events, error } = await query;
  if (error) throw new Error(`events: ${error.message}`);
  const ids = (events ?? []).map((e) => e.id);

  const { data: articles, error: articleError } = await client
    .from("articles")
    .select("id, event_id, source_id, title, excerpt, url, published_at")
    .in("event_id", ids)
    .order("published_at", { ascending: true });
  if (articleError) throw new Error(`articles: ${articleError.message}`);

  const articleIds = (articles ?? []).map((a) => a.id);
  // Every row, not only the enriched ones, because D6 has to tell "the pass
  // looked and kept nothing usable" apart from "no pass ever wrote a row". The
  // units the composer sees are still exactly the `enriched` ones -- this query
  // widens only what is recorded, never what is delivered.
  const { data: evidenceRows, error: evidenceError } = await client
    .from("article_evidence")
    .select("article_id, evidence, status")
    .in("article_id", articleIds);
  if (evidenceError) throw new Error(`article_evidence: ${evidenceError.message}`);
  const evidenceByArticle = new Map(
    (evidenceRows ?? [])
      .filter((item) => item.status === "enriched")
      .map((item) => [item.article_id, (item.evidence ?? []) as EvidenceUnit[]]),
  );
  const statusByArticle = new Map(
    (evidenceRows ?? []).map((item) => [item.article_id, (item.status as string) || "empty"]),
  );

  const sourceIds = [...new Set((articles ?? []).map((a) => a.source_id).filter(Boolean))];
  const { data: sources, error: sourceError } = await client
    .from("sources")
    .select("id, name, kind")
    .in("id", sourceIds as string[]);
  if (sourceError) throw new Error(`sources: ${sourceError.message}`);
  const nameById = new Map((sources ?? []).map((s) => [s.id, s.name]));
  const kindById = new Map((sources ?? []).map((s) => [s.id, s.kind as string]));

  return (events ?? []).flatMap((event) => {
    const coverage = (articles ?? [])
      .filter((a) => a.event_id === event.id)
      .map((a) => ({
        articleId: a.id,
        name: nameById.get(a.source_id as string) ?? "Unknown",
        sourceId: a.source_id as string,
        title: a.title,
        excerpt: a.excerpt,
        url: a.url,
        published_at: a.published_at ?? "",
        evidence: evidenceByArticle.get(a.id),
      }));

    if (coverage.length === 0) return [];
    return [
      {
        id: event.id,
        title: event.title,
        what: event.what_happened,
        status: event.status,
        org: coverage[0]!.name,
        sources: event.publisher_count ?? coverage.length,
        // The event's own date anchors the sources' relative time phrases: the
        // earliest coverage is the day the event happened.
        publishedAt:
          coverage.map((c) => c.published_at).find((value) => value !== "") ??
          event.first_seen_at ??
          "",
        sourceList: coverage.map((c) => ({
          articleId: c.articleId,
          name: c.name,
          at: "",
          url: c.url,
          headline: c.title,
          ...(c.excerpt ? { excerpt: c.excerpt } : {}),
          ...(c.evidence ? { enrichedEvidence: c.evidence } : {}),
        })),
        sourceKinds: [...new Set(coverage.map((c) => kindById.get(c.sourceId) ?? ""))].filter(
          (kind) => kind !== "",
        ),
        coverage: coverage.map((c) => ({
          name: c.name,
          kind: kindById.get(c.sourceId) ?? "",
          publishedAt: c.published_at,
          headline: c.title ?? "",
          excerpt: c.excerpt ?? "",
          enrichment: statusByArticle.get(c.articleId) ?? "none",
        })),
      },
    ];
  });
}

/**
 * The same rows, narrowed to an explicit set of events.
 *
 * A second selector rather than a flag threaded through the one above, because
 * the two disagree about what `limit` means: there, "the newest N events"; here,
 * "these events, at most N of them". Sharing the reader would have made one of
 * the two quietly wrong.
 */
async function loadEventsByIds(limit: number, ids: string[]): Promise<CorpusEvent[]> {
  const client = db();
  const wanted = ids.slice(0, limit);
  const { data: events, error } = await client
    .from("events")
    .select(
      "id, title, what_happened, status, publisher_count, first_seen_at, material_occurrence_at",
    )
    .in("id", wanted);
  if (error) throw new Error(`events: ${error.message}`);
  if (!events || events.length === 0) return [];

  const eventIds = events.map((event) => event.id);
  const { data: articles, error: articleError } = await client
    .from("articles")
    .select("id, event_id, source_id, title, excerpt, url, published_at")
    .in("event_id", eventIds)
    .order("published_at", { ascending: true });
  if (articleError) throw new Error(`articles: ${articleError.message}`);

  const articleIds = (articles ?? []).map((article) => article.id);
  const { data: evidenceRows, error: evidenceError } = await client
    .from("article_evidence")
    .select("article_id, evidence, status")
    .in("article_id", articleIds);
  if (evidenceError) throw new Error(`article_evidence: ${evidenceError.message}`);
  const evidenceByArticle = new Map(
    (evidenceRows ?? [])
      .filter((item) => item.status === "enriched")
      .map((item) => [item.article_id, (item.evidence ?? []) as EvidenceUnit[]]),
  );
  const statusByArticle = new Map(
    (evidenceRows ?? []).map((item) => [item.article_id, (item.status as string) || "empty"]),
  );

  const sourceIds = [...new Set((articles ?? []).map((a) => a.source_id).filter(Boolean))];
  const { data: sources, error: sourceError } = await client
    .from("sources")
    .select("id, name, kind")
    .in("id", sourceIds as string[]);
  if (sourceError) throw new Error(`sources: ${sourceError.message}`);
  const nameById = new Map((sources ?? []).map((s) => [s.id, s.name]));
  const kindById = new Map((sources ?? []).map((s) => [s.id, s.kind as string]));

  return events.flatMap((event) => {
    const coverage = (articles ?? [])
      .filter((article) => article.event_id === event.id)
      .map((article) => ({
        articleId: article.id,
        name: nameById.get(article.source_id as string) ?? "Unknown",
        sourceId: article.source_id as string,
        title: article.title,
        excerpt: article.excerpt,
        url: article.url,
        published_at: article.published_at ?? "",
        evidence: evidenceByArticle.get(article.id),
      }));
    if (coverage.length === 0) return [];
    return [
      {
        id: event.id,
        title: event.title,
        what: event.what_happened,
        status: event.status,
        org: coverage[0]!.name,
        sources: event.publisher_count ?? coverage.length,
        publishedAt:
          coverage.map((c) => c.published_at).find((value) => value !== "") ??
          event.first_seen_at ??
          "",
        sourceList: coverage.map((c) => ({
          articleId: c.articleId,
          name: c.name,
          at: "",
          url: c.url,
          headline: c.title,
          ...(c.excerpt ? { excerpt: c.excerpt } : {}),
          ...(c.evidence ? { enrichedEvidence: c.evidence } : {}),
        })),
        sourceKinds: [...new Set(coverage.map((c) => kindById.get(c.sourceId) ?? ""))].filter(
          (kind) => kind !== "",
        ),
        coverage: coverage.map((c) => ({
          name: c.name,
          kind: kindById.get(c.sourceId) ?? "",
          publishedAt: c.published_at,
          headline: c.title ?? "",
          excerpt: c.excerpt ?? "",
          enrichment: statusByArticle.get(c.articleId) ?? "none",
        })),
      },
    ];
  });
}

/** Writes the live corpus to a file, so later runs measure the same 200 events. */
export async function freezeCorpus(path: string, limit = CORPUS_SIZE): Promise<number> {
  const events = await loadCorpusEvents(limit);
  writeFileSync(path, `${JSON.stringify(events, null, 1)}\n`);
  return events.length;
}

/**
 * The corpus row as the story the reader's page hands the composer.
 *
 * No `understand`: the deterministic path is the one under audit, and the one
 * the production fixture was rendered by.
 */
export function storyForEvent(event: CorpusEvent): Story {
  return {
    id: event.id,
    org: event.org,
    title: event.title,
    what: event.what,
    why: "",
    importance: "Medium",
    score: { relevance: 50, importance: 50, novelty: 50 },
    sources: event.sources,
    topics: [],
    time: "",
    publishedAt: event.publishedAt,
    sourceList: event.sourceList,
    before: "",
    after: "",
    timeline: [],
  };
}
