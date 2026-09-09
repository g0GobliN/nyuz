/**
 * The processing funnel and the AI cost that bought it, per UTC day.
 *
 * `ai-usage-report.ts` answers "what did the provider charge?". This answers the
 * question that decides whether the charge was worth making: how many events
 * survived each stage, and what one *delivered* event cost. Requests per day is
 * the denominator nobody reads a briefing from.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/pipeline-funnel.ts [days]
 *   node --env-file=.env scripts/tsrun.mjs scripts/pipeline-funnel.ts 14 --json
 *
 * Rows are attributed to the UTC day of the timestamp that marks the stage:
 * `articles.fetched_at`, `events.first_seen_at`, `events.classified_at`,
 * `events.analysed_at`, `user_events.matched_at`, `digests.generated_at`. An
 * event ingested one day and analysed the next therefore counts on two
 * different days, which is what the pipeline actually did — normalising it to
 * a single cohort day would hide the lag that matters most when the backlog
 * grows.
 */

import { db } from "./lib/db.ts";

const days = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 14);
const asJson = process.argv.includes("--json");
const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const d = db();

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

async function page<T>(table: string, columns: string, column: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const p = await d
      .from(table as never)
      .select(columns)
      .gte(column, `${since}T00:00:00Z`)
      .order(column)
      .range(from, from + 999);
    if (p.error) throw new Error(`${table}: ${p.error.message}`);
    out.push(...(p.data as unknown as T[]));
    if ((p.data ?? []).length < 1000) break;
  }
  return out;
}

type Counter = Record<string, number>;
const bump = (c: Counter, k: string | null, n = 1) => {
  if (k) c[k] = (c[k] ?? 0) + n;
};
const uniq = (m: Map<string, Set<string>>, k: string | null, v: string) => {
  if (!k) return;
  if (!m.has(k)) m.set(k, new Set());
  m.get(k)!.add(v);
};

const articles = await page<{ fetched_at: string; event_id: string | null }>(
  "articles",
  "fetched_at, event_id",
  "fetched_at",
);
const events = await page<{
  id: string;
  first_seen_at: string;
  classified_at: string | null;
  analysed_at: string | null;
  understand: unknown;
}>("events", "id, first_seen_at, classified_at, analysed_at, understand", "first_seen_at");
// Analysed/classified events may have been created before the window.
const analysedRows = await page<{ id: string; analysed_at: string | null; understand: unknown }>(
  "events",
  "id, analysed_at, understand",
  "analysed_at",
);
const classifiedRows = await page<{ id: string; classified_at: string | null }>(
  "events",
  "id, classified_at",
  "classified_at",
);
const matches = await page<{ event_id: string; matched_at: string; user_id: string }>(
  "user_events",
  "event_id, matched_at, user_id",
  "matched_at",
);
const digests = await page<{ digest_id: string; generated_at: string | null; status: string }>(
  "digests",
  "digest_id, generated_at, status",
  "generated_at",
);
const ledger = await page<{
  feature: string | null;
  created_at: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_prompt_tokens: number;
  reasoning_tokens: number;
  cost_microusd: number | null;
  estimated_cost_microusd: number | null;
  reserved_tokens: number;
  request_meta: Record<string, unknown>;
}>(
  "ai_usage_ledger",
  "feature, created_at, prompt_tokens, completion_tokens, cached_prompt_tokens, reasoning_tokens, cost_microusd, estimated_cost_microusd, reserved_tokens, request_meta",
  "created_at",
);

// Delivered = an item in a digest that actually went out. digest_items has no
// timestamp of its own, so the digest's generated day is the delivery day.
const digestById = new Map(digests.map((x) => [x.digest_id, x]));
const items: { digest_id: string; event_id: string }[] = [];
for (let from = 0; ; from += 1000) {
  const p = await d
    .from("digest_items")
    .select("digest_id, event_id")
    .range(from, from + 999);
  if (p.error) throw new Error(`digest_items: ${p.error.message}`);
  items.push(...(p.data as { digest_id: string; event_id: string }[]));
  if ((p.data ?? []).length < 1000) break;
}
let translations = 0;
{
  const p = await d
    .from("event_translations")
    .select("event_id", { count: "exact", head: true })
    .gte("created_at", `${since}T00:00:00Z`);
  translations = p.error ? -1 : (p.count ?? 0);
}

const ingested: Counter = {};
const attached: Counter = {};
const created: Counter = {};
const classified: Counter = {};
const analysed: Counter = {};
const enriched: Counter = {};
const matchedEvents = new Map<string, Set<string>>();
const matchedPairs: Counter = {};
const deliveredEvents = new Map<string, Set<string>>();
const generated: Counter = {};
const calls: Record<string, Counter> = {};
const cost: Record<string, Counter> = {};
const tokensIn: Counter = {};
const tokensOut: Counter = {};
const tokensReason: Counter = {};
const tokensCached: Counter = {};
const unresolved: Counter = {};

for (const a of articles) {
  bump(ingested, day(a.fetched_at));
  if (a.event_id) bump(attached, day(a.fetched_at));
}
for (const e of events) bump(created, day(e.first_seen_at));
for (const e of classifiedRows) bump(classified, day(e.classified_at));
for (const e of analysedRows) {
  bump(analysed, day(e.analysed_at));
  if (e.understand) bump(enriched, day(e.analysed_at));
}
for (const m of matches) {
  uniq(matchedEvents, day(m.matched_at), m.event_id);
  bump(matchedPairs, day(m.matched_at));
}
for (const g of digests) if (g.generated_at) bump(generated, day(g.generated_at));
for (const it of items) {
  const g = digestById.get(it.digest_id);
  if (!g?.generated_at) continue;
  if (g.status !== "sent" && g.status !== "ready") continue;
  uniq(deliveredEvents, day(g.generated_at), it.event_id);
}
for (const r of ledger) {
  const k = day(r.created_at)!;
  const f = r.feature ?? "unknown";
  calls[f] ??= {};
  cost[f] ??= {};
  bump(calls[f], k);
  bump(cost[f], k, r.cost_microusd ?? 0);
  bump(tokensIn, k, r.prompt_tokens);
  bump(tokensOut, k, r.completion_tokens);
  bump(tokensReason, k, r.reasoning_tokens);
  bump(tokensCached, k, r.cached_prompt_tokens);
  if (r.cost_microusd === null && r.reserved_tokens > 0) bump(unresolved, k);
}

const keys = [
  ...new Set([
    ...Object.keys(ingested),
    ...Object.keys(created),
    ...Object.keys(analysed),
    ...matchedEvents.keys(),
    ...deliveredEvents.keys(),
  ]),
].sort();
const features = Object.keys(calls).sort();

const table = keys.map((k) => {
  const an = analysed[k] ?? 0;
  const del = deliveredEvents.get(k)?.size ?? 0;
  const mat = matchedEvents.get(k)?.size ?? 0;
  const usd = features.reduce((t, f) => t + (cost[f]?.[k] ?? 0), 0) / 1e6;
  return {
    day: k,
    articlesIngested: ingested[k] ?? 0,
    articlesAttachedToEvent: attached[k] ?? 0,
    candidateEventsCreated: created[k] ?? 0,
    eventsClassified: classified[k] ?? 0,
    eventsAnalysed: an,
    eventsEnriched: enriched[k] ?? 0,
    uniqueEventsMatched: mat,
    readerEventPairs: matchedPairs[k] ?? 0,
    uniqueEventsDelivered: del,
    digestsGenerated: generated[k] ?? 0,
    clusterCalls: calls["cluster"]?.[k] ?? 0,
    analyseCalls: calls["analyse"]?.[k] ?? 0,
    inputTokens: tokensIn[k] ?? 0,
    completionTokens: tokensOut[k] ?? 0,
    reasoningTokens: tokensReason[k] ?? 0,
    cachedTokens: tokensCached[k] ?? 0,
    unresolvedRows: unresolved[k] ?? 0,
    usd: Number(usd.toFixed(6)),
    analysisAmplification: del ? Number((an / del).toFixed(2)) : null,
    matchingYield: an ? Number((mat / an).toFixed(3)) : null,
    deliveryYield: an ? Number((del / an).toFixed(3)) : null,
    usdPerAnalysedEvent: an ? Number((usd / an).toFixed(5)) : null,
    usdPerDeliveredEvent: del ? Number((usd / del).toFixed(5)) : null,
    tokensPerAnalysedEvent: an ? Math.round(((tokensIn[k] ?? 0) + (tokensOut[k] ?? 0)) / an) : null,
  };
});

if (asJson) {
  console.log(JSON.stringify({ since, days, translations, features, table }, null, 2));
} else {
  const cols: [string, (r: (typeof table)[number]) => string][] = [
    ["day", (r) => r.day],
    ["ingest", (r) => String(r.articlesIngested)],
    ["events", (r) => String(r.candidateEventsCreated)],
    ["clsfy", (r) => String(r.eventsClassified)],
    ["clstAI", (r) => String(r.clusterCalls)],
    ["anlys", (r) => String(r.eventsAnalysed)],
    ["anAI", (r) => String(r.analyseCalls)],
    ["enrich", (r) => String(r.eventsEnriched)],
    ["matchEv", (r) => String(r.uniqueEventsMatched)],
    ["pairs", (r) => String(r.readerEventPairs)],
    ["deliv", (r) => String(r.uniqueEventsDelivered)],
    ["unres", (r) => String(r.unresolvedRows)],
    ["USD", (r) => r.usd.toFixed(4)],
    ["$/anlys", (r) => (r.usdPerAnalysedEvent === null ? "-" : r.usdPerAnalysedEvent.toFixed(4))],
    ["$/deliv", (r) => (r.usdPerDeliveredEvent === null ? "-" : r.usdPerDeliveredEvent.toFixed(4))],
    ["amp", (r) => (r.analysisAmplification === null ? "-" : r.analysisAmplification.toFixed(1))],
    ["mYield", (r) => (r.matchingYield === null ? "-" : r.matchingYield.toFixed(2))],
    ["dYield", (r) => (r.deliveryYield === null ? "-" : r.deliveryYield.toFixed(2))],
  ];
  const widths = cols.map(([h, f]) => Math.max(h.length, ...table.map((r) => f(r).length)));
  const headerParts: string[] = [];
  for (let i = 0; i < cols.length; i++)
    headerParts.push((cols[i]![0] as string).padStart(widths[i] as number));
  console.log(headerParts.join("  "));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of table) {
    const rowParts: string[] = [];
    for (let i = 0; i < cols.length; i++)
      rowParts.push((cols[i]![1] as (r: unknown) => string)(r).padStart(widths[i] as number));
    console.log(rowParts.join("  "));
  }
  console.log(`\ntranslations generated in window: ${translations === -1 ? "n/a" : translations}`);
  console.log("\nUSD by operation and day");
  for (const f of features) {
    const total = keys.reduce((t, k) => t + (cost[f]?.[k] ?? 0), 0) / 1e6;
    console.log(
      `  ${f.padEnd(9)} $${total.toFixed(4)}  calls=${keys.reduce((t, k) => t + (calls[f]?.[k] ?? 0), 0)}`,
    );
  }
}
