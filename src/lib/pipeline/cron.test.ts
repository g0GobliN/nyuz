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

/** 2026-08-24 is a Monday, so noon UTC on it is the dormant slot. */
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
      // Minute 0 is the weekly slot, so it only resolves on a Monday at noon.
      expect(stageForMinute(monday(12, minute))).not.toBeNull();
    }
  });
});

describe("stageForMinute", () => {
  it("keeps the offsets the separate schedules fired on", () => {
    expect(stageForMinute(tuesday(9, 10))).toBe("cluster");
    expect(stageForMinute(tuesday(9, 40))).toBe("cluster");
    expect(stageForMinute(tuesday(9, 20))).toBe("analyse");
    expect(stageForMinute(tuesday(9, 50))).toBe("analyse");
    expect(stageForMinute(tuesday(9, 25))).toBe("match");
    expect(stageForMinute(tuesday(9, 55))).toBe("match");
  });

  it("orders clustering before analysis before matching within the half hour", () => {
    const order = [10, 20, 25].map((m) => stageForMinute(tuesday(9, m)));
    expect(order).toEqual(["cluster", "analyse", "match"]);
  });

  it("nudges dormant readers only at Monday noon", () => {
    expect(stageForMinute(monday(12, 0))).toBe("dormant");
    expect(stageForMinute(monday(13, 0))).toBeNull();
    expect(stageForMinute(tuesday(12, 0))).toBeNull();
  });

  it("has nothing to do on a minute no stage claims", () => {
    expect(stageForMinute(tuesday(9, 5))).toBeNull();
    expect(stageForMinute(tuesday(9, 35))).toBeNull();
  });
});
