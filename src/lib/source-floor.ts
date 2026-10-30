/**
 * The daily source floor: how many new English feeds a day owes, and why a day
 * came up short when it does.
 *
 * ---------------------------------------------------------------------------
 * The number
 * ---------------------------------------------------------------------------
 *
 * Fifty new English sources a day is the floor and a hundred is the target
 * (owner, 2026-10-30: "i told you to add 50 to 100 everyday"). It is a floor
 * because the catalogue is the ceiling on everything downstream: a briefing can
 * only cover what a source published, and a country with no listed outlet never
 * appears in any reader's morning.
 *
 * The failure this file is written against is not "the pipeline broke" -- it is
 * "nobody noticed for four weeks". Sources were inserted in two hand-run bursts
 * of ~200 on 2026-10-22 and 2026-10-28 and at 1-2 a day on every day between,
 * and the shortfall was only found when the owner asked. So the answer to a
 * short day is not a log line: it is a named reason, computed the same way every
 * morning, that a person can act on before they have to ask.
 *
 * ---------------------------------------------------------------------------
 * Why the reason is a small closed set
 * ---------------------------------------------------------------------------
 *
 * A reason is only useful if it tells the reader of the card where to look.
 * "Below floor" says nothing. These five say everything the pipeline can say
 * about itself without a human reading logs:
 *
 *   job-never-ran            no wave card was opened and nothing was probed --
 *                            the scheduler or the executor is down, and the fix
 *                            is the job, not the sources.
 *   executor-crashed         every wave card opened yesterday ended in a
 *                            failure, so the work was queued and lost.
 *   no-candidates            the pool was empty yesterday morning: discovery,
 *                            not insertion, is the thing to repair.
 *   all-rejected-by-language the probes ran and the language gate refused them,
 *                            so the pool is full of the wrong countries.
 *   supply-short             everything ran, there were candidates, some passed
 *                            -- just not fifty. This is the honest measured gap.
 *
 * The order matters. A day where the job never ran has no candidates *because*
 * it never ran, and reporting `no-candidates` would send somebody to repair
 * discovery that is working fine.
 *
 * ---------------------------------------------------------------------------
 * The day is the operator's day
 * ---------------------------------------------------------------------------
 *
 * Windows are computed in the operator's timezone (JST, +09:00 by default), not
 * UTC: "yesterday" is the day the owner lived through, and a count that resets
 * at 09:00 local is a count that argues with the calendar. `date -u` was the
 * obvious implementation and it was wrong for exactly that reason.
 */

/** New English sources a day owes. Under this, the day is reported as short. */
export const DAILY_FLOOR = 50;

/** What a good day looks like. Above this the wave stops probing and saves the rest. */
export const DAILY_TARGET = 100;

/** Operator timezone offset, minutes east of UTC. JST, where the owner is. */
export const OPERATOR_OFFSET_MINUTES = 9 * 60;

/** One day, as the morning report counts it. */
export type FloorDay = {
  /** `YYYY-MM-DD` in the operator's timezone. */
  day: string;
  /** New sources created in the window whose first fetch succeeded. */
  inserted: number;
  /** Candidates probed in the window, whatever the outcome. */
  probes: number;
  /** Candidates refused by the language gate. */
  languageRejected: number;
  /** Candidates refused for every other reason (dead feed, duplicate, timeout). */
  otherRejected: number;
  /** Fresh candidates available at the start of the day, before it consumed any. */
  supply: number;
  /** Wave cards opened for the day. */
  wavesCreated: number;
  /** Of those, the ones that ended failed or expired. */
  wavesFailed: number;
};

export type ShortfallReason =
  | "floor-met"
  | "job-never-ran"
  | "executor-crashed"
  | "no-candidates"
  | "all-rejected-by-language"
  | "supply-short";

export type DayVerdict = {
  day: string;
  short: boolean;
  reason: ShortfallReason;
  /** One sentence naming the gap and where to look, for a card title or a log. */
  detail: string;
};

/**
 * The verdict for one day.
 *
 * `short` is the only field the alarm branches on; `reason` and `detail` are
 * what the card says, and they are computed here rather than in the shell
 * wrapper so the classification is tested instead of eyeballed.
 */
export function assessDay(day: FloorDay, floor: number = DAILY_FLOOR): DayVerdict {
  if (day.inserted >= floor) {
    return {
      day: day.day,
      short: false,
      reason: "floor-met",
      detail: `${day.inserted} new English sources, floor ${floor}.`,
    };
  }

  const gap = floor - day.inserted;
  const refused = day.languageRejected + day.otherRejected;

  if (day.wavesCreated === 0 && day.probes === 0) {
    return {
      day: day.day,
      short: true,
      reason: "job-never-ran",
      detail: `${day.inserted}/${floor}: no wave card opened and no candidate probed that day -- the daily job itself did not run.`,
    };
  }

  if (day.wavesCreated > 0 && day.wavesFailed >= day.wavesCreated) {
    return {
      day: day.day,
      short: true,
      reason: "executor-crashed",
      detail: `${day.inserted}/${floor}: all ${day.wavesCreated} wave card(s) for the day ended failed -- the work was queued and lost.`,
    };
  }

  if (day.supply === 0) {
    return {
      day: day.day,
      short: true,
      reason: "no-candidates",
      detail: `${day.inserted}/${floor}: the candidate pool was empty -- discovery, not insertion, is the thing to repair.`,
    };
  }

  if (day.probes === 0) {
    return {
      day: day.day,
      short: true,
      reason: "job-never-ran",
      detail: `${day.inserted}/${floor}: ${day.supply} candidates were waiting and none was probed -- the executor did not do its part.`,
    };
  }

  if (day.languageRejected > 0 && day.languageRejected >= Math.ceil(day.probes * 0.8)) {
    return {
      day: day.day,
      short: true,
      reason: "all-rejected-by-language",
      detail: `${day.inserted}/${floor}: ${day.languageRejected} of ${day.probes} probes were refused by the language gate -- the pool is full of the wrong countries.`,
    };
  }

  return {
    day: day.day,
    short: true,
    reason: "supply-short",
    detail: `${day.inserted}/${floor}: ${day.probes} probed, ${refused} refused (${day.languageRejected} for language), gap ${gap}.`,
  };
}

/**
 * The UTC boundaries of one operator-timezone day.
 *
 * A local day starts at `00:00+09:00`, which is `15:00Z` the afternoon before,
 * so the window has to be built by shifting the epoch rather than by string
 * concatenation -- string math would widen the day by nine hours at one end and
 * lose them at the other.
 */
export function dayWindow(
  day: string,
  offsetMinutes: number = OPERATOR_OFFSET_MINUTES,
): { day: string; start: string; end: string } {
  const startMs = Date.parse(`${day}T00:00:00Z`) - offsetMinutes * 60_000;
  const endMs = startMs + 24 * 60 * 60_000;
  return {
    day,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

/** The operator-timezone date of an instant, as `YYYY-MM-DD`. */
export function operatorDay(
  instant: Date = new Date(),
  offsetMinutes: number = OPERATOR_OFFSET_MINUTES,
): string {
  return new Date(instant.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** A day shifted by whole days, as `YYYY-MM-DD`. */
export function shiftDay(day: string, deltaDays: number): string {
  const start = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(start)) throw new Error(`not a day: ${day}`);
  return new Date(start + deltaDays * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

/** A day index that advances by one per calendar day, for rotation. */
export function dayIndexOf(day: string): number {
  const start = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(start)) throw new Error(`not a day: ${day}`);
  return Math.floor(start / (24 * 60 * 60_000));
}

/**
 * The morning report: one line per day, newest last, with the floor visible.
 *
 * Written as text rather than JSON because the first reader is a person
 * deciding whether to act, and the alarm's card body is this string. The JSON
 * the script also emits is for the scheduler, not for the eyes.
 */
export function reportLines(
  days: readonly FloorDay[],
  options: { floor?: number; target?: number } = {},
): string[] {
  const floor = options.floor ?? DAILY_FLOOR;
  const target = options.target ?? DAILY_TARGET;
  const header = `${"day".padEnd(10)} ${"new".padStart(5)} ${"probes".padStart(6)} ${"lang✗".padStart(6)} ${"supply".padStart(6)}  verdict`;
  const lines = [header];

  for (const day of days) {
    const verdict = assessDay(day, floor);
    const mark = day.inserted >= target ? "✓" : day.inserted >= floor ? "·" : "✗";
    lines.push(
      `${day.day.padEnd(10)} ${String(day.inserted).padStart(5)} ${String(day.probes).padStart(6)} ${String(day.languageRejected).padStart(6)} ${String(day.supply).padStart(6)}  ${mark} ${verdict.reason}`,
    );
  }

  return lines;
}

/**
 * The alarm card's body: the gap, the reason, and what the reason points at.
 *
 * The card exists so the owner reads it before asking. So it leads with the
 * number, then the named cause, then the remedy that cause calls for -- and it
 * links the day's numbers rather than paraphrasing them.
 */
export function alarmCardBody(
  verdict: DayVerdict,
  days: readonly FloorDay[],
  floor: number = DAILY_FLOOR,
): string {
  const remedy: Record<ShortfallReason, string> = {
    "floor-met": "Nothing to do: the day met the floor.",
    "job-never-ran":
      "Check the scheduler: `hermes cron list` should show the source wave and discovery jobs enabled, and `~/.hermes/scripts/nyuz-bulk-sources-card.sh` should have opened a card for the slot.",
    "executor-crashed":
      "Check the wave card that failed on the board: the run history says how it died. Re-queue the unconsumed candidates; nothing in the pool was lost.",
    "no-candidates":
      "Repair discovery, not insertion: run `npm run source:discover` and check that the outlet indexes and peer crawls are returning hosts (`~/.hermes/state/nyuz-source-growth/ledger.jsonl`).",
    "all-rejected-by-language":
      "The pool is pulling outlets that are not English. Widen the country rotation in `GROWTH_COUNTRIES`, or check that the gate is not refusing a whole region by accident (`npm run source:floor -- --day <day>`).",
    "supply-short":
      "Everything ran and the pool was thin. Raise the discovery cap (`npm run source:discover -- --countries 12 --peers 80`) until the morning pool holds at least three days of the floor.",
  };

  const row = days.find((day) => day.day === verdict.day);
  const inserted = row?.inserted ?? 0;

  return [
    `# Source floor short: ${verdict.day} added ${inserted}, floor ${floor}`,
    "",
    verdict.detail,
    "",
    "## Reason class",
    "",
    `\`${verdict.reason}\` — ${remedy[verdict.reason]}`,
    "",
    "## Days",
    "",
    "```",
    ...reportLines(days, { floor }),
    "```",
    "",
    "## What the floor means",
    "",
    "Fifty new English sources a day, measured as sources whose first fetch succeeded inside the operator's day (JST).",
    "A source counts once it has fetched: an insert that never returned an item is not a source.",
    "Language is the text's, not the outlet's country: an English daily in Lagos counts, a Portuguese one in Lisbon does not.",
  ].join("\n");
}
