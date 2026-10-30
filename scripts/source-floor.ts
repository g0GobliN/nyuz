/**
 * The morning check: did yesterday add 50-100 new English sources, and if not,
 * which part of the pipeline is the reason?
 *
 *   npm run source:floor
 *   npm run source:floor -- --day 2026-10-27 --days 10
 *   npm run source:floor -- --json --waves-created 2 --waves-failed 0
 *   npm run source:floor -- --fixture zero       # the under-50 branch, on demand
 *
 * ---------------------------------------------------------------------------
 * What "added" means, exactly
 * ---------------------------------------------------------------------------
 *
 * A source counts on the day it was created in the operator's timezone AND has a
 * `last_fetched_at`. The wave tool stamps that timestamp with the probe that
 * proved the feed returns items, so an inserted row that has never fetched is
 * not counted, and neither is a candidate that resolved but failed to write.
 * That is the card's rule: "do not count a source as added until its first
 * successful fetch."
 *
 * Language refusals are counted from `source_candidates.reject_reason`, where the
 * wave tool writes `non-english:<detector reason>` for every feed the gate
 * refused. So the answer to "how many were rejected for language yesterday" is a
 * query, not a memory.
 *
 * ---------------------------------------------------------------------------
 * Why it classifies instead of just printing
 * ---------------------------------------------------------------------------
 *
 * The card's second failure was not the low number, it was that nobody knew
 * which low number it was: a broken scheduler and an empty candidate pool look
 * identical in a row count and need opposite repairs. `assessDay` in
 * `src/lib/source-floor.ts` names the class, and this script supplies the
 * evidence it needs -- including the wave cards, which the caller passes in
 * because they live on the board, not in the product database.
 *
 * Exit code: 0 when the target day met the floor, 1 when it did not. That is
 * what makes it usable as a cron gate as well as a report.
 */

import { db, fail, heading, main, say } from "./lib/db.ts";
import {
  alarmCardBody,
  assessDay,
  DAILY_FLOOR,
  DAILY_TARGET,
  dayWindow,
  operatorDay,
  reportLines,
  shiftDay,
  type FloorDay,
} from "@/lib/source-floor";

type Args = {
  day: string;
  days: number;
  floor: number;
  wavesCreated: number;
  wavesFailed: number;
  json: boolean;
  fixture: "zero" | "thin" | null;
};

main(async () => {
  const args = parseArgs(process.argv.slice(2));

  if (args.fixture !== null) {
    reportFixture(args);
    return;
  }

  const days = await readDays(args);
  const target = days[days.length - 1];
  if (target === undefined) fail("no days to report");

  const verdict = assessDay(target, args.floor);
  const pool = await poolNow();

  heading(`Source floor — ${args.day}`);
  say(reportLines(days, { floor: args.floor, target: DAILY_TARGET }).join("\n"));
  say("");
  say(`verdict  ${verdict.reason} — ${verdict.detail}`);
  say(
    `pool now ${pool.discovered} discovered · ${pool.registered} registered · ${pool.rejected} rejected`,
  );

  if (args.json) {
    say("");
    say(
      JSON.stringify({
        day: args.day,
        floor: args.floor,
        verdict,
        days,
        pool,
      }),
    );
  } else if (verdict.short) {
    say("");
    say(alarmCardBody(verdict, days, args.floor));
  } else {
    say("");
    say("Floor met. Nothing to open, nothing to say.");
  }

  if (verdict.short) process.exitCode = 1;
});

/* ---------------------------------------------------------------------- */
/* The evidence                                                            */
/* ---------------------------------------------------------------------- */

/** Counts for `--days` days ending at `--day`, oldest first. */
async function readDays(args: Args): Promise<FloorDay[]> {
  const out: FloorDay[] = [];
  for (let offset = args.days - 1; offset >= 0; offset -= 1) {
    const day = shiftDay(args.day, -offset);
    const window = dayWindow(day);
    const inserted = await countSources(window.start, window.end);
    const probes = await countCandidates(window.start, window.end, { probed: true });
    const languageRejected = await countCandidates(window.start, window.end, { language: true });
    const otherRejected = await countCandidates(window.start, window.end, { rejectedOther: true });
    const supply = await countPoolAtEnd(window.end);

    // The wave cards only describe the target day: the caller (the cron wrapper)
    // counts the board for today, and asking the board about last week is not
    // something this script can do without a local kanban read.
    const isTarget = day === args.day;
    out.push({
      day,
      inserted,
      probes,
      languageRejected,
      otherRejected,
      supply,
      wavesCreated: isTarget ? args.wavesCreated : 0,
      wavesFailed: isTarget ? args.wavesFailed : 0,
    });
  }
  return out;
}

/** Sources created inside the window that have fetched at least once. */
async function countSources(start: string, end: string): Promise<number> {
  const { count, error } = await db()
    .from("sources")
    .select("id", { count: "exact" })
    .gte("created_at", start)
    .lt("created_at", end)
    .not("last_fetched_at", "is", null)
    .limit(1);
  if (error) fail(`counting sources: ${error.message}`);
  return count ?? 0;
}

/** Candidates the wave touched inside the window, by outcome. */
async function countCandidates(
  start: string,
  end: string,
  which: { probed?: boolean; language?: boolean; rejectedOther?: boolean },
): Promise<number> {
  const base = () =>
    db()
      .from("source_candidates")
      .select("id", { count: "exact" })
      .is("first_topic_id", null)
      .is("first_job_id", null)
      .gte("updated_at", start)
      .lt("updated_at", end)
      .limit(1);

  let query = base();
  if (which.language === true) query = query.like("reject_reason", "non-english%");
  if (which.rejectedOther === true) {
    query = query.eq("status", "rejected").not("reject_reason", "like", "non-english%");
  }
  if (which.probed === true) query = query.gt("probe_attempts", 0);

  const { count, error } = await query;
  if (error) fail(`counting candidates: ${error.message}`);
  return count ?? 0;
}

/** Fresh candidates the pool held at the end of the window. */
async function countPoolAtEnd(end: string): Promise<number> {
  const { count, error } = await db()
    .from("source_candidates")
    .select("id", { count: "exact" })
    .is("first_topic_id", null)
    .is("first_job_id", null)
    .eq("status", "discovered")
    .lt("created_at", end)
    .limit(1);
  if (error) fail(`counting the pool: ${error.message}`);
  return count ?? 0;
}

/** The pool as it stands now, for the reading of tomorrow's supply. */
async function poolNow(): Promise<{ discovered: number; registered: number; rejected: number }> {
  const one = async (status: "discovered" | "registered" | "rejected") => {
    const { count, error } = await db()
      .from("source_candidates")
      .select("id", { count: "exact" })
      .is("first_topic_id", null)
      .is("first_job_id", null)
      .eq("status", status)
      .limit(1);
    if (error) fail(`counting pool: ${error.message}`);
    return count ?? 0;
  };
  return {
    discovered: await one("discovered"),
    registered: await one("registered"),
    rejected: await one("rejected"),
  };
}

/* ---------------------------------------------------------------------- */
/* Fixtures: the under-50 branch, on demand                                */
/* ---------------------------------------------------------------------- */

/**
 * A synthetic day, so the shortfall branch can be exercised without waiting for
 * a real shortfall.
 *
 * The card asks for the under-50 branch to be exercised on a synthetic zero, and
 * it is right to: an alarm that has never fired is an alarm nobody knows works.
 * `zero` is a day where nothing ran at all; `thin` is a day where everything ran
 * and the pool was merely small, which is the more common real shape.
 */
function reportFixture(args: Args): void {
  const zero = args.fixture === "zero";
  const day: FloorDay = {
    day: args.day,
    inserted: zero ? 0 : 31,
    probes: zero ? 0 : 180,
    languageRejected: zero ? 0 : 22,
    otherRejected: zero ? 0 : 127,
    supply: zero ? 0 : 240,
    wavesCreated: zero ? 0 : 2,
    wavesFailed: 0,
  };
  const verdict = assessDay(day, args.floor);

  heading(`Source floor — fixture ${args.fixture ?? "zero"} — ${args.day}`);
  say(reportLines([day], { floor: args.floor }).join("\n"));
  say("");
  say(`verdict  ${verdict.reason} — ${verdict.detail}`);
  say("");
  say(alarmCardBody(verdict, [day], args.floor));
  process.exitCode = 1;
}

/* ---------------------------------------------------------------------- */
/* Plumbing                                                                */
/* ---------------------------------------------------------------------- */

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    day: shiftDay(operatorDay(), -1),
    days: 10,
    floor: DAILY_FLOOR,
    wavesCreated: 0,
    wavesFailed: 0,
    json: false,
    fixture: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--day":
        args.day = value ?? args.day;
        index += 1;
        break;
      case "--days":
        args.days = numberOr(value, args.days, flag);
        index += 1;
        break;
      case "--floor":
        args.floor = numberOr(value, args.floor, flag);
        index += 1;
        break;
      case "--waves-created":
        args.wavesCreated = numberOr(value, args.wavesCreated, flag);
        index += 1;
        break;
      case "--waves-failed":
        args.wavesFailed = numberOr(value, args.wavesFailed, flag);
        index += 1;
        break;
      case "--fixture":
        if (value !== "zero" && value !== "thin") fail("--fixture is zero or thin");
        args.fixture = value;
        index += 1;
        break;
      case "--json":
        args.json = true;
        break;
      case "--yesterday":
        args.day = shiftDay(operatorDay(), -1);
        break;
      default:
        if (flag !== undefined && flag.startsWith("--")) fail(`unknown flag ${flag}`);
    }
  }

  return args;
}

function numberOr(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) fail(`${flag} needs a number, got ${raw}`);
  return parsed;
}
