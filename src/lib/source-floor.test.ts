import { describe, expect, it } from "vitest";
import {
  alarmCardBody,
  assessDay,
  dayIndexOf,
  dayWindow,
  DAILY_FLOOR,
  DAILY_TARGET,
  operatorDay,
  reportLines,
  shiftDay,
  type FloorDay,
} from "./source-floor";

const MET: FloorDay = {
  day: "2026-10-29",
  inserted: 62,
  probes: 90,
  languageRejected: 20,
  otherRejected: 8,
  supply: 300,
  wavesCreated: 2,
  wavesFailed: 0,
};

const ZERO: FloorDay = {
  day: "2026-10-30",
  inserted: 0,
  probes: 0,
  languageRejected: 0,
  otherRejected: 0,
  supply: 0,
  wavesCreated: 0,
  wavesFailed: 0,
};

/**
 * A past day, as the report builds one: the counts are real and the wave
 * evidence is null because only the day being reported carries it. This is the
 * 2026-10-27 row from the card that opened this work.
 */
const UNMEASURED: FloorDay = {
  day: "2026-10-27",
  inserted: 2,
  probes: 0,
  languageRejected: 0,
  otherRejected: 0,
  supply: 0,
  wavesCreated: null,
  wavesFailed: null,
};

describe("the constants", () => {
  it("are the owner's numbers", () => {
    expect(DAILY_FLOOR).toBe(50);
    expect(DAILY_TARGET).toBe(100);
  });
});

/* ---------------------------------------------------------------------- */
/* The verdict                                                             */
/* ---------------------------------------------------------------------- */

describe("assessDay", () => {
  it("passes a day at the floor", () => {
    expect(assessDay({ ...MET, inserted: DAILY_FLOOR })).toMatchObject({
      short: false,
      reason: "floor-met",
    });
  });

  it("fails one short of the floor", () => {
    expect(assessDay({ ...MET, inserted: DAILY_FLOOR - 1 }).short).toBe(true);
  });

  it("names a day where nothing ran at all", () => {
    // The synthetic-zero drill: a measured zero for the card, the probes and
    // the inserts, which is the only shape `job-never-ran` describes.
    const verdict = assessDay(ZERO);
    expect(verdict).toMatchObject({ short: true, reason: "job-never-ran" });
    expect(verdict.detail).toContain("nothing inserted");
  });

  it("says only the count for a day the report has no wave evidence for", () => {
    const verdict = assessDay(UNMEASURED);
    expect(verdict).toMatchObject({ short: true, reason: "unmeasured" });
    expect(verdict.detail).toContain("2/50");
    expect(verdict.detail).toContain("no wave evidence");
  });

  it("does not read an unknown wave count as a zero", () => {
    // The past row arrives with no card data, no probes and no inserts. Absent
    // evidence must not be spoken as `job-never-ran`.
    expect(assessDay({ ...UNMEASURED, inserted: 0 })).toMatchObject({
      short: true,
      reason: "unmeasured",
    });
  });

  it("names a crashed executor before it names the missing candidates", () => {
    expect(assessDay({ ...ZERO, wavesCreated: 2, wavesFailed: 2, supply: 400 })).toMatchObject({
      short: true,
      reason: "executor-crashed",
    });
  });

  it("names an empty pool when the job did run", () => {
    expect(assessDay({ ...ZERO, wavesCreated: 1, wavesFailed: 0, supply: 0 })).toMatchObject({
      short: true,
      reason: "no-candidates",
    });
  });

  it("names a card that was opened and never worked", () => {
    expect(
      assessDay({ ...ZERO, wavesCreated: 1, wavesFailed: 0, supply: 400, probes: 0 }),
    ).toMatchObject({ short: true, reason: "job-never-ran" });
  });

  it("names a pool that was all wrong-language", () => {
    expect(
      assessDay({
        ...ZERO,
        wavesCreated: 1,
        wavesFailed: 0,
        supply: 400,
        probes: 100,
        languageRejected: 84,
        otherRejected: 10,
        inserted: 6,
      }),
    ).toMatchObject({ short: true, reason: "all-rejected-by-language" });
  });

  it("falls back to the measured gap", () => {
    expect(
      assessDay({
        ...ZERO,
        wavesCreated: 2,
        wavesFailed: 0,
        supply: 400,
        probes: 200,
        languageRejected: 20,
        otherRejected: 150,
        inserted: 30,
      }),
    ).toMatchObject({ short: true, reason: "supply-short" });
  });

  it("says how big the gap is", () => {
    const verdict = assessDay({ ...MET, inserted: 30, probes: 40, languageRejected: 5 });
    expect(verdict.detail).toContain("30/50");
    expect(verdict.detail).toContain("gap 20");
  });

  it("accepts a floor override, so a dry run can be loud", () => {
    expect(assessDay(MET, 100)).toMatchObject({ short: true, reason: "supply-short" });
  });
});

/* ---------------------------------------------------------------------- */
/* Windows                                                                 */
/* ---------------------------------------------------------------------- */

describe("dayWindow", () => {
  it("runs local midnight to local midnight", () => {
    expect(dayWindow("2026-10-30")).toEqual({
      day: "2026-10-30",
      start: "2026-10-29T15:00:00.000Z",
      end: "2026-10-30T15:00:00.000Z",
    });
  });

  it("moves with the operator's offset", () => {
    expect(dayWindow("2026-10-30", 0).start).toBe("2026-10-30T00:00:00.000Z");
    expect(dayWindow("2026-10-30", -300).start).toBe("2026-10-30T05:00:00.000Z");
  });

  it("is exactly 24 hours, in a country with no DST", () => {
    const window = dayWindow("2026-10-30");
    expect(Date.parse(window.end) - Date.parse(window.start)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("operatorDay", () => {
  it("is the local date, not the UTC date", () => {
    // 2026-10-30T16:30Z is 2026-10-31T01:30 in Tokyo: the day the operator woke
    // up in is the 31st, and a UTC count would call it the 30th.
    expect(operatorDay(new Date("2026-10-30T16:30:00Z"))).toBe("2026-10-31");
    expect(operatorDay(new Date("2026-10-30T14:59:00Z"))).toBe("2026-10-30");
  });
});

describe("shiftDay", () => {
  it("moves across a month boundary", () => {
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("refuses nonsense", () => {
    expect(() => shiftDay("yesterday", 1)).toThrow(/not a day/);
  });
});

describe("dayIndexOf", () => {
  it("advances by one per day", () => {
    expect(dayIndexOf("2026-10-31") - dayIndexOf("2026-10-30")).toBe(1);
  });

  it("refuses nonsense", () => {
    expect(() => dayIndexOf("20261030")).toThrow(/not a day/);
  });
});

/* ---------------------------------------------------------------------- */
/* The report                                                              */
/* ---------------------------------------------------------------------- */

describe("reportLines", () => {
  // The live shape: only the day being reported carries wave evidence. The rows
  // above it know their counts and nothing about whether the job ran.
  const lines = reportLines([
    {
      ...MET,
      day: "2026-10-26",
      inserted: 2,
      probes: 0,
      supply: 0,
      wavesCreated: null,
      wavesFailed: null,
    },
    {
      ...MET,
      day: "2026-10-27",
      inserted: DAILY_FLOOR,
      probes: 0,
      supply: 0,
      wavesCreated: null,
      wavesFailed: null,
    },
    { ...MET, day: "2026-10-28", inserted: 184, wavesCreated: null, wavesFailed: null },
    {
      ...MET,
      day: "2026-10-29",
      inserted: 2,
      probes: 0,
      supply: 400,
      wavesCreated: 1,
      wavesFailed: 1,
    },
  ]);

  it("has a header and one row per day", () => {
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("day");
    expect(lines[0]).toContain("supply");
  });

  it("marks under-floor, at-floor and at-target days differently", () => {
    expect(lines[1]).toContain("✗");
    expect(lines[2]).toContain("·");
    expect(lines[3]).toContain("✓");
    expect(lines[4]).toContain("✗");
  });

  it("shows the counts the card quotes", () => {
    expect(lines[1]).toContain("2026-10-26");
    expect(lines[1]).toContain("2");
  });

  it("says unmeasured on a past row instead of job-never-ran", () => {
    expect(lines[1]).toContain("unmeasured");
    expect(lines.join("\n")).not.toContain("job-never-ran");
  });

  it("keeps the measured failure on the day being reported", () => {
    expect(lines[4]).toContain("executor-crashed");
  });
});

describe("alarmCardBody", () => {
  const days = [ZERO];
  const body = alarmCardBody(assessDay(ZERO), days);

  it("leads with the number and the floor", () => {
    expect(body.split("\n")[0]).toBe("# Source floor short: 2026-10-30 added 0, floor 50");
  });

  it("names the reason class and the remedy for it", () => {
    expect(body).toContain("job-never-ran");
    expect(body).toContain("hermes cron list");
  });

  it("carries the day table", () => {
    expect(body).toContain("```");
    expect(body).toContain("2026-10-30");
  });

  it("states the definition the count uses", () => {
    expect(body).toContain("first fetch succeeded");
    expect(body).toContain("JST");
  });

  it("points an unmeasured day at the board, not at the scheduler", () => {
    const verdict = {
      day: "2026-10-27",
      short: true,
      reason: "unmeasured" as const,
      detail:
        "2/50: no wave evidence for this day in this report -- the count is short, the cause is not in the data.",
    };
    const text = alarmCardBody(verdict, [UNMEASURED]);
    expect(text).toContain("no wave evidence");
    expect(text).toContain("--waves-created");
    expect(text.split("## Reason class")[1]).not.toContain("hermes cron list");
  });

  it("has a remedy for every reason class", () => {
    const reasons = [
      "job-never-ran",
      "executor-crashed",
      "unmeasured",
      "no-candidates",
      "all-rejected-by-language",
      "supply-short",
    ] as const;
    for (const reason of reasons) {
      const verdict = { day: "2026-10-30", short: true, reason, detail: "x" };
      const text = alarmCardBody(verdict, days);
      expect(text).toContain(reason);
      expect(text.split("## Reason class")[1]).not.toContain("Nothing to do");
    }
  });
});
