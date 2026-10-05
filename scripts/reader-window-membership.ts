/**
 * Audit 31 follow-up — are the starved events actually inside the window?
 *
 * The aggregate floor census said the 60-row candidate window spans only
 * 3.3h-33.7h of article age and covers 59 of 400 arm events. But the 23 events
 * the control group tracked are mostly YOUNGER than that floor, so aggregate
 * reach does not by itself explain their 0/23 drain. This script asks the
 * question directly, per event: for each tracked event id, is any of its
 * articles inside the exact 60-slot window the stage builds, and if not, why
 * not — no articles, too old, or already enriched.
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

const VISIBLE_DAYS = 7;
const EVENT_CAP = 400;
const ARM_ROWS = 400;
const ARM_ID_CHUNK = 200;
const WINDOW = 60;
const FAILURE_THRESHOLD = 5;

type Candidate = {
  id: string;
  event_id: string | null;
  published_at: string;
  sources: { enrichment_failure_count: number | null } | null;
};

/** One line of the per-event verdict table printed below. */
type VerdictRow = {
  eventId: string;
  title: string;
  cls: string;
  t0pos: number | null;
  armNow: string;
  articles: number;
  freshestAgeH: number | null;
  windowRank: number | null;
  lastAttempt: string;
  failureCount: number | null;
  verdict: string;
};

main(async () => {
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const trackedPath = argOf("--tracked");
  const out = argOf("--out");
  if (!trackedPath) throw new Error("pass --tracked <drain-t0.json>");
  const tracked = (
    JSON.parse(readFileSync(trackedPath, "utf8")) as {
      zero: { id: string; cls: string; position: number | null; title: string }[];
    }
  ).zero;
  // Audit 32's pre-change census: every briefed zero-evidence event, not just
  // the original 23 in-cap controls, so the before/after metric covers the
  // whole backlog the fix is meant to reach.

  const now = Date.now();
  const client = db();

  const visibleSince = new Date(now - VISIBLE_DAYS * 24 * 3_600_000).toISOString();
  const touched = new Map<string, string>();
  const { data: matches, error: matchError } = await client
    .from("user_events")
    .select("event_id, matched_at")
    .gte("matched_at", visibleSince)
    .order("matched_at", { ascending: false })
    .limit(ARM_ROWS);
  if (matchError) throw new Error(`user_events: ${matchError.message}`);
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
  const arm = [...touched.entries()]
    .sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? 1 : -1))
    .slice(0, EVENT_CAP)
    .map(([id]) => id);

  const candidates: Candidate[] = [];
  for (let i = 0; i < arm.length; i += ARM_ID_CHUNK) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, published_at, sources(enrichment_failure_count)")
      .in("event_id", arm.slice(i, i + ARM_ID_CHUNK));
    if (error) throw new Error(`articles: ${error.message}`);
    candidates.push(...((data ?? []) as unknown as Candidate[]));
  }
  candidates.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const windowIds = new Set(candidates.slice(0, WINDOW).map((c) => c.id));
  const statusByArticle = new Map<string, string | null>();
  for (let i = 0; i < candidates.length; i += ARM_ID_CHUNK) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, status")
      .in(
        "article_id",
        candidates.slice(i, i + ARM_ID_CHUNK).map((c) => c.id),
      );
    if (error) throw new Error(`article_evidence: ${error.message}`);
    for (const row of data as { article_id: string; status: string | null }[])
      statusByArticle.set(row.article_id, row.status);
  }

  // The tracked events read their OWN articles directly, bypassing the arm, so
  // "no article in the arm" is distinguishable from "article exists, too old".
  const trackedIds = tracked.map((entry) => entry.id);
  const own: Candidate[] = [];
  for (let i = 0; i < trackedIds.length; i += ARM_ID_CHUNK) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, published_at, sources(enrichment_failure_count)")
      .in("event_id", trackedIds.slice(i, i + ARM_ID_CHUNK));
    if (error) throw new Error(`articles(tracked): ${error.message}`);
    own.push(...((data ?? []) as unknown as Candidate[]));
  }
  const ownStatus = new Map<string, { status: string | null; extractedAt: string | null }>();
  for (let i = 0; i < own.length; i += ARM_ID_CHUNK) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, status, extracted_at")
      .in(
        "article_id",
        own.slice(i, i + ARM_ID_CHUNK).map((c) => c.id),
      );
    if (error) throw new Error(`article_evidence(tracked): ${error.message}`);
    for (const row of data as {
      article_id: string;
      status: string | null;
      extracted_at: string | null;
    }[])
      ownStatus.set(row.article_id, { status: row.status, extractedAt: row.extracted_at });
  }
  const armIds = new Set(arm);
  const byEvent = new Map<string, Candidate[]>();
  for (const article of own) {
    if (article.event_id === null) continue;
    const list = byEvent.get(article.event_id) ?? [];
    list.push(article);
    byEvent.set(article.event_id, list);
  }
  const newestRank = new Map<string, number>();
  candidates.forEach((c, index) => {
    if (c.event_id !== null && !newestRank.has(c.event_id)) newestRank.set(c.event_id, index + 1);
  });

  heading("The briefed zero-evidence backlog, asked directly");
  const rows: VerdictRow[] = [];
  const tally = new Map<string, number>();
  for (const entry of tracked) {
    const articles = (byEvent.get(entry.id) ?? []).sort(
      (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at),
    );
    const inArm = armIds.has(entry.id);
    const inWindow = articles.find((a) => windowIds.has(a.id)) ?? null;
    const freshest = articles[0];
    let verdict: string;
    if (articles.length === 0) verdict = "no_articles";
    else if (!inArm) verdict = "outside_arm";
    else if (inWindow) {
      const failed = inWindow.sources?.enrichment_failure_count ?? 0;
      verdict =
        (ownStatus.get(inWindow.id) ?? null) !== null
          ? "in_window_has_evidence"
          : failed >= FAILURE_THRESHOLD
            ? "in_window_backoff"
            : "IN_WINDOW_ELIGIBLE";
    } else verdict = "in_arm_too_old";
    const failureCount = freshest?.sources?.enrichment_failure_count ?? null;
    const ownRow = freshest ? ownStatus.get(freshest.id) : undefined;
    const lastAttempt = ownRow ? (ownRow.extractedAt ?? "pending-no-timestamp") : "never_attempted";
    tally.set(verdict, (tally.get(verdict) ?? 0) + 1);
    rows.push({
      eventId: entry.id,
      title: entry.title.slice(0, 44),
      cls: entry.cls,
      t0pos: entry.position ?? null,
      armNow: inArm ? "yes" : "NO",
      articles: articles.length,
      freshestAgeH: freshest
        ? Math.round(((now - Date.parse(freshest.published_at)) / 3_600_000) * 10) / 10
        : null,
      windowRank: newestRank.get(entry.id) ?? null,
      lastAttempt,
      failureCount,
      verdict,
    });
  }
  for (const [verdict, count] of [...tally.entries()].sort((a, b) => b[1] - a[1]))
    say(rowLine(verdict, count));
  say();
  for (const r of rows)
    say(
      `  arm:${r.armNow.padEnd(3)}  arts:${String(r.articles).padStart(2)}  age:${String(r.freshestAgeH ?? "-").padStart(6)}h  rank:${String(r.windowRank ?? "-").padStart(4)}  ${r.lastAttempt.padEnd(20)}  ${r.verdict}  ${r.title}`,
    );

  if (out)
    writeFileSync(
      out,
      `${JSON.stringify({ takenAt: new Date(now).toISOString(), rows }, null, 1)}\n`,
    );
});
