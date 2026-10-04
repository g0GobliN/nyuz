/**
 * Why the `never_attempted` articles were never attempted.
 *
 * The enrichment census says 830 of 1020 articles in the window have no
 * `article_evidence` row at all. This script asks the next question: which gate
 * kept them out? The enrich stage's candidate arms are, in order:
 *
 *   priority  events with a `user_events.matched_at` in the last 24 hours
 *   fallback  articles `published_at` inside `activeCutoff` (72 hours)
 *   per tick  ENRICH_LIMIT (3), newest-published first
 *   per gate  `sources.enrichment_allowed` and the failure-count ceiling
 *
 * An article outside both time arms is *permanently* unreachable: no amount of
 * ticks will ever pick it. One that is inside an arm but still unattempted was
 * either starved by the batch order or refused by its source's gate — those are
 * different fixes, so each never_attempted article lands in exactly one class:
 *
 *   never_matched        nobody was ever matched to its event
 *   outside_both_arms    last match >24h ago AND every article >72h old
 *   fallback_arm         inside the 72h published window; match is stale
 *   priority_arm         matched in the last 24 hours; should have been picked
 *   source_gate          a candidate its source refuses to enrich
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import {
  bestAbsence,
  type ArticleRow,
  type EnrichmentStatus,
  type EventRow,
} from "@/lib/enrichment-census";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

const DEFAULT_DAYS = 30;
const WINDOW_LIMIT = 1000;
const PAGE = 1000;
const CHUNK = 200;
/** The enrich stage's own gates, restated so the classes stay honest. */
const PRIORITY_HOURS = 24;
const FALLBACK_HOURS = 72;

type EventDbRow = { id: string; title: string; importance: number | null };
type ArticleDbRow = { id: string; event_id: string; published_at: string; source_id: string };
type EvidenceDbRow = { article_id: string; status: string; evidence: unknown };
type SourceDbRow = { id: string; name: string; enrichment_allowed: boolean | null };
type MatchDbRow = { event_id: string; matched_at: string };

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
    .select("id, title, importance")
    .eq("status", "complete")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(WINDOW_LIMIT);
  if (eventError) throw new Error(`events: ${eventError.message}`);
  const events = (eventRows ?? []) as EventDbRow[];
  const ids = events.map((event) => event.id);
  say(rowLine("complete events in window", events.length));

  const articles: ArticleDbRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, published_at, source_id")
      .in("event_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`articles: ${error.message}`);
    articles.push(...((data ?? []) as ArticleDbRow[]));
  }
  say(rowLine("articles attached", articles.length));

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

  /** Events in the window that the census calls never_attempted. */
  const rows: EventRow[] = events.map((event) => ({
    eventId: event.id,
    articles: articles
      .filter((article) => article.event_id === event.id)
      .map((article): ArticleRow => {
        const evidence = evidenceByArticle.get(article.id);
        return {
          articleId: article.id,
          status: (evidence?.status as EnrichmentStatus | undefined) ?? null,
          evidenceUnits: Array.isArray(evidence?.evidence) ? evidence.evidence.length : 0,
          wordCount: 0,
        };
      }),
  }));
  const neverAttempted = new Set(
    rows
      .filter(
        (row) =>
          row.articles.length > 0 &&
          row.articles.every((article) => article.status === null) &&
          bestAbsence(row.articles) === "never_attempted",
      )
      .map((row) => row.eventId),
  );
  say(rowLine("never_attempted events", neverAttempted.size));

  /** Every match row for those events, paged: `user_events` is small. */
  const lastMatch = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("user_events")
      .select("event_id, matched_at")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`user_events: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const match of data as MatchDbRow[]) {
      const seen = lastMatch.get(match.event_id);
      if (!seen || match.matched_at > seen) lastMatch.set(match.event_id, match.matched_at);
    }
    if (data.length < PAGE) break;
  }

  /** Sources of the never_attempted articles: the per-source gate. */
  const targetArticles = articles.filter((article) => neverAttempted.has(article.event_id ?? ""));
  const sourceIds = [...new Set(targetArticles.map((article) => article.source_id))].filter(
    Boolean,
  );
  const sourceGate = new Map<string, boolean>();
  for (let i = 0; i < sourceIds.length; i += CHUNK) {
    const { data, error } = await client
      .from("sources")
      .select("id, name, enrichment_allowed")
      .in("id", sourceIds.slice(i, i + CHUNK));
    if (error) throw new Error(`sources: ${error.message}`);
    for (const source of (data ?? []) as SourceDbRow[])
      sourceGate.set(source.id, source.enrichment_allowed !== false);
  }

  heading("Which gate kept each never_attempted article out");
  const classes: {
    never_matched: number;
    outside_both_arms: number;
    fallback_arm: number;
    priority_arm: number;
    source_gate: number;
  } = {
    never_matched: 0,
    outside_both_arms: 0,
    fallback_arm: 0,
    priority_arm: 0,
    source_gate: 0,
  };
  const gatedSources = new Map<string, number>();
  const eventClass = new Map<string, string>();
  for (const article of targetArticles) {
    const allowed = sourceGate.get(article.source_id);
    if (allowed === false) {
      classes.source_gate += 1;
      gatedSources.set(article.source_id, (gatedSources.get(article.source_id) ?? 0) + 1);
      eventClass.set(article.event_id, "source_gate");
      continue;
    }
    const match = lastMatch.get(article.event_id);
    if (!match) {
      classes.never_matched += 1;
      eventClass.set(article.event_id, "never_matched");
      continue;
    }
    const matchAgeHours = (now - Date.parse(match)) / 3_600_000;
    const publishedAgeHours = (now - Date.parse(article.published_at)) / 3_600_000;
    if (matchAgeHours <= PRIORITY_HOURS) {
      classes.priority_arm += 1;
      eventClass.set(article.event_id, "priority_arm");
    } else if (publishedAgeHours <= FALLBACK_HOURS) {
      classes.fallback_arm += 1;
      eventClass.set(article.event_id, "fallback_arm");
    } else {
      classes.outside_both_arms += 1;
      eventClass.set(article.event_id, "outside_both_arms");
    }
  }
  for (const [name, count] of Object.entries(classes)) say(rowLine(name, count));
  if (gatedSources.size > 0) {
    say();
    say("Sources refusing enrichment (source_gate):");
    for (const [id, count] of [...gatedSources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))
      say(`  ${count.toString().padStart(4)}  ${id}`);
  }

  /** The same split per event, so the headline is a count of stories, not rows. */
  heading("By event (an event takes its worst article's class)");
  const eventCounts: Record<string, number> = {};
  for (const id of neverAttempted) {
    const cls = eventClass.get(id) ?? "never_matched";
    eventCounts[cls] = (eventCounts[cls] ?? 0) + 1;
  }
  for (const [name, count] of Object.entries(eventCounts).sort((a, b) => b[1] - a[1]))
    say(rowLine(name, count));

  const out = flag("--out");
  if (out) {
    const payload = {
      windowDays: days,
      since,
      neverAttemptedEvents: [...neverAttempted],
      classes,
      eventCounts,
      gatedSources: [...gatedSources.entries()],
    };
    writeFileSync(out, `${JSON.stringify(payload, null, 1)}\n`);
    say();
    say(`written to ${out}`);
  }
});
