import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIGEST_CRON, INGEST_CRON, STAGES_CRON, stageForMinute } from "./cron";

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
  it("keeps the offsets the separate schedules fired on", () => {
    expect(stageForMinute(tuesday(9, 4))).toBe("cluster");
    expect(stageForMinute(tuesday(9, 34))).toBe("cluster");
    expect(stageForMinute(tuesday(9, 10))).toBe("classify");
    expect(stageForMinute(tuesday(9, 40))).toBe("classify");
    expect(stageForMinute(tuesday(9, 47))).toBe("analyse");
    expect(stageForMinute(tuesday(9, 53))).toBe("analyse");
    expect(stageForMinute(tuesday(9, 25))).toBe("match");
    expect(stageForMinute(tuesday(9, 55))).toBe("match");
  });

  it("orders the chain correctly within the hour", () => {
    // The order is the data dependency, not a preference: an event must exist
    // before it can be labelled, be labelled before the demand gate can say
    // whether understanding it is worth paying for, and be understood before it
    // has an importance to compare against a reader's threshold.
    const order = [4, 10, 47, 25].map((m) => stageForMinute(tuesday(9, m)));
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
