/**
 * Audit 45 — where are the missing scheduled invocations going?
 *
 * Audit 44 measured the cadence and found it under the schedule: on 2026-10-06
 * enrich recorded 78 of its 144 design slots, cluster 48/96, classify 57/96,
 * analyse 48/96, match 47/96, digest 904/1440 — while impact 96/96, discover
 * 24/24 and dormant 1/1 were exact. The arbiter opened this audit to find out
 * why, read-only first, and warned against exactly the mistake the Audit 43
 * arithmetic made: do not infer missing runs from downstream output alone.
 *
 * So the expected side is read off the configuration, not assumed:
 *
 *   - the registered triggers come from `triggers.crons` in vite.config.ts, the
 *     same array cron.test.ts holds the exported constants to;
 *   - which stage a STAGES_CRON minute means comes from `stageForMinute`, the
 *     function the deployed handler itself uses.
 *
 * The recorded side is `pipeline_runs`, one row per invocation that reached
 * `recordScheduled` — plus `stage = 'unknown'`, the row its catch writes when the
 * task threw. An invocation that is killed before either write leaves nothing
 * here; `ops_status` is the only other app-side trace, and it is latest-state
 * rather than a log (`cron:heartbeat` is upserted by every invocation, so it
 * says when the dispatch path last worked, not how often it fires). The report
 * prints that heartbeat, then the numbers, and finally the three explanations it
 * cannot separate: never dispatched, dispatched and killed before it wrote
 * anything, dispatched and coalesced by the platform.
 *
 * What it can separate by shape alone:
 *
 *   - lost slots scattered as single minutes point at per-event loss;
 *   - lost slots in contiguous runs point at blocked windows (a deploy, a
 *     platform incident, a Worker that would not start);
 *   - a stage that never loses a slot while its neighbours lose half of theirs
 *     points at the stage, not the dispatcher — every STAGES_CRON minute shares
 *     one trigger, so a trigger-level fault would take all of them;
 *   - duplicate dispatches (two rows for one stage in one minute) land next to
 *     missing ones if the platform is fanning one event out twice, and away
 *     from them if the two faults are independent.
 *
 * SELECT only, service-role client. Node 22 or later.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/audit45-dispatch-rate.ts [--out file.json] [--days N]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { DIGEST_CRON, INGEST_CRON, STAGES_CRON, stageForMinute } from "@/lib/pipeline/cron";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

/** Rows per request. Half the server's 1000-row cap, so a lowered cap still pages. */
const PAGE = 500;
/** Days of `pipeline_runs` history the tables summarise. */
const DEFAULT_DAYS = 14;

/**
 * Rows recorded before Audit 47 have a `finished_at` by construction -- the
 * record was only ever written after the work -- so "unfinished" can only mean
 * anything for runs recorded since. Anything older has `status: "healthy"` and
 * a finish time, and the counts below are bounded to the recent side.
 */
type RunRow = {
  stage: string | null;
  trigger: string | null;
  started_at: string;
  finished_at: string | null;
  status: string | null;
};

function argOf(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** The registered triggers, read from the config that deploys them. */
export function registeredCrons(configPath = "vite.config.ts"): string[] {
  const config = readFileSync(configPath, "utf8");
  const block = /crons:\s*\[([^\]]*)\]/.exec(config);
  if (!block?.[1]) throw new Error(`no triggers.crons array in ${configPath}`);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

/** Expands one cron expression's minute field into the minutes it fires on. */
export function minutesOf(expression: string): number[] {
  const field = expression.split(/\s+/)[0] ?? "";
  if (field === "*") return Array.from({ length: 60 }, (_, minute) => minute);
  const step = /^\*\/(\d+)$/.exec(field);
  if (step?.[1]) {
    const n = Number(step[1]);
    return Array.from({ length: 60 }, (_, minute) => minute).filter((minute) => minute % n === 0);
  }
  return field
    .split(",")
    .map((part) => Number(part))
    .filter((minute) => Number.isInteger(minute) && minute >= 0 && minute < 60);
}

/** Which stage each registered trigger runs at each minute of one UTC day. */
export function expectedSlotsPerDay(crons: string[]): {
  perStage: Map<string, number>;
  perMinute: Map<number, string[]>;
} {
  const perStage = new Map<string, number>();
  const perMinute = new Map<number, string[]>();
  const day = new Date("2026-01-01T00:00:00Z"); // an arbitrary non-noon-hour day for the shape
  for (let minute = 0; minute < 60; minute += 1) {
    const at = new Date(day.getTime() + minute * 60_000);
    for (const cron of crons) {
      if (!minutesOf(cron).includes(minute)) continue;
      const stage =
        cron === DIGEST_CRON
          ? "digest"
          : cron === STAGES_CRON
            ? (stageForMinute(at) ?? "idle (not recorded)")
            : cron === INGEST_CRON
              ? "ingest"
              : `unrecognised:${cron}`;
      perStage.set(stage, (perStage.get(stage) ?? 0) + 1);
      (perMinute.get(minute) ?? perMinute.set(minute, []).get(minute)!).push(stage);
    }
  }
  // The whole day, repeating each hour's shape — the only intra-day variation
  // `stageForMinute` applies is the noon dormant slot.
  const whole = new Map<string, number>();
  for (const [stage, perHour] of perStage) whole.set(stage, perHour * 24);
  const dormant = (whole.get("dormant") ?? 0) + 1;
  whole.set("dormant", dormant);
  whole.set("enrich", (whole.get("enrich") ?? 0) - 1);
  return { perStage: whole, perMinute };
}

main(async () => {
  const out = argOf("--out");
  const days = Number(argOf("--days") ?? DEFAULT_DAYS);
  const client = db();

  heading("Audit 45 — where are the missing scheduled invocations going?");

  const crons = registeredCrons();
  const { perStage: expected, perMinute } = expectedSlotsPerDay(crons);
  say(`registered triggers: ${crons.length}`);
  for (const cron of crons) say(`  ${cron}  (${minutesOf(cron).length} minutes an hour)`);

  heading("Expected slots a day, from the configuration");
  let expectedTotal = 0;
  for (const [stage, n] of [...expected.entries()].sort((a, b) => b[1] - a[1])) {
    say(rowLine(stage, n));
    expectedTotal += n;
  }
  say(rowLine("total", expectedTotal));
  const busyMinutes = [...perMinute.entries()].filter(([, stages]) => stages.length > 0);
  say(rowLine("minutes with a trigger", `${busyMinutes.length} of 60`));
  const shared = busyMinutes.filter(([, stages]) => stages.length > 1);
  say(
    rowLine(
      "minutes with more than one trigger",
      shared.length > 0
        ? shared
            .map(([minute, stages]) => `:${String(minute).padStart(2, "0")} ${stages.join("+")}`)
            .join(" ")
        : 0,
    ),
  );

  // ---------------------------------------------------------------------------
  // Recorded invocations
  // ---------------------------------------------------------------------------
  const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
  const runs: RunRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("pipeline_runs")
      .select("stage, trigger, started_at, finished_at, status")
      .gte("started_at", since)
      .order("started_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`pipeline_runs: ${error.message}`);
    const page = (data ?? []) as RunRow[];
    runs.push(...page);
    if (page.length < PAGE) break;
  }
  say(rowLine("recorded runs read", runs.length));
  say(rowLine("window", `${since.slice(0, 16)}Z .. now`));

  heading(`Recorded against expected, last ${days} days`);
  say("  stage      expected/day   recorded/day   rate");
  const perDay = (n: number): string => (n / days).toFixed(1);
  const rate = (recorded: number, want: number): string =>
    want === 0 ? "n/a" : `${((recorded / (want * days)) * 100).toFixed(0)}%`;
  const stageCounts = new Map<string, number>();
  for (const run of runs) {
    const stage = run.stage ?? "?";
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
  }
  for (const [stage, want] of [...expected.entries()].sort((a, b) => b[1] - a[1])) {
    const got = stageCounts.get(stage) ?? 0;
    say(
      `  ${stage.padEnd(22)} ${String(want).padStart(4)}          ${perDay(got).padStart(6)}        ${rate(got, want).padStart(5)}`,
    );
  }
  const unknown = stageCounts.get("unknown") ?? 0;
  say(rowLine("stage=unknown (the catch wrote it)", unknown));

  // ---------------------------------------------------------------------------
  // Opened but never closed (Audit 47)
  // ---------------------------------------------------------------------------
  // `recordRunLifecycle` writes the receipt before the work and closes it after,
  // so a run that dies mid-invocation -- the subrequest budget is what kills it
  // -- keeps a row with `status: "running"` and no `finished_at`. That is the
  // measurement this instrument could not make before: an unfinished row is a
  // dispatched invocation that ran out of budget, which is exactly the case
  // "cannot be separated" used to cover.
  heading("Opened but never closed (only meaningful since Audit 47 deployed)");
  const unfinished = new Map<string, number>();
  const opened = new Map<string, number>();
  for (const run of runs) {
    const stage = run.stage ?? "?";
    opened.set(stage, (opened.get(stage) ?? 0) + 1);
    if (run.status === "running" || run.finished_at === null) {
      unfinished.set(stage, (unfinished.get(stage) ?? 0) + 1);
    }
  }
  const neverClosed = [...unfinished.values()].reduce((a, b) => a + b, 0);
  if (neverClosed === 0) {
    say(
      "  none: every recorded run has a closing write (expected until the deploy, then per stage below)",
    );
  }
  for (const [stage, n] of [...unfinished.entries()].sort((a, b) => b[1] - a[1])) {
    say(
      `  ${stage.padEnd(22)} ${String(n).padStart(5)} of ${String(opened.get(stage) ?? 0).padEnd(5)} runs  ${((n / (opened.get(stage) ?? 1)) * 100).toFixed(1)}% ran out of budget`,
    );
  }
  const unaccounted = [...stageCounts.entries()].filter(
    ([stage]) => !expected.has(stage) && stage !== "unknown",
  );
  for (const [stage, n] of unaccounted) say(rowLine(`unexpected stage ${stage}`, n));

  // ---------------------------------------------------------------------------
  // Lost slots: scattered or contiguous?
  // ---------------------------------------------------------------------------
  // One map per minute-of-hour: how many of the `days` occurrences fired. Every
  // STAGES_CRON minute shares one trigger, so a trigger-level fault would take
  // them all together; a stage-level one would not.
  const byMinute = new Map<number, Set<string>>();
  for (const run of runs) {
    const at = new Date(run.started_at);
    if (run.stage === null || run.stage === "unknown") continue;
    const key = `${at.toISOString().slice(0, 13)}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
    (
      byMinute.get(at.getUTCMinutes()) ??
      byMinute.set(at.getUTCMinutes(), new Set()).get(at.getUTCMinutes())!
    ).add(key);
  }
  heading("Firing rate by minute of hour (does a minute always fire?)");
  for (const minute of [...byMinute.keys()].sort((a, b) => a - b)) {
    const stages = perMinute.get(minute) ?? [];
    const fired = byMinute.get(minute)?.size ?? 0;
    // One occurrence of a minute-of-hour per hour per day in the window.
    const occurrences = days * 24;
    say(
      `  :${String(minute).padStart(2, "0")}  ${stages.join("+").padEnd(18)} fired ${String(fired).padStart(4)} of ${occurrences}  ${((fired / occurrences) * 100).toFixed(0)}%`,
    );
  }

  // Contiguity: over the whole window, minutes where NO stage recorded anything,
  // and the longest run of them. A long run is a blocked window; single lost
  // minutes are per-event loss.
  const activeMinutes = new Set<string>();
  for (const run of runs) {
    if (run.stage === null || run.stage === "unknown") continue;
    activeMinutes.add(run.started_at.slice(0, 16));
  }
  const missing: string[] = [];
  const slotMinutes = new Set<number>(perMinute.keys());
  for (let t = Date.parse(since); t <= Date.now(); t += 60_000) {
    const minute = new Date(t);
    if (!slotMinutes.has(minute.getUTCMinutes())) continue;
    if (!activeMinutes.has(minute.toISOString().slice(0, 16)))
      missing.push(minute.toISOString().slice(0, 16));
  }
  let longestRun = 0;
  let currentRun = 0;
  for (const minute of missing) {
    const index = missing.indexOf(minute);
    const previous = missing[index - 1];
    if (previous && Date.parse(minute) - Date.parse(previous) === 60_000) currentRun += 1;
    else currentRun = 1;
    if (currentRun > longestRun) longestRun = currentRun;
  }
  heading("Lost slots: scattered or contiguous?");
  say(rowLine("minutes with a trigger", slotMinutes.size));
  say(rowLine("slot-minutes in the window", slotMinutes.size * 24 * days));
  say(rowLine("slot-minutes with no recorded run", missing.length));
  say(rowLine("longest contiguous run", `${longestRun} minute${longestRun === 1 ? "" : "s"}`));
  say(
    rowLine(
      "runs of 3+ lost minutes",
      (() => {
        let count = 0;
        let run = 1;
        for (let i = 1; i < missing.length; i += 1) {
          const gap = Date.parse(missing[i] ?? "") - Date.parse(missing[i - 1] ?? "");
          if (gap === 60_000) run += 1;
          else {
            if (run >= 3) count += 1;
            run = 1;
          }
        }
        if (run >= 3) count += 1;
        return count;
      })(),
    ),
  );
  const perHour = new Map<string, { fired: number; want: number }>();
  for (let t = Date.parse(since); t <= Date.now(); t += 60_000) {
    const minute = new Date(t);
    if (!slotMinutes.has(minute.getUTCMinutes())) continue;
    const hour = minute.toISOString().slice(0, 13);
    const bucket = perHour.get(hour) ?? { fired: 0, want: 0 };
    bucket.want += 1;
    if (activeMinutes.has(minute.toISOString().slice(0, 16))) bucket.fired += 1;
    perHour.set(hour, bucket);
  }
  const partial = [...perHour.entries()].filter(([, b]) => b.fired < b.want);
  const full = [...perHour.entries()].filter(([, b]) => b.fired === b.want);
  say(rowLine("hours with every slot fired", full.length));
  say(rowLine("hours with at least one lost slot", partial.length));
  const worst = partial.sort((a, b) => a[1].fired / a[1].want - b[1].fired / b[1].want).slice(0, 8);
  for (const [hour, bucket] of worst) {
    say(`  ${hour}Z  ${bucket.fired} of ${bucket.want} slots fired`);
  }

  // Duplicate dispatches: two runs of one stage in one minute.
  const perStageMinute = new Map<string, number>();
  for (const run of runs) {
    if (run.stage === null || run.stage === "unknown") continue;
    const key = `${run.stage}@${run.started_at.slice(0, 16)}`;
    perStageMinute.set(key, (perStageMinute.get(key) ?? 0) + 1);
  }
  const duplicates = [...perStageMinute.entries()].filter(([, n]) => n > 1);
  heading("Duplicate dispatches");
  say(rowLine("stage-minutes with 2+ runs", duplicates.length));
  for (const [key, n] of duplicates.slice(0, 10)) say(`  ${key}Z  x${n}`);

  // ---------------------------------------------------------------------------
  // The other trace: the heartbeat
  // ---------------------------------------------------------------------------
  heading("The heartbeat (latest-state, not a log)");
  const { data: ops, error: opsError } = await client
    .from("ops_status")
    .select("key, status, detail, updated_at")
    .like("key", "cron:%")
    .order("updated_at", { ascending: false });
  if (opsError) throw new Error(`ops_status: ${opsError.message}`);
  for (const row of ops ?? []) {
    const detail = (row.detail ?? {}) as Record<string, unknown>;
    const ageMinutes = (Date.now() - Date.parse(row.updated_at)) / 60_000;
    say(
      `  ${String(row.key).padEnd(28)} ${String(row.status).padEnd(8)} stage=${String(detail["stage"] ?? "?")} scheduled_at=${String(detail["scheduled_at"] ?? "?")} updated ${ageMinutes.toFixed(1)}m ago`,
    );
  }

  heading("What these numbers can and cannot separate");
  say(
    "  cannot: never dispatched, dispatched and coalesced — from the rows alone, both leave the same nothing,",
  );
  say(
    "  and ops_status keeps only the latest write. Since Audit 47 a run that starts and dies is visible as an",
  );
  say(
    '  unfinished row, so "dispatched then killed before its record" is no longer in this list; only the',
  );
  say("  unobservable distinction between a dispatch never sent and one coalesced away remains.");
  say(
    "  can: scattered single lost minutes versus contiguous blocked windows; a stage that never loses a",
  );
  say(
    "  slot while every other STAGES_CRON minute loses half; duplicates landing beside or away from losses.",
  );
  say(
    "  the evidence that would separate the three is platform-side (Cloudflare scheduled-event analytics",
  );
  say(
    "  or `wrangler tail` live, not retrospective), which this laptop has no credential for; say so rather",
  );
  say("  than inferring it from downstream output.");

  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          takenAt: new Date().toISOString(),
          days,
          crons,
          expectedPerDay: Object.fromEntries(expected),
          recordedPerDay: Object.fromEntries(
            [...stageCounts.entries()].map(([s, n]) => [s, n / days]),
          ),
          unknownRuns: unknown,
          unfinishedRuns: Object.fromEntries(unfinished),
          lostSlotMinutes: missing.length,
          longestContiguousLostRun: longestRun,
          hoursWithEverySlot: full.length,
          hoursWithLostSlots: partial.length,
          duplicates: duplicates.map(([key, n]) => ({ key, runs: n })),
        },
        null,
        1,
      )}\n`,
    );
    say();
    say(`written to ${out}`);
  }
});
