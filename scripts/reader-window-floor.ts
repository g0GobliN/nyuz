/**
 * Audit 31 follow-up — where does the enrichment stage's candidate window end?
 *
 * The 24h census falsified the cap hypothesis: the 23 events that were inside
 * the arm cap at t0 drained 0 of 23 while sitting at arm positions 145-169,
 * comfortably inside the raised cap of 400. The cap is therefore not the
 * binding constraint. `enrich.ts` applies a second, narrower window AFTER the
 * arm: `armCandidates` sorts every article in the arm by `published_at`
 * descending and cuts to `CANDIDATE_WINDOW_ROWS` (60), and the tick then
 * enriches only `ENRICH_LIMIT` (3) of whatever survives the done/backoff
 * filter.
 *
 * This script measures that window instead of reasoning about it: it rebuilds
 * the arm exactly as `readerVisibleEventIds` does, pulls every article attached
 * to it, and reports where the 60th-newest article lands in age. If the floor
 * is young, then every article below it is invisible to the stage no matter how
 * many ticks run, and the zero-evidence backlog cannot drain.
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

const VISIBLE_DAYS = 7;
const EVENT_CAP = 400;
const ARM_ROWS = 400;
const ARM_ID_CHUNK = 200;
/** `CANDIDATE_WINDOW_ROWS` in src/lib/pipeline/enrich.ts. */
const WINDOW = 60;
/** `ENRICHMENT_FAILURE_THRESHOLD` in the same file. */
const FAILURE_THRESHOLD = 5;

type Candidate = {
  id: string;
  event_id: string | null;
  published_at: string;
  sources: { enrichment_failure_count: number | null } | null;
};
type EvidenceRow = { article_id: string; status: string | null };

const hours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)}h`;

main(async () => {
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = argOf("--out");
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

  const armSet = new Set(arm);
  heading("The arm (cap 400)");
  say(rowLine("touched events in 7d", touched.size));
  say(rowLine("events after the cap", arm.length));

  const candidates: Candidate[] = [];
  for (let i = 0; i < arm.length; i += ARM_ID_CHUNK) {
    const { data, error } = await client
      .from("articles")
      .select("id, event_id, published_at, sources(enrichment_failure_count)")
      .in("event_id", arm.slice(i, i + ARM_ID_CHUNK));
    if (error) throw new Error(`articles: ${error.message}`);
    candidates.push(...((data ?? []) as unknown as Candidate[]));
  }
  say(rowLine("articles in the arm", candidates.length));

  candidates.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));

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
    for (const row of (data ?? []) as EvidenceRow[])
      statusByArticle.set(row.article_id, row.status);
  }

  // The window exactly as `armCandidates` builds it: newest-published first,
  // cut to 60.
  const window = candidates.slice(0, WINDOW);
  const last = window.at(-1);
  heading("Where the 60-row window ends");
  if (!last) throw new Error("the arm produced no candidates");
  say(rowLine("newest article age", hours(now - Date.parse(window[0]?.published_at ?? ""))));
  say(rowLine(`newest-first rank ${WINDOW} age`, hours(now - Date.parse(last.published_at))));
  say(
    rowLine(
      "articles older than that floor",
      candidates.filter((c) => Date.parse(c.published_at) < Date.parse(last.published_at)).length,
    ),
  );

  // What one tick actually gets to work on, after the dead head is removed.
  const eligible = window.filter((c) => {
    if (statusByArticle.get(c.id)) return false;
    return (c.sources?.enrichment_failure_count ?? 0) < FAILURE_THRESHOLD;
  });
  heading("One tick's real supply from that window");
  say(rowLine("window slots", window.length));
  say(
    rowLine(
      "already have evidence",
      window.length - window.filter((c) => !statusByArticle.get(c.id)).length,
    ),
  );
  say(rowLine("eligible after filter", eligible.length));
  say(rowLine("enriched per tick", 3));
  const eligibleEvents = new Set(
    eligible.map((c) => c.event_id).filter((id): id is string => id !== null),
  );
  say(rowLine("distinct events reachable this tick", eligibleEvents.size));

  // The whole point: how much of the arm does the window not reach at all?
  const windowEvents = new Set(
    window.map((c) => c.event_id).filter((id): id is string => id !== null),
  );
  const unreachable = arm.filter((id) => !windowEvents.has(id));
  heading("Arm events the window never sees");
  say(rowLine("arm events in window", windowEvents.size));
  say(rowLine("arm events never seen", unreachable.length));
  say(rowLine("share of arm unseen", `${Math.round((unreachable.length / arm.length) * 100)}%`));

  // And the zero-evidence backlog, split by whether the window can reach it.
  const briefedIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("user_events")
      .select("event_id, briefed_at")
      .range(from, from + 999);
    if (error) throw new Error(`user_events: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as { event_id: string | null; briefed_at: string | null }[])
      if (row.event_id && row.briefed_at !== null) briefedIds.add(row.event_id);
  }
  const zeroEvents = new Set<string>();
  for (const article of candidates) {
    if (article.event_id === null || zeroEvents.has(article.event_id)) continue;
    if (!briefedIds.has(article.event_id)) continue;
    if (statusByArticle.get(article.id)) continue;
    zeroEvents.add(article.event_id);
  }
  heading("Zero-evidence backlog vs the window floor");
  const inside = [...zeroEvents].filter((id) => windowEvents.has(id));
  say(rowLine("zero-evidence events in arm", zeroEvents.size));
  say(rowLine("reachable by the window today", inside.length));
  say(rowLine("structurally out of the window", zeroEvents.size - inside.length));

  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          takenAt: new Date(now).toISOString(),
          armSize: arm.length,
          articlesInArm: candidates.length,
          windowFloorAgeHours:
            Math.round(((now - Date.parse(last.published_at)) / 3_600_000) * 10) / 10,
          armEventsNeverSeen: unreachable.length,
          zeroEventsInArm: zeroEvents.size,
          zeroEventsReachable: inside.length,
        },
        null,
        1,
      )}\n`,
    );
    say();
    say(`written to ${out}`);
  }
});
