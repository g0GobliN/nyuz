import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIGEST_CRON, INGEST_CRON, STAGES_CRON, digestGenerates, stageForMinute } from "./cron";

/**
 * Cloudflare registers three Cron Triggers per Worker — free plan and paid
 * alike — and drops the rest without failing the deploy. Six were declared
 * once, and the only symptom was briefings that never arrived.
 */
const TRIGGER_LIMIT = 3;

function declaredCrons(): string[] {
  const config = readFileSync(new URL("../../../vite.config.ts", import.meta.url), "utf8");
  const block = /crons:\s*\[([^\]]*)\]/.exec(config);
  if (!block?.[1]) throw new Error("no triggers.crons array in vite.config.ts");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/** Fixed dates keep the dispatcher assertions independent of the local zone. */
const monday = (hour: number, minute: number) => new Date(Date.UTC(2026, 7, 24, hour, minute));
const tuesday = (hour: number, minute: number) => new Date(Date.UTC(2026, 7, 25, hour, minute));

describe("triggers.crons", () => {
  it("declares no more than Cloudflare will register", () => {
    expect(declaredCrons().length).toBeLessThanOrEqual(TRIGGER_LIMIT);
  });

  it("declares exactly the schedules the dispatcher answers to", () => {
    expect(declaredCrons().sort()).toEqual([INGEST_CRON, DIGEST_CRON, STAGES_CRON].sort());
  });

  it("delivers every minute so a deadline is never a tick away", () => {
    // The reader's promise is resolved by whichever tick sends, so every minute
    // has to be one. This is the whole reason DIGEST_CRON is not "*/5".
    expect(DIGEST_CRON).toBe("* * * * *");
    expect(declaredCrons()).toContain(DIGEST_CRON);
  });

  it("generates on every fifth minute and only sends on the rest", () => {
    const generating = [...Array(60).keys()].filter((m) => digestGenerates(monday(9, m)));
    // Twelve generating passes an hour is the old */5 cadence, unchanged: the
    // extra ticks buy delivery resolution, not more model calls.
    expect(generating).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  it("gives every minute in the shared schedule something to do", () => {
    const minutes = STAGES_CRON.split(" ")[0]?.split(",").map(Number) ?? [];
    expect(minutes.length).toBeGreaterThan(0);
    for (const minute of minutes) {
      // Minute 0 is the daily inactivity slot, so noon resolves it.
      expect(stageForMinute(monday(12, minute))).not.toBeNull();
    }
  });
});

describe("stageForMinute", () => {
  it("runs a complete pipeline chain before every quarter-hour briefing boundary", () => {
    expect(stageForMinute(tuesday(9, 2))).toBe("cluster");
    expect(stageForMinute(tuesday(9, 17))).toBe("cluster");
    expect(stageForMinute(tuesday(9, 32))).toBe("cluster");
    expect(stageForMinute(tuesday(9, 47))).toBe("cluster");
    expect(stageForMinute(tuesday(9, 8))).toBe("classify");
    expect(stageForMinute(tuesday(9, 23))).toBe("classify");
    expect(stageForMinute(tuesday(9, 38))).toBe("classify");
    expect(stageForMinute(tuesday(9, 53))).toBe("classify");
    expect(stageForMinute(tuesday(9, 9))).toBe("analyse");
    expect(stageForMinute(tuesday(9, 24))).toBe("analyse");
    expect(stageForMinute(tuesday(9, 39))).toBe("analyse");
    expect(stageForMinute(tuesday(9, 54))).toBe("analyse");
    expect(stageForMinute(tuesday(9, 14))).toBe("match");
    expect(stageForMinute(tuesday(9, 29))).toBe("match");
    expect(stageForMinute(tuesday(9, 44))).toBe("match");
    expect(stageForMinute(tuesday(9, 59))).toBe("match");
  });

  it("orders the chain correctly within the hour", () => {
    // The order is the data dependency, not a preference: an event must exist
    // before it can be labelled, be labelled before the demand gate can say
    // whether understanding it is worth paying for, and be understood before it
    // has an importance to compare against a reader's threshold.
    const order = [17, 23, 24, 29].map((m) => stageForMinute(tuesday(9, m)));
    expect(order).toEqual(["cluster", "classify", "analyse", "match"]);
  });

  it("checks inactive Uno readers daily at noon", () => {
    expect(stageForMinute(monday(12, 0))).toBe("dormant");
    expect(stageForMinute(monday(13, 0))).toBeNull();
    expect(stageForMinute(tuesday(12, 0))).toBe("dormant");
  });

  it("has nothing to do on a minute no stage claims", () => {
    expect(stageForMinute(tuesday(9, 5))).toBeNull();
    expect(stageForMinute(tuesday(9, 35))).toBeNull();
  });
});
