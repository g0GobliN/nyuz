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
): Promise<CorpusEvent[]> {
  if (from) {
    const frozen = JSON.parse(readFileSync(from, "utf8")) as CorpusEvent[];
    const rows = find
      ? frozen.filter((event) => event.title.toLowerCase().includes(find.toLowerCase()))
      : frozen;
    return rows.slice(0, limit);
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
  const { data: evidence, error: evidenceError } = await client
    .from("article_evidence")
    .select("article_id, evidence")
    .in("article_id", articleIds)
    .eq("status", "enriched");
  if (evidenceError) throw new Error(`article_evidence: ${evidenceError.message}`);
  const evidenceByArticle = new Map(
    (evidence ?? []).map((item) => [item.article_id, (item.evidence ?? []) as EvidenceUnit[]]),
  );

  const sourceIds = [...new Set((articles ?? []).map((a) => a.source_id).filter(Boolean))];
  const { data: sources, error: sourceError } = await client
    .from("sources")
    .select("id, name")
    .in("id", sourceIds as string[]);
  if (sourceError) throw new Error(`sources: ${sourceError.message}`);
  const nameById = new Map((sources ?? []).map((s) => [s.id, s.name]));

  return (events ?? []).flatMap((event) => {
    const coverage = (articles ?? [])
      .filter((a) => a.event_id === event.id)
      .map((a) => ({
        name: nameById.get(a.source_id as string) ?? "Unknown",
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
          name: c.name,
          at: "",
          url: c.url,
          headline: c.title,
          ...(c.excerpt ? { excerpt: c.excerpt } : {}),
          ...(c.evidence ? { enrichedEvidence: c.evidence } : {}),
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
