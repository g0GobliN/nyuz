/**
 * Does an alert actually go out, and when it does, is it breaking news?
 *
 *   npm run audit:alerts                 -- the last 7 days
 *   npm run audit:alerts -- --days 3     -- a narrower window
 *
 * The product claims an out-of-schedule send the moment something important
 * happens (`alerts.ts`). Four gates have to line up for that to be true — the
 * event clearing `IMPORTANT_FLOOR`, the reader's `breaking` mode and plan, the
 * event being inside `FLASH_POLICY`, and `breaking_alerts` being on — and each
 * one fails silently. The dashboard's empty state says "None have gone out",
 * which is the same sentence whether nothing important happened, whether the
 * pipeline analysed everything too late to be breaking, or whether a flag is
 * off. Those are three different products and one string.
 *
 * So this measures the funnel rather than the count, from the top:
 *
 *   happened        events whose occurrence clock is inside the window
 *   important       of those, `importance >= IMPORTANT_FLOOR`
 *   analysed        ...and when analysis ran, how long after they happened
 *   matched         ...and whether any reader was matched to them
 *   in-reach        ...and whether the event was still inside `FLASH_POLICY`
 *                    at match time -- the gate that decides whether an alert was
 *                    ever *possible*, whatever the flag said
 *   alerted         ...and whether an alert was actually created
 *
 * The `analysed` and `in-reach` rows are the ones worth the whole script: the
 * flash window is 12h preferred and 24h hard, so an event analysed 30 hours
 * after it happened can never be breaking however important it is, and no
 * amount of raising the floor, the cap or the burst changes that.
 *
 * SELECT only, service-role client. Node 22 or later.
 */

import { IMPORTANT_FLOOR, withinFlashWindow } from "@/lib/pipeline/alerts";
import { FLASH_POLICY, ageHours } from "@/lib/pipeline/freshness";
import { assessReadiness } from "@/lib/pipeline/readiness";
import { PLAN_LIMITS, allowedBreaking } from "@/lib/plans";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";
import { loadCorpusEvents, storyForEvent } from "./lib/corpus.ts";

const DEFAULT_DAYS = 7;
const PAGE = 1000;
/** Ids per `.in()`; over 400 PostgREST silently returns nothing. */
const CHUNK = 200;
/** How many stories each list prints before it stops being readable. */
const SHOW = 25;

type EventRow = {
  id: string;
  title: string;
  what_happened: string | null;
  importance: number | null;
  status: string;
  first_seen_at: string;
  material_occurrence_at: string | null;
  material_revision: number;
  analysed_at: string | null;
  publisher_count: number | null;
};

type MatchRow = {
  user_id: string;
  event_id: string;
  matched_at: string;
  delivered_revision: number;
};

type PrefRow = {
  user_id: string;
  breaking: string | null;
  channels: string[] | null;
  paused: boolean | null;
};

/** The occurrence clock, which is the only clock an alert is judged on. */
function eventClock(event: EventRow): string {
  return event.material_occurrence_at ?? event.first_seen_at;
}

function hours(value: string, at: Date): number {
  return ageHours(value, at);
}

function short(value: string, width = 78): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

main(async () => {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const days = Number(flag("--days") ?? DEFAULT_DAYS);
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 3_600_000).toISOString();
  const client = db();

  heading(`The window — events from the last ${days} days`);
  const events: EventRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("events")
      .select(
        "id, title, what_happened, importance, status, first_seen_at, material_occurrence_at, material_revision, analysed_at, publisher_count",
      )
      .gte("first_seen_at", since)
      .order("first_seen_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`events: ${error.message}`);
    if (!data || data.length === 0) break;
    events.push(...(data as EventRow[]));
    if (data.length < PAGE) break;
  }
  say(rowLine("events", events.length));
  if (events.length === 0) {
    say("nothing to measure: no event in this window");
    return;
  }

  /** The occurrence clock, as the alert stage reads it: never discovery time. */
  const occurred = (event: EventRow): string => eventClock(event);
  const complete = events.filter((event) => event.status === "complete");
  const important = complete.filter((event) => (event.importance ?? 0) >= IMPORTANT_FLOOR);

  heading("1. Is the flag even on, and who is listening");
  const { data: flagRow, error: flagError } = await client
    .from("feature_flags")
    .select("enabled")
    .eq("key", "breaking_alerts")
    .maybeSingle();
  if (flagError) throw new Error(`feature_flags: ${flagError.message}`);
  say(
    rowLine(
      "breaking_alerts",
      flagRow ? (flagRow.enabled ? "on" : "OFF") : "missing (reads as off)",
    ),
  );

  const { data: prefs, error: prefError } = await client
    .from("notification_preferences")
    .select("user_id, breaking, channels, paused");
  if (prefError) throw new Error(`notification_preferences: ${prefError.message}`);
  const readers = (prefs ?? []) as PrefRow[];
  const { data: subs, error: subError } = await client
    .from("subscriptions")
    .select("user_id, plan");
  if (subError) throw new Error(`subscriptions: ${subError.message}`);
  const planByUser = new Map((subs ?? []).map((row) => [row.user_id, row.plan]));
  say(rowLine("readers with a preference row", readers.length));

  let listening = 0;
  const byMode: Record<string, number> = {};
  for (const reader of readers) {
    const plan = planByUser.get(reader.user_id) ?? "uno";
    const effective = allowedBreaking(plan, (reader.breaking ?? "off") as "important");
    byMode[effective] = (byMode[effective] ?? 0) + 1;
    if (effective !== "off" && !reader.paused) listening += 1;
  }
  for (const [mode, count] of Object.entries(byMode).sort()) say(rowLine(`  ${mode}`, count));
  say(rowLine("able to receive an alert at all", listening));

  heading("2. The funnel — how far down the line an important story gets");
  say(rowLine("complete events", complete.length));
  say(rowLine(`importance >= ${IMPORTANT_FLOOR}`, important.length));

  const { data: alertDigests, error: digestError } = await client
    .from("digests")
    .select("digest_id, user_id, generated_at")
    .eq("kind", "alert")
    .order("generated_at", { ascending: false });
  if (digestError) throw new Error(`digests: ${digestError.message}`);
  const alertIds = (alertDigests ?? []).map((row) => row.digest_id);
  const alertedEventIds = new Set<string>();
  const alertItems: { digest_id: string; event_id: string; delivered_revision: number }[] = [];
  for (let i = 0; i < alertIds.length; i += CHUNK) {
    const { data, error } = await client
      .from("digest_items")
      .select("digest_id, event_id, delivered_revision")
      .in("digest_id", alertIds.slice(i, i + CHUNK));
    if (error) throw new Error(`digest_items: ${error.message}`);
    for (const row of data ?? []) {
      alertItems.push(row as (typeof alertItems)[number]);
      alertedEventIds.add(row.event_id);
    }
  }
  say(rowLine("alerts ever created (digests kind=alert)", alertIds.length));
  say(rowLine("distinct events ever alerted", alertedEventIds.size));
  // Printed in time order, and with the newest named, because the first version of
  // this script listed an unordered slice and reading it produced the flatly wrong
  // conclusion "no alert in forty days" -- the newest rows simply were not among
  // the twenty-five printed. A count with no order is not a record of recency.
  const newestAlert = (alertDigests ?? [])[0]?.generated_at ?? "";
  const oldestAlert = (alertDigests ?? [])[alertIds.length - 1]?.generated_at ?? "";
  say(rowLine("newest alert", newestAlert.slice(0, 16) || "-"));
  say(rowLine("oldest alert", oldestAlert.slice(0, 16) || "-"));

  const { data: matches, error: matchError } = await client
    .from("user_events")
    .select("user_id, event_id, matched_at, delivered_revision")
    .gte("matched_at", since);
  if (matchError) throw new Error(`user_events: ${matchError.message}`);
  const matchRows = (matches ?? []) as MatchRow[];
  const matchesByEvent = new Map<string, MatchRow[]>();
  for (const row of matchRows) {
    const list = matchesByEvent.get(row.event_id) ?? [];
    list.push(row);
    matchesByEvent.set(row.event_id, list);
  }
  say(rowLine("matches in the window", matchRows.length));
  say(
    rowLine(
      "of which on an important event",
      important.filter((e) => matchesByEvent.has(e.id)).length,
    ),
  );

  /**
   * The two rows this script exists for.
   *
   * `analysed after` is the lag between the moment the story happened and the
   * moment the pipeline knew what it was. `in reach at match` is whether the
   * event was still inside `FLASH_POLICY` when it reached a reader — i.e.
   * whether an alert was possible at all, before any preference is consulted.
   */
  const lags: number[] = [];
  let analysedLate = 0;
  let inReach = 0;
  let outOfReach = 0;
  for (const event of important) {
    if (event.analysed_at) {
      const lag = hours(occurred(event), new Date(event.analysed_at));
      if (lag > FLASH_POLICY.maxHours) analysedLate += 1;
      lags.push(lag);
    }
    const rows = matchesByEvent.get(event.id) ?? [];
    if (rows.length === 0) continue;
    const reachable = rows.some((row) =>
      withinFlashWindow(occurred(event), new Date(row.matched_at)),
    );
    if (reachable) inReach += 1;
    else outOfReach += 1;
  }
  lags.sort((a, b) => a - b);
  const median = lags.length > 0 ? lags[Math.floor(lags.length / 2)] : undefined;
  say(
    rowLine(
      "  occurrence -> analysis lag (median h)",
      median === undefined ? "-" : median.toFixed(1),
    ),
  );
  say(
    rowLine(
      "  occurrence -> analysis lag (max h)",
      lags.length > 0 ? lags[lags.length - 1]!.toFixed(1) : "-",
    ),
  );
  say(rowLine(`  analysed more than ${FLASH_POLICY.maxHours}h after it happened`, analysedLate));
  say(rowLine("matched AND still inside the flash window", inReach));
  say(rowLine("matched but already outside it (was never alertable)", outOfReach));

  heading("3. The important stories, in occurrence order");
  for (const event of important.slice(0, SHOW)) {
    const age = hours(occurred(event), now);
    const rows = matchesByEvent.get(event.id) ?? [];
    const reachable = rows.some((row) =>
      withinFlashWindow(occurred(event), new Date(row.matched_at)),
    );
    const alerted = alertedEventIds.has(event.id);
    const analysedLag = event.analysed_at
      ? hours(occurred(event), new Date(event.analysed_at))
      : null;
    say(
      `  imp=${String(event.importance ?? 0).padStart(2)} ` +
        `age=${age.toFixed(1).padStart(5)}h ` +
        `analysed+${analysedLag === null ? "  n/a" : analysedLag.toFixed(1).padStart(5)}h ` +
        `${alerted ? "ALERTED" : reachable ? "in-reach" : "        "} ` +
        `m=${String(rows.length).padStart(3)} ` +
        `rev=${event.material_revision} ${short(event.title)}`,
    );
  }
  if (important.length > SHOW) say(`  … and ${important.length - SHOW} more`);

  heading("4. Would the alert survive the gate the briefing uses?");
  // The briefing withholds what the reader cannot use -- `assessReadiness` -- and
  // this is the question the alert path does not ask. Every story an alert would
  // carry is put through the same gate, with the coverage and the event clock the
  // composer would have, so "published as breaking, withheld as a briefing item"
  // is a measurement rather than a suspicion.
  const modeByUser = new Map<string, string>();
  const pausedByUser = new Map<string, boolean>();
  for (const reader of readers) {
    const plan = planByUser.get(reader.user_id) ?? "uno";
    modeByUser.set(
      reader.user_id,
      allowedBreaking(plan, (reader.breaking ?? "off") as "important"),
    );
    pausedByUser.set(reader.user_id, reader.paused === true);
  }
  const wouldAlert = important.filter((event) => {
    const rows = matchesByEvent.get(event.id) ?? [];
    return rows.some(
      (row) =>
        withinFlashWindow(occurred(event), new Date(row.matched_at)) &&
        !alertedEventIds.has(event.id),
    );
  });
  say(rowLine("alertable now (matched, in reach, not yet alerted)", wouldAlert.length));

  /**
   * Who the alertable set is actually alertable *for*.
   *
   * "16 alertable events and no alert in forty days" is two different findings
   * depending on this: if they are matched to a reader whose `breaking` is off or
   * who is paused, the silence is a setting and the product is working; if they
   * are matched to a reader who is listening, the send path is not running and
   * that is a defect. The count above cannot tell those apart, which is exactly
   * the mistake this script exists to avoid.
   */
  let reachableForListener = 0;
  let matchedButSilenced = 0;
  const silencedBy: Record<string, number> = {};
  for (const event of wouldAlert) {
    const rows = (matchesByEvent.get(event.id) ?? []).filter((row) =>
      withinFlashWindow(occurred(event), new Date(row.matched_at)),
    );
    const listener = rows.find(
      (row) =>
        modeByUser.get(row.user_id) !== "off" &&
        modeByUser.get(row.user_id) !== undefined &&
        !pausedByUser.get(row.user_id),
    );
    if (listener) {
      reachableForListener += 1;
      continue;
    }
    matchedButSilenced += 1;
    const mode = rows[0] ? (modeByUser.get(rows[0].user_id) ?? "no preference row") : "none";
    const key = pausedByUser.get(rows[0]?.user_id ?? "") ? "paused" : mode;
    silencedBy[key] = (silencedBy[key] ?? 0) + 1;
  }
  say(rowLine("  ...for a reader who is listening", reachableForListener));
  say(rowLine("  ...matched only to a reader who is not", matchedButSilenced));
  for (const [key, count] of Object.entries(silencedBy).sort()) {
    say(rowLine(`    blocked by: ${key}`, count));
  }
  // Keyed by whatever the gate says, not by a list written here. A fixed set of
  // buckets turned the first `newsletter` refusal into `other` — a number that
  // still agreed with the total for a reason nobody could read.
  const verdicts: Record<string, number> = {};
  const refused: { title: string; kind: string; reason: string }[] = [];
  const coverage = await loadCorpusEvents(
    wouldAlert.length,
    undefined,
    undefined,
    wouldAlert.map((event) => event.id),
  );
  for (const story of coverage) {
    const verdict = assessReadiness({
      title: story.title,
      whatHappened: story.what,
      sourceCount: story.sources,
      sources: story.sourceList,
      sourceKinds: story.sourceKinds,
      publishedAt: story.publishedAt,
    });
    verdicts[verdict.ready ? "ready" : verdict.kind] =
      (verdicts[verdict.ready ? "ready" : verdict.kind] ?? 0) + 1;
    if (verdict.ready) continue;
    refused.push({
      title: story.title,
      kind: verdict.kind,
      reason: verdict.reason,
    });
  }
  say(rowLine("  would publish", verdicts["ready"] ?? 0));
  say(rowLine("  refused by the gate <- the alert path never asks", refused.length));
  for (const [kind, count] of Object.entries(verdicts).sort()) {
    if (kind === "ready") continue;
    say(rowLine(`    ${kind}`, count));
  }
  for (const entry of refused.slice(0, SHOW)) {
    say(`  · [${entry.kind}] ${short(entry.title, 70)}\n      ${short(entry.reason, 100)}`);
  }

  heading("5. The alerts themselves, newest first");
  if (alertIds.length === 0) {
    say("  none — no reader has ever received a breaking alert");
  } else {
    const generatedById = new Map(
      (alertDigests ?? []).map((row) => [row.digest_id, row.generated_at ?? ""]),
    );
    const userIdByDigest = new Map((alertDigests ?? []).map((row) => [row.digest_id, row.user_id]));
    // Read the alerted events by id rather than looking them up in the window:
    // the alerts that exist are months old, so a window lookup answered `imp=?`
    // for every one of them — the instrument reporting its own blind spot as if
    // it were a property of the alerts.
    const sentIds = [...new Set(alertItems.map((item) => item.event_id))].slice(0, 500);
    const sentEvents: EventRow[] = [];
    for (let i = 0; i < sentIds.length; i += CHUNK) {
      const { data, error } = await client
        .from("events")
        .select(
          "id, title, what_happened, importance, status, first_seen_at, material_occurrence_at, material_revision, analysed_at, publisher_count",
        )
        .in("id", sentIds.slice(i, i + CHUNK));
      if (error) throw new Error(`events by id: ${error.message}`);
      sentEvents.push(...((data ?? []) as EventRow[]));
    }
    const eventById = new Map(sentEvents.map((event) => [event.id, event]));
    // Newest first, so the top of this list answers "what has an alert actually
    // carried lately" rather than "an arbitrary twenty-five of them".
    const ordered = [...alertItems].sort((a, b) =>
      (generatedById.get(b.digest_id) ?? "").localeCompare(generatedById.get(a.digest_id) ?? ""),
    );
    for (const item of ordered.slice(0, SHOW)) {
      const event = eventById.get(item.event_id);
      const sentAt = generatedById.get(item.digest_id) ?? "";
      const ageAtSend = event && sentAt ? hours(occurred(event), new Date(sentAt)) : null;
      say(
        `  ${sentAt.slice(0, 16)} user=${(userIdByDigest.get(item.digest_id) ?? "").slice(0, 8)} ` +
          `imp=${String(event?.importance ?? "?").padStart(2)} ` +
          `age-at-send=${ageAtSend === null ? "n/a" : `${ageAtSend.toFixed(1)}h`} ` +
          `${short(event?.title ?? item.event_id, 60)}`,
      );
    }
  }

  heading("6. What the plan entitles, against what the safety cap allows");
  say(
    rowLine("plura alertDailyCap (claim_alert is authoritative)", PLAN_LIMITS.plura.alertDailyCap),
  );
  say(rowLine("important stories per day in this window", (important.length / days).toFixed(1)));
  const daysWithAlert = new Set(
    (alertDigests ?? [])
      .filter((row) => (row.generated_at ?? "") >= since)
      .map((row) => (row.generated_at ?? "").slice(0, 10))
      .filter((value) => value !== ""),
  );
  say(rowLine("days in this window with at least one alert", daysWithAlert.size));

  heading("Read this way");
  say(
    "  `analysed more than 24h after it happened` is the row that decides the product claim: an event\n" +
      "  the pipeline understood a day late can never be breaking, and the reader is told nothing about\n" +
      "  it until their next briefing. `matched but already outside it` is the same fact seen at the\n" +
      "  reader's end. Neither is a preference, a cap or a floor — raising those changes neither number.",
  );
});
