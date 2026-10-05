/**
 * Audit 35 — are the source-backoff events parked because their sources are
 * genuinely unrecoverable, or because the source-level failure counter is
 * blocking otherwise recoverable work?
 *
 * The arbiter's ruling after Audit 33: the 9 source-backoff events are the
 * last reachable-but-parked family. This census reads, per event and per
 * source:
 *   - how many events collapse into how many unique sources (the unit of
 *     intervention is the source family, not the event);
 *   - each source's enrichment_failure_count, robots_checked_at and
 *     enrichment_allowed;
 *   - whether the event's article was ever attempted (an evidence row of any
 *     status);
 *   - whether the source has OTHER articles in the corpus and whether any of
 *     those ever enriched — the recoverability signal;
 *   - the last successful enrichment from that source, if any.
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

type TrackedRow = { eventId: string; title: string; verdict: string; cls: string };

type ArticleRow = {
  id: string;
  event_id: string | null;
  published_at: string;
  title: string | null;
  sources: { id: string; name: string | null } | null;
};

main(async () => {
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const trackedPath = argOf("--tracked");
  const out = argOf("--out");
  if (!trackedPath) throw new Error("pass --tracked <membership census JSON>");
  const tracked = (
    JSON.parse(readFileSync(trackedPath, "utf8")) as { rows: TrackedRow[] }
  ).rows.filter((r) => r.verdict === "in_window_backoff");
  const now = Date.now();
  const client = db();

  heading("Audit 35 — the source-backoff family");
  say(rowLine("events parked by source backoff", tracked.length));
  const eventIds = tracked.map((r) => r.eventId);

  // The events' own articles and their sources.
  const own: ArticleRow[] = [];
  for (let i = 0; i < eventIds.length; i += 200) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, published_at, title, sources(id, name)")
      .in("event_id", eventIds.slice(i, i + 200));
    if (error) throw new Error(`articles: ${error.message}`);
    own.push(...((data ?? []) as unknown as ArticleRow[]));
  }
  const sourceIds = [...new Set(own.map((a) => a.sources?.id).filter((s): s is string => !!s))];
  say(rowLine("articles across those events", own.length));
  say(rowLine("UNIQUE SOURCES (the unit of intervention)", sourceIds.length));

  // Was the event's article ever attempted?
  const attempted = new Set<string>();
  const statusByArticle = new Map<string, string | null>();
  const articleIds = own.map((a) => a.id);
  for (let i = 0; i < articleIds.length; i += 200) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, status")
      .in("article_id", articleIds.slice(i, i + 200));
    if (error) throw new Error(`article_evidence: ${error.message}`);
    for (const row of data as { article_id: string; status: string | null }[]) {
      attempted.add(row.article_id);
      statusByArticle.set(row.article_id, row.status);
    }
  }
  say(rowLine("event articles ever attempted", attempted.size));

  // Per source: the whole corpus footprint, and its success history.
  const sourceStats = new Map<
    string,
    {
      name: string | null;
      failureCount: number;
      robotsCheckedAt: string | null;
      allowed: boolean | null;
    }
  >();
  for (let i = 0; i < sourceIds.length; i += 200) {
    const { data, error } = await client
      .from("sources")
      .select("id, name, enrichment_failure_count, robots_checked_at, enrichment_allowed")
      .in("id", sourceIds.slice(i, i + 200));
    if (error) throw new Error(`sources: ${error.message}`);
    for (const row of data as {
      id: string;
      name: string | null;
      enrichment_failure_count: number;
      robots_checked_at: string | null;
      enrichment_allowed: boolean | null;
    }[])
      sourceStats.set(row.id, {
        name: row.name,
        failureCount: row.enrichment_failure_count,
        robotsCheckedAt: row.robots_checked_at,
        allowed: row.enrichment_allowed,
      });
  }

  // Every article in the corpus per source, with its evidence outcome.
  const articlesBySource = new Map<string, { total: number; enriched: number; other: number }>();
  const lastSuccessBySource = new Map<string, string>();
  for (let i = 0; i < sourceIds.length; i += 200) {
    const { data, error } = await client
      .from("articles")
      .select("id, source_id")
      .in("source_id", sourceIds.slice(i, i + 200));
    if (error) throw new Error(`articles(all): ${error.message}`);
    const ids = (data ?? []).map((r) => String(r.id));
    const sourceOf = new Map<string, string>();
    for (const row of data ?? []) {
      const sid = (row as { source_id?: string | null }).source_id;
      if (sid) sourceOf.set(String(row.id), sid);
    }
    for (const sid of sourceIds.slice(i, i + 200)) {
      if (!articlesBySource.has(sid))
        articlesBySource.set(sid, { total: 0, enriched: 0, other: 0 });
    }
    for (let j = 0; j < ids.length; j += 200) {
      const { data: ev, error: evError } = await client
        .from("article_evidence")
        .select("article_id, status, extracted_at")
        .in("article_id", ids.slice(j, j + 200));
      if (evError) throw new Error(`article_evidence(all): ${evError.message}`);
      const attemptedIds = new Set<string>();
      for (const row of ev ?? []) {
        const sid = sourceOf.get(row.article_id);
        if (!sid) continue;
        const entry = articlesBySource.get(sid);
        if (!entry) continue;
        if (row.status === "enriched") {
          entry.enriched += 1;
          const at = String(row.extracted_at ?? "");
          const prior = lastSuccessBySource.get(sid);
          if (at && (!prior || at > prior)) lastSuccessBySource.set(sid, at);
        } else entry.other += 1;
        attemptedIds.add(row.article_id);
      }
      // Articles with no evidence row were never attempted.
      for (const id of ids.slice(j, j + 200)) {
        const sid = sourceOf.get(id);
        if (!sid || attemptedIds.has(id)) continue;
        const entry = articlesBySource.get(sid);
        if (entry) entry.total += 0; // counted once below via total assignment
      }
    }
    // `total` is the full corpus footprint for the source, independent of
    // attempts: count every article returned for the source.
    for (const id of ids) {
      const sid = sourceOf.get(id);
      if (!sid) continue;
      const entry = articlesBySource.get(sid);
      if (entry) entry.total += 1;
    }
  }

  heading("Per source");
  for (const sid of sourceIds) {
    const stats = sourceStats.get(sid);
    const footprint = articlesBySource.get(sid) ?? { total: 0, enriched: 0, other: 0 };
    const eventsHere = own
      .filter((a) => a.sources?.id === sid)
      .map((a) => tracked.find((t) => t.eventId === a.event_id)?.title.slice(0, 34) ?? "?");
    say(
      `  ${String(stats?.name ?? sid.slice(0, 8))
        .slice(0, 30)
        .padEnd(30)} failures=${String(stats?.failureCount ?? 0).padStart(
        3,
      )}  robots=${String(stats?.allowed ?? "?").padEnd(5)}  corpus=${String(
        footprint.total,
      ).padStart(4)} (enriched ${footprint.enriched}, other ${footprint.other})  lastSuccess ${
        lastSuccessBySource.get(sid)?.slice(0, 16) ?? "never"
      }  events=${eventsHere.length}`,
    );
  }

  heading("Per event");
  for (const entry of tracked) {
    const articles = own.filter((a) => a.event_id === entry.eventId);
    const forArticle = articles
      .map((a) => {
        const stats = a.sources ? sourceStats.get(a.sources.id) : undefined;
        return `${a.sources?.name ?? "?"}(f=${stats?.failureCount ?? "?"},attempted=${attempted.has(a.id) ? "yes" : "no"})`;
      })
      .join(", ");
    say(
      `  imp ${String(entry.cls === "" ? "?" : "?").padStart(1)}  ${entry.title.slice(0, 44).padEnd(46)} ${forArticle}`,
    );
  }

  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          takenAt: new Date(now).toISOString(),
          events: tracked.length,
          uniqueSources: sourceIds.length,
          sources: sourceIds.map((sid) => ({
            id: sid,
            name: sourceStats.get(sid)?.name ?? null,
            failureCount: sourceStats.get(sid)?.failureCount ?? null,
            robotsCheckedAt: sourceStats.get(sid)?.robotsCheckedAt ?? null,
            allowed: sourceStats.get(sid)?.allowed ?? null,
            corpusTotal: articlesBySource.get(sid)?.total ?? 0,
            corpusEnriched: articlesBySource.get(sid)?.enriched ?? 0,
            lastSuccess: lastSuccessBySource.get(sid) ?? null,
          })),
          detail: tracked.map((t) => ({
            eventId: t.eventId,
            title: t.title,
            articles: own
              .filter((a) => a.event_id === t.eventId)
              .map((a) => ({
                id: a.id,
                sourceId: a.sources?.id ?? null,
                attempted: attempted.has(a.id),
                status: statusByArticle.get(a.id) ?? null,
              })),
          })),
        },
        null,
        1,
      )}\n`,
    );
    say();
    say(`written to ${out}`);
  }
});
