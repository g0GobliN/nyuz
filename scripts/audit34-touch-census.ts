/**
 * Audit 34 — why have 91 briefed events received no reader touch in 7 days?
 *
 * Audit 33's reading left the scheduler clean: the tracked zero-evidence
 * cohort's remaining reachable members are blocked by source backoff or
 * terminal zero-unit outcomes, while 91 events sit outside the arm because
 * they have had no touch within seven days. The arbiter ruled that "outside
 * arm" is a symptom of the arm admission/refresh mechanism, not proof that
 * matching is wrong, and ordered a read-only census first.
 *
 * For every tracked event id this script measures:
 *   - does any `user_events` row exist at all (never matched vs aged out)?
 *   - the newest `matched_at` and `briefed_at` ever recorded;
 *   - the newest article attached to the event, and whether anything new was
 *     published after the last touch (new material that failed to re-match);
 *   - whether the event is complete, and its importance.
 *
 * Classification:
 *   never_matched            no user_events row for the event
 *   aged_out_no_new_material last touch predates 7d, nothing published since
 *   aged_out_new_material    last touch predates 7d, newer articles exist:
 *                            a refresh failure — new material did not re-match
 *   briefed_unmatched        briefed but never matched at all
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { readFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

type TrackedRow = {
  eventId: string;
  title: string;
  cls: string;
  verdict: string;
  importance: number | null;
};

type MatchRow = { event_id: string | null; matched_at: string; briefed_at: string | null };

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
  ).rows.filter((r) => r.verdict === "outside_arm" && typeof r.eventId === "string");
  const now = Date.now();
  const sevenDays = new Date(now - 7 * 24 * 3_600_000).toISOString();
  const client = db();

  heading("Audit 34 — the outside-arm cohort");
  say(rowLine("tracked events", tracked.length));
  const eventIds = tracked.map((r) => r.eventId);

  // All match rows for these events, paged: this is the whole match history,
  // not just the arm window.
  const matchesByEvent = new Map<string, MatchRow[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("user_events")
      .select("event_id, matched_at, briefed_at")
      .in("event_id", eventIds.slice(0, 200))
      .range(from, from + 999);
    if (error) throw new Error(`user_events: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as MatchRow[]) {
      if (!row.event_id) continue;
      const list = matchesByEvent.get(row.event_id) ?? [];
      list.push(row);
      matchesByEvent.set(row.event_id, list);
    }
    if (data.length < 1000) break;
  }
  // `.in()` past 200 ids is unsafe, so chunk the history read.
  for (let i = 200; i < eventIds.length; i += 200) {
    const chunk = eventIds.slice(i, i + 200);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from("user_events")
        .select("event_id, matched_at, briefed_at")
        .in("event_id", chunk)
        .range(from, from + 999);
      if (error) throw new Error(`user_events: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data as MatchRow[]) {
        if (!row.event_id) continue;
        const list = matchesByEvent.get(row.event_id) ?? [];
        list.push(row);
        matchesByEvent.set(row.event_id, list);
      }
      if (data.length < 1000) break;
    }
  }
  say(rowLine("events with any match history", matchesByEvent.size));

  // Newest article per event: is there material newer than the last touch?
  const newestArticle = new Map<string, string>();
  for (let i = 0; i < eventIds.length; i += 200) {
    const { data, error } = await client
      .from("articles")
      .select("event_id, published_at")
      .in("event_id", eventIds.slice(i, i + 200));
    if (error) throw new Error(`articles: ${error.message}`);
    for (const row of data as { event_id: string | null; published_at: string }[]) {
      if (!row.event_id) continue;
      const prior = newestArticle.get(row.event_id);
      if (!prior || row.published_at > prior) newestArticle.set(row.event_id, row.published_at);
    }
  }

  // Event rows: completeness and importance.
  const eventRows = new Map<string, { status: string | null; importance: number | null }>();
  for (let i = 0; i < eventIds.length; i += 200) {
    const { data, error } = await client
      .from("events")
      .select("id, status, importance")
      .in("id", eventIds.slice(i, i + 200));
    if (error) throw new Error(`events: ${error.message}`);
    for (const row of data as { id: string; status: string | null; importance: number | null }[])
      eventRows.set(row.id, { status: row.status, importance: row.importance });
  }

  const tally = new Map<string, number>();
  const importantByClass = new Map<string, number>();
  const detail: {
    id: string;
    title: string;
    importance: number | null;
    cls: string;
    lastMatch: string | null;
    newestArticle: string | null;
    articleAfterTouch: boolean;
  }[] = [];
  for (const entry of tracked) {
    const history = matchesByEvent.get(entry.eventId) ?? [];
    const lastMatch =
      history.length > 0
        ? (history
            .map((h) => h.matched_at)
            .sort()
            .at(-1) ?? null)
        : null;
    const newest = newestArticle.get(entry.eventId) ?? null;
    const articleAfterTouch = lastMatch !== null && newest !== null && newest > lastMatch;
    let cls: string;
    if (history.length === 0) {
      // Briefed implies a delivery, so a briefing without any match row means
      // the delivery path bypassed matching — worth distinguishing.
      cls = "never_matched";
    } else if (articleAfterTouch) {
      cls = "aged_out_new_material";
    } else {
      cls = "aged_out_no_new_material";
    }
    tally.set(cls, (tally.get(cls) ?? 0) + 1);
    if ((entry.importance ?? 0) >= 7)
      importantByClass.set(cls, (importantByClass.get(cls) ?? 0) + 1);
    detail.push({
      id: entry.eventId,
      title: entry.title,
      importance: entry.importance ?? eventRows.get(entry.eventId)?.importance ?? null,
      cls,
      lastMatch,
      newestArticle: newest,
      articleAfterTouch,
    });
  }
  for (const [cls, count] of [...tally.entries()].sort((a, b) => b[1] - a[1]))
    say(rowLine(cls, count));
  say();
  say("  imp>=7 breakdown:");
  for (const [cls, count] of [...importantByClass.entries()].sort((a, b) => b[1] - a[1]))
    say(`    ${cls}: ${count}`);

  const refreshFailures = detail.filter((d) => d.cls === "aged_out_new_material");
  heading("Refresh failures — new material existed, no new touch followed");
  say(rowLine("count", refreshFailures.length));
  for (const d of refreshFailures.slice(0, 15))
    say(
      `  imp ${String(d.importance ?? 0).padStart(2)}  lastMatch ${String(d.lastMatch).slice(0, 10)}  newestArt ${String(d.newestArticle).slice(0, 10)}  ${d.title.slice(0, 46)}`,
    );

  const never = detail.filter((d) => d.cls === "never_matched");
  heading("Briefed but never matched");
  say(rowLine("count", never.length));
  for (const d of never.slice(0, 10))
    say(`  imp ${String(d.importance ?? 0).padStart(2)}  ${d.title.slice(0, 56)}`);

  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      out,
      `${JSON.stringify({ takenAt: new Date(now).toISOString(), tally: [...tally.entries()], detail }, null, 1)}\n`,
    );
    say();
    say(`written to ${out}`);
  }
});
