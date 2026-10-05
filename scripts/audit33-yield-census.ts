/**
 * Audit 33 observation — the arbiter split the success metric in two:
 *
 *   Fairness:    recency-starved eligible events reached.
 *   Productive:  usable evidence per attempt — attempts, evidence-producing
 *                attempts, zero-unit terminal attempts, rows written, and
 *                zero-evidence events converted to non-zero.
 *
 * This instrument reads what the enrichment stage actually finished in a
 * window, joins it to the articles' ages, and classifies every attempt. It
 * also re-checks the tracked zero-evidence cohort by id, since title matching
 * proved lossy.
 */

import { readFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

type TrackedRow = {
  eventId?: string;
  title: string;
  cls: string;
  verdict: string;
  lastAttempt: string;
};

main(async () => {
  const client = db();
  const now = Date.now();
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const minutes = Number(argOf("--minutes") ?? 45);
  const since = new Date(now - minutes * 60_000).toISOString();

  const { data: rows, error } = await client
    .from("article_evidence")
    .select("article_id, extracted_at, evidence, status")
    .gte("extracted_at", since)
    .order("extracted_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  const finished = rows ?? [];
  heading(`Enrichment finished in the last ${minutes} minutes`);
  say(rowLine("attempts finished", finished.length));

  const articleIds = [...new Set(finished.map((r) => r.article_id))];
  const articlesById = new Map<string, { published_at: string; event_id: string | null }>();
  for (let i = 0; i < articleIds.length; i += 200) {
    const { data, error } = await client
      .from("articles")
      .select("id, published_at, event_id")
      .in("id", articleIds.slice(i, i + 200));
    if (error) throw new Error(`articles: ${error.message}`);
    for (const a of data ?? [])
      articlesById.set(a.id, {
        published_at: String(a.published_at),
        event_id: a.event_id === null ? null : String(a.event_id),
      });
  }
  say(rowLine("articles resolved", articlesById.size));

  let productive = 0;
  let zeroUnit = 0;
  const eventsTouched = new Set<string>();
  const ages: number[] = [];
  for (const row of finished) {
    const article = articlesById.get(row.article_id);
    if (!article) continue;
    const units = Array.isArray(row.evidence) ? row.evidence.length : 0;
    if (units > 0) productive += 1;
    else zeroUnit += 1;
    ages.push((now - Date.parse(article.published_at)) / 3_600_000);
    if (article.event_id) eventsTouched.add(article.event_id);
  }
  say(rowLine("evidence-producing attempts", productive));
  say(rowLine("zero-unit terminal attempts", zeroUnit));
  say(rowLine("distinct articles", articleIds.length));
  say(rowLine("distinct events touched", eventsTouched.size));
  if (ages.length > 0) {
    ages.sort((a, b) => a - b);
    const min = ages[0];
    const median = ages[Math.floor(ages.length / 2)];
    const max = ages.at(-1);
    if (min !== undefined && median !== undefined && max !== undefined)
      say(
        rowLine(
          "article age min/median/max",
          `${min.toFixed(1)}h / ${median.toFixed(1)}h / ${max.toFixed(1)}h`,
        ),
      );
  }

  // Fairness: the tracked cohort, matched by the event ids the membership
  // census stored rather than by title.
  const trackedPath = argOf("--tracked");
  if (trackedPath) {
    const tracked = (JSON.parse(readFileSync(trackedPath, "utf8")) as { rows: TrackedRow[] }).rows;
    // Prefer the event id when the census carries one; fall back to matching
    // the truncated title inside the same complete-events window the drain
    // instrument used.
    const { data: events } = await client
      .from("events")
      .select("id,title")
      .eq("status", "complete")
      .gte("first_seen_at", new Date(now - 30 * 24 * 3_600_000).toISOString())
      .order("first_seen_at", { ascending: false })
      .limit(1000);
    const byTitle = new Map<string, string>();
    for (const e of events ?? []) byTitle.set(e.title.slice(0, 44), e.id);
    const resolve = (entry: TrackedRow): string | undefined =>
      entry.eventId ?? byTitle.get(entry.title);
    const unresolved = tracked.filter((r) => resolve(r) === undefined).length;
    say();
    heading("Fairness: the tracked zero-evidence cohort");
    say(rowLine("cohort size", tracked.length));
    say(rowLine("unresolved", unresolved));
    let gained = 0;
    let stillZero = 0;
    let broken = 0;
    for (const entry of tracked) {
      const eventId = resolve(entry);
      if (!eventId) {
        broken += 1;
        continue;
      }
      const { data: arts } = await client.from("articles").select("id").eq("event_id", eventId);
      let units = 0;
      for (const a of arts ?? []) {
        const { data: ev } = await client
          .from("article_evidence")
          .select("evidence")
          .eq("article_id", a.id);
        for (const e of ev ?? []) if (Array.isArray(e.evidence)) units += e.evidence.length;
      }
      if (units > 0) gained += 1;
      else stillZero += 1;
    }
    say(rowLine("gained usable evidence", gained));
    say(rowLine("still zero-evidence", stillZero));
    say(rowLine("unresolvable", broken));
  }
});
