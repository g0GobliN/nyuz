/**
 * Audit 31 — does the existing enrichment capacity drain a reader's own backlog?
 *
 * Audit 30 closed with the matching layer clean and reader-visible evidence
 * coverage adopted as the quality metric (t0: 95/475 = 20.0% for the one
 * active reader). The arbiter approved exactly one next measurement: a
 * 24-hour re-census of the reader's briefed-but-zero-evidence events, to
 * establish whether the shipped drain fails to clear that population before
 * anyone proposes a reader-priority arm. The enrichment machinery itself is
 * untouched.
 *
 * This script is the instrument. It rebuilds the enrich stage's priority arm
 * EXACTLY as `readerVisibleEventIds` does — every reader's `user_events`
 * matched_at plus every delivered digest's items, inside
 * `READER_VISIBLE_DAYS` (7), arm reads capped at 400 rows, the merge capped at
 * the newest 120 events — and classifies every briefed zero-evidence event:
 *
 *   priority_pos_N    inside the cap: reachable now, position N of 120
 *   priority_beyond   touched within 7 days but ranked past the 120 cap
 *   fallback_arm      no recent touch, but an article published within 72h
 *   outside_both_arms no recent touch and nothing published within 72h:
 *                     unreachable by design until something touches it
 *
 * Run it now for the t0 baseline and again in 24h with `--baseline t0.json`:
 * the diff reports gained / remaining / newly-zero, and the evidence-row
 * totals in both files give the drain's measured throughput over the window.
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

const WINDOW_DAYS = 30;
const WINDOW_LIMIT = 1000;
const PAGE = 1000;
const CHUNK = 200;
/** The enrich stage's own constants, restated so the classes stay honest. */
const VISIBLE_DAYS = 7;
/** Audit 31 ruling: raised from 120 to 400, matching the arm-row read caps. */
const EVENT_CAP = 400;
const ARM_ROWS = 400;
const FALLBACK_HOURS = 72;

type EventDbRow = { id: string; title: string; importance: number | null; first_seen_at: string };
type ArticleDbRow = { id: string; event_id: string | null; published_at: string };
type EvidenceDbRow = { article_id: string; evidence: unknown };
type PairDbRow = {
  user_id: string;
  event_id: string;
  matched_at: string;
  briefed_at: string | null;
};

type ZeroEvent = {
  id: string;
  title: string;
  importance: number | null;
  publishedAgeHours: number | null;
  cls: string;
  position: number | null;
};

main(async () => {
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const baselinePath = argOf("--baseline");
  const out = argOf("--out");
  const now = Date.now();
  const client = db();

  const since = new Date(now - WINDOW_DAYS * 24 * 3_600_000).toISOString();
  const { data: eventRows, error: eventError } = await client
    .from("events")
    .select("id, title, importance, first_seen_at")
    .eq("status", "complete")
    .gte("first_seen_at", since)
    .order("first_seen_at", { ascending: false })
    .limit(WINDOW_LIMIT);
  if (eventError) throw new Error(`events: ${eventError.message}`);
  const events = (eventRows ?? []) as unknown as EventDbRow[];
  const eventById = new Map(events.map((event) => [event.id, event]));
  const ids = events.map((event) => event.id);
  heading(`Window: complete events from the last ${WINDOW_DAYS} days`);
  say(rowLine("complete events", events.length));

  const articles: ArticleDbRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, published_at")
      .in("event_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`articles: ${error.message}`);
    articles.push(...((data ?? []) as unknown as ArticleDbRow[]));
  }
  const articlesByEvent = new Map<string, ArticleDbRow[]>();
  for (const article of articles) {
    if (article.event_id === null) continue;
    const list = articlesByEvent.get(article.event_id) ?? [];
    list.push(article);
    articlesByEvent.set(article.event_id, list);
  }
  say(rowLine("articles attached", articles.length));

  const unitsByArticle = new Map<string, number>();
  const articleIds = articles.map((article) => article.id);
  for (let i = 0; i < articleIds.length; i += CHUNK) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, evidence")
      .in("article_id", articleIds.slice(i, i + CHUNK));
    if (error) throw new Error(`article_evidence: ${error.message}`);
    for (const row of (data ?? []) as EvidenceDbRow[])
      unitsByArticle.set(row.article_id, Array.isArray(row.evidence) ? row.evidence.length : 0);
  }
  say(rowLine("evidence rows present", unitsByArticle.size));

  const { count: evidenceTotal, error: totalError } = await client
    .from("article_evidence")
    .select("*", { count: "exact", head: true });
  if (totalError) throw new Error(`article_evidence(count): ${totalError.message}`);
  say(rowLine("evidence rows, all time", evidenceTotal ?? 0));

  const pairs: PairDbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("user_events")
      .select("user_id, event_id, matched_at, briefed_at")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`user_events: ${error.message}`);
    if (!data || data.length === 0) break;
    pairs.push(...((data ?? []) as unknown as PairDbRow[]));
    if (data.length < PAGE) break;
  }
  say(rowLine("match pairs, all readers", pairs.length));

  /**
   * The priority arm, rebuilt line-for-line from `readerVisibleEventIds`:
   * every reader's matches plus every delivered digest's items inside the
   * 7-day window, arm reads capped at 400 rows, merge capped at the newest
   * 120 events by touch time.
   */
  const visibleSince = new Date(now - VISIBLE_DAYS * 24 * 3_600_000).toISOString();
  const touched = new Map<string, string>();
  const { data: matches, error: matchError } = await client
    .from("user_events")
    .select("event_id, matched_at")
    .gte("matched_at", visibleSince)
    .order("matched_at", { ascending: false })
    .limit(ARM_ROWS);
  if (matchError) throw new Error(`user_events(arm): ${matchError.message}`);
  for (const row of (matches ?? []) as { event_id: string | null; matched_at: string }[]) {
    if (!row.event_id) continue;
    const prior = touched.get(row.event_id);
    if (!prior || row.matched_at > prior) touched.set(row.event_id, row.matched_at);
  }
  const { data: sends, error: sendError } = await client
    .from("deliveries")
    .select("digest_id, delivered_at")
    .gte("delivered_at", visibleSince)
    .order("delivered_at", { ascending: false })
    .limit(ARM_ROWS);
  if (sendError) throw new Error(`deliveries: ${sendError.message}`);
  const deliveredAt = new Map<string, string>();
  for (const row of (sends ?? []) as { digest_id: string | null; delivered_at: string | null }[]) {
    if (!row.digest_id || !row.delivered_at) continue;
    const prior = deliveredAt.get(row.digest_id);
    if (!prior || row.delivered_at > prior) deliveredAt.set(row.digest_id, row.delivered_at);
  }
  const digestIds = [...deliveredAt.keys()];
  for (let i = 0; i < digestIds.length; i += 200) {
    const { data: items, error: itemsError } = await client
      .from("digest_items")
      .select("digest_id, event_id")
      .in("digest_id", digestIds.slice(i, i + 200));
    if (itemsError) throw new Error(`digest_items: ${itemsError.message}`);
    for (const item of (items ?? []) as { digest_id: string | null; event_id: string | null }[]) {
      if (!item.digest_id || !item.event_id) continue;
      const at = deliveredAt.get(item.digest_id);
      if (!at) continue;
      const prior = touched.get(item.event_id);
      if (!prior || at > prior) touched.set(item.event_id, at);
    }
  }
  const priorityIds = [...touched.entries()]
    .sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? 1 : -1))
    .slice(0, EVENT_CAP)
    .map(([id], index) => [id, index + 1] as const);
  const positionOf = new Map(priorityIds);
  say(rowLine("priority-arm events (cap 120)", priorityIds.length));

  /** The reader-visible zero-evidence population: briefed by anyone, no units. */
  const briefed = new Set<string>();
  for (const pair of pairs) if (pair.briefed_at !== null) briefed.add(pair.event_id);
  const zero: ZeroEvent[] = [];
  for (const event of events) {
    if (!briefed.has(event.id)) continue;
    const own = articlesByEvent.get(event.id) ?? [];
    const units = own.reduce((sum, article) => sum + (unitsByArticle.get(article.id) ?? 0), 0);
    if (units > 0) continue;
    const position = positionOf.get(event.id) ?? null;
    let cls: string;
    if (position !== null) cls = "priority_pos";
    else if (touched.has(event.id)) cls = "priority_beyond";
    else {
      const freshest = own.reduce<number>((best, article) => {
        const parsed = Date.parse(article.published_at);
        return Number.isFinite(parsed) ? Math.max(best, parsed) : best;
      }, 0);
      cls =
        freshest > 0 && now - freshest <= FALLBACK_HOURS * 3_600_000
          ? "fallback_arm"
          : "outside_both_arms";
    }
    const freshest = own.reduce<number>((best, article) => {
      const parsed = Date.parse(article.published_at);
      return Number.isFinite(parsed) ? Math.max(best, parsed) : best;
    }, 0);
    zero.push({
      id: event.id,
      title: event.title,
      importance: event.importance,
      publishedAgeHours: freshest > 0 ? Math.round(((now - freshest) / 3_600_000) * 10) / 10 : null,
      cls,
      position,
    });
  }
  zero.sort(
    (a, b) =>
      (a.position ?? 999) - (b.position ?? 999) || (b.importance ?? 0) - (a.importance ?? 0),
  );

  heading("Reader-visible zero-evidence population (t)");
  const byClass = new Map<string, number>();
  for (const item of zero) byClass.set(item.cls, (byClass.get(item.cls) ?? 0) + 1);
  for (const [cls, count] of [...byClass.entries()].sort((a, b) => b[1] - a[1]))
    say(rowLine(cls, count));
  say(rowLine("total", zero.length));
  const important = zero.filter((item) => (item.importance ?? 0) >= 7);
  say(rowLine("importance >= 7", important.length));

  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      zero: ZeroEvent[];
      evidenceRowsAllTime: number;
    };
    const before = new Set(baseline.zero.map((item) => item.id));
    const after = new Set(zero.map((item) => item.id));
    const gained = [...before].filter((id) => !after.has(id));
    const remaining = [...before].filter((id) => after.has(id));
    const newlyZero = [...after].filter((id) => !before.has(id));
    heading(`Drain since baseline (${baseline.zero.length} zero-evidence events)`);
    say(rowLine("gained evidence", gained.length));
    say(rowLine("still zero-evidence", remaining.length));
    say(rowLine("newly zero-evidence", newlyZero.length));
    say(rowLine("evidence rows created", (evidenceTotal ?? 0) - baseline.evidenceRowsAllTime));
    const stillZero = zero.filter((item) => before.has(item.id));
    heading("Where the remaining zero-evidence events sit");
    const remainingByClass = new Map<string, number>();
    for (const item of stillZero)
      remainingByClass.set(item.cls, (remainingByClass.get(item.cls) ?? 0) + 1);
    for (const [cls, count] of [...remainingByClass.entries()].sort((a, b) => b[1] - a[1]))
      say(rowLine(cls, count));
  }

  heading("Oldest still-unreachable (outside_both_arms), worst first");
  for (const item of zero
    .filter((entry) => entry.cls === "outside_both_arms")
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 5))
    say(
      `  imp ${String(item.importance ?? 0).padStart(2)}  ${String(item.publishedAgeHours ?? 0).padStart(6)}h  ${item.title}`,
    );

  if (out) {
    const payload = {
      takenAt: new Date(now).toISOString(),
      evidenceRowsAllTime: evidenceTotal ?? 0,
      priorityArmSize: priorityIds.length,
      zero,
    };
    writeFileSync(out, `${JSON.stringify(payload, null, 1)}\n`);
    say();
    say(`written to ${out}`);
  }
});
