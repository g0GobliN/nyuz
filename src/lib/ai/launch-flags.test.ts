import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Database } from "@/lib/supabase/types";

/**
 * Minimal fake of the Supabase admin client. The functions under test only
 * use `db.from(table).select(cols).eq(col, val).maybeSingle()`, so we only
 * need to fake that chain.
 *
 * Critical: `.maybeSingle()` takes no arguments in the real client. The
 * column and value are captured when `.eq()` is called.
 */
function fakeClient(
  flags: Record<string, boolean> = {},
  settings: Record<string, unknown> = {},
): SupabaseClient<Database> {
  const makeMaybeSingle = (table: string, col: string, val: string) =>
    vi.fn().mockImplementation(async () => {
      if (table === "site_settings" && val in settings) {
        // The real column is jsonb and 0053 stores `{"value": N}`. A fake that
        // returned the bare number would let a reader that never unwraps it
        // pass, which is exactly the bug this shape exists to catch.
        return { data: { value: { value: settings[val] } }, error: null };
      }
      if (table === "feature_flags" && val in flags) {
        return { data: { enabled: flags[val] }, error: null };
      }
      return { data: null, error: null };
    });

  const makeEq = (table: string) =>
    vi.fn().mockImplementation((col: string, val: string) => ({
      maybeSingle: makeMaybeSingle(table, col, val),
    }));

  const makeSelect = (table: string) => vi.fn().mockReturnValue({ eq: makeEq(table) });

  return {
    from: vi.fn((table: string) => ({ select: makeSelect(table) })),
  } as unknown as SupabaseClient<Database>;
}

describe("launch-flags defaults", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AI_DAILY_FLASH_CAP_MICROUSD", "");
    vi.stubEnv("AI_DAILY_PRO_CAP_MICROUSD", "");
  });

  it("dailyFlashCapMicrousd falls back to 1_000_000 when unset", async () => {
    const db = fakeClient({});
    const { dailyFlashCapMicrousd } = await import("@/lib/ai/launch-flags");
    expect(await dailyFlashCapMicrousd(db)).toBe(1_000_000);
  });

  it("dailyProCapMicrousd falls back to 5_000_000 when unset", async () => {
    const db = fakeClient({});
    const { dailyProCapMicrousd } = await import("@/lib/ai/launch-flags");
    expect(await dailyProCapMicrousd(db)).toBe(5_000_000);
  });

  it("dailyFlashCapMicrousd reads the operator's stored number", async () => {
    const db = fakeClient({}, { "ai.daily_flash_cap_microusd": 250_000 });
    const { dailyFlashCapMicrousd } = await import("@/lib/ai/launch-flags");
    expect(await dailyFlashCapMicrousd(db)).toBe(250_000);
  });

  it("dailyProCapMicrousd reads the operator's stored number", async () => {
    const db = fakeClient({}, { "ai.daily_pro_cap_microusd": 2_500_000 });
    const { dailyProCapMicrousd } = await import("@/lib/ai/launch-flags");
    expect(await dailyProCapMicrousd(db)).toBe(2_500_000);
  });

  it("ignores a stored value that is not a usable number", async () => {
    // A hand-edited row must fall back to the built-in cap, never to no cap.
    const db = fakeClient({}, { "ai.daily_flash_cap_microusd": -1 });
    const { dailyFlashCapMicrousd } = await import("@/lib/ai/launch-flags");
    expect(await dailyFlashCapMicrousd(db)).toBe(1_000_000);
  });

  it("isAiKillSwitchOn returns false when flag is absent", async () => {
    const db = fakeClient({});
    const { isAiKillSwitchOn } = await import("@/lib/ai/launch-flags");
    expect(await isAiKillSwitchOn(db)).toBe(false);
  });

  it("isAiKillSwitchOn returns true when flag is enabled", async () => {
    const db = fakeClient({ ai_kill_switch: true });
    const { isAiKillSwitchOn } = await import("@/lib/ai/launch-flags");
    expect(await isAiKillSwitchOn(db)).toBe(true);
  });

  it("isAskNyuzEnabled returns false by default", async () => {
    const db = fakeClient({});
    const { isAskNyuzEnabled } = await import("@/lib/ai/launch-flags");
    expect(await isAskNyuzEnabled(db)).toBe(false);
  });

  it("isAskNyuzEnabled returns true when enabled", async () => {
    const db = fakeClient({ ask_nyuz_enabled: true });
    const { isAskNyuzEnabled } = await import("@/lib/ai/launch-flags");
    expect(await isAskNyuzEnabled(db)).toBe(true);
  });

  it("isStoryTranslationEnabled returns false by default", async () => {
    const db = fakeClient({});
    const { isStoryTranslationEnabled } = await import("@/lib/ai/launch-flags");
    expect(await isStoryTranslationEnabled(db)).toBe(false);
  });

  it("isStoryTranslationEnabled returns true when enabled", async () => {
    const db = fakeClient({ story_translation_enabled: true });
    const { isStoryTranslationEnabled } = await import("@/lib/ai/launch-flags");
    expect(await isStoryTranslationEnabled(db)).toBe(true);
  });

  it("isEnrichmentPassEnabled returns false by default", async () => {
    const db = fakeClient({});
    const { isEnrichmentPassEnabled } = await import("@/lib/ai/launch-flags");
    expect(await isEnrichmentPassEnabled(db)).toBe(false);
  });

  it("isEnrichmentPassEnabled returns true when enabled", async () => {
    const db = fakeClient({ enrichment_pass_enabled: true });
    const { isEnrichmentPassEnabled } = await import("@/lib/ai/launch-flags");
    expect(await isEnrichmentPassEnabled(db)).toBe(true);
  });

  it("loadLaunchFlags returns all flags off when none are set", async () => {
    const db = fakeClient({});
    const { loadLaunchFlags } = await import("@/lib/ai/launch-flags");
    expect(await loadLaunchFlags(db)).toEqual({
      aiKillSwitch: false,
      askNyuz: false,
      storyTranslation: false,
      enrichmentPass: false,
    });
  });

  it("loadLaunchFlags returns true for enabled flags", async () => {
    const db = fakeClient({ ai_kill_switch: true, enrichment_pass_enabled: true });
    const { loadLaunchFlags } = await import("@/lib/ai/launch-flags");
    expect(await loadLaunchFlags(db)).toEqual({
      aiKillSwitch: true,
      askNyuz: false,
      storyTranslation: false,
      enrichmentPass: true,
    });
  });
});
