import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * The last gate before money: what the app does with a refusal, and what it
 * sends to the function that issues one.
 *
 * The refusal logic itself is SQL and is verified against a real Postgres —
 * `reserve_ai_tokens` returning null when the day's Flash or Pro envelope is
 * spent, and doing so under a lock so two callers cannot both pass. What can
 * only be checked here is the half that lives in TypeScript:
 *
 *   - a refused reservation means the provider is never contacted, and
 *   - the caps the operator configured are the caps actually sent.
 *
 * A cap that is enforced perfectly in SQL but never passed from the app, or
 * passed correctly and then ignored when it says no, is not a cap.
 */

type Harness = {
  /** Every rpc the code made, in order. */
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  /** Provider requests that actually left the process. */
  fetchCalls: number;
};

function install(options: {
  killSwitch?: boolean;
  reservationGranted?: boolean;
  settings?: Record<string, number>;
}): Harness {
  const harness: Harness = { rpcCalls: [], fetchCalls: 0 };
  const settings = options.settings ?? {};

  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, key: string) => ({
          maybeSingle: async () => ({
            data:
              table === "feature_flags" && key === "ai_kill_switch"
                ? { enabled: options.killSwitch === true }
                : null,
            error: null,
          }),
        }),
        in: async (_col: string, keys: string[]) => ({
          data:
            table === "site_settings"
              ? keys
                  .filter((k) => k in settings)
                  .map((k) => ({ key: k, value: { value: settings[k] } }))
              : [],
          error: null,
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      harness.rpcCalls.push({ fn, args });
      if (fn === "reserve_ai_tokens") {
        return {
          data: options.reservationGranted === true ? "11111111-1111-1111-1111-111111111111" : null,
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };

  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => client) }));

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      harness.fetchCalls += 1;
      throw new Error("the provider must not be reached in these tests");
    }),
  );

  return harness;
}

const SECRETS = {
  AI_MONTHLY_TOKEN_BUDGET: "500000",
  AI_MONTHLY_COST_USD: "10",
  DEEPSEEK_API_KEY: "test-key",
} as Record<string, string>;

const reserveCalls = (h: Harness) => h.rpcCalls.filter((c) => c.fn === "reserve_ai_tokens");

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a refused reservation is never followed by a provider call", () => {
  it.each([
    { DEEPSEEK_API_KEY: "" },
    { DEEPSEEK_API_KEY: "   " },
    { DEEPSEEK_API_KEY: "invalid\nheader" },
    { DEEPSEEK_BASE_URL: "not-a-url" },
    { DEEPSEEK_BASE_URL: "http://api.deepseek.com" },
    { MODEL_REASON: " " },
  ])(
    "rejects invalid local configuration before reserving or counting a start: %j",
    async (bad) => {
      const harness = install({ reservationGranted: true });
      const { completeRouted } = await import("@/lib/ai/config");
      let paidAttempts = 0;
      let userStarts = 0;
      await expect(
        completeRouted({
          capability: "reason",
          feature: "understand_generation",
          user: "Evidence",
          secrets: { ...SECRETS, ...bad },
          beforeProvider: async () => {
            paidAttempts++;
            userStarts++;
          },
        }),
      ).rejects.toThrow();
      expect(reserveCalls(harness)).toHaveLength(0);
      expect(harness.fetchCalls).toBe(0);
      expect(paidAttempts).toBe(0);
      expect(userStarts).toBe(0);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid output ceiling %s before admission",
    async (maxTokens) => {
      const harness = install({ reservationGranted: true });
      const { completeRouted } = await import("@/lib/ai/config");
      const beforeProvider = vi.fn();
      await expect(
        completeRouted({
          capability: "reason",
          feature: "understand_generation",
          user: "Evidence",
          secrets: SECRETS,
          maxTokens,
          beforeProvider,
        }),
      ).rejects.toThrow("output limit");
      expect(reserveCalls(harness)).toHaveLength(0);
      expect(beforeProvider).not.toHaveBeenCalled();
      expect(harness.fetchCalls).toBe(0);
    },
  );

  it("stops on a refusal, having asked exactly once", async () => {
    // `reserve_ai_tokens` returns null for every refusal it has: the daily
    // Flash cap, the daily Pro cap, the monthly token ceiling, the monthly cost
    // ceiling, an unpriceable route, and the reader's own plan cap. The app
    // cannot tell them apart and must not: all of them mean "do not call".
    const harness = install({ reservationGranted: false });
    const { completeRoutedJson, AiBudgetExceededError } = await import("@/lib/ai/config");

    await expect(
      completeRoutedJson({
        capability: "cluster",
        user: "cluster this",
        feature: "cluster",
        secrets: SECRETS,
      }),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);

    expect(reserveCalls(harness)).toHaveLength(1);
    expect(harness.fetchCalls).toBe(0);
    expect(harness.rpcCalls.some((c) => c.fn === "settle_ai_tokens")).toBe(false);
  });

  it("reaches the provider when the reservation is granted", async () => {
    // The control. Without it, every zero above could be a broken harness.
    const harness = install({ reservationGranted: true });
    const { completeRoutedJson } = await import("@/lib/ai/config");

    await expect(
      completeRoutedJson({
        capability: "cluster",
        user: "cluster this",
        feature: "cluster",
        secrets: SECRETS,
      }),
    ).rejects.toThrow();

    expect(reserveCalls(harness)).toHaveLength(1);
    expect(harness.fetchCalls).toBeGreaterThan(0);
  });

  it("does not even ask when the kill switch is on", async () => {
    const harness = install({ killSwitch: true, reservationGranted: true });
    const { completeRoutedJson, AiBudgetExceededError } = await import("@/lib/ai/config");

    await expect(
      completeRoutedJson({
        capability: "reason",
        user: "analyse this",
        feature: "analyse",
        secrets: SECRETS,
      }),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);

    expect(reserveCalls(harness)).toHaveLength(0);
    expect(harness.fetchCalls).toBe(0);
  });
});

describe("the caps the operator set are the caps that are sent", () => {
  it("passes the console's daily caps to the reservation", async () => {
    const harness = install({
      reservationGranted: false,
      settings: {
        "ai.daily_flash_cap_microusd": 250_000,
        "ai.daily_pro_cap_microusd": 750_000,
      },
    });
    const { completeRoutedJson } = await import("@/lib/ai/config");

    await expect(
      completeRoutedJson({
        capability: "cluster",
        user: "cluster this",
        feature: "cluster",
        secrets: SECRETS,
      }),
    ).rejects.toThrow();

    expect(reserveCalls(harness)[0]?.args).toMatchObject({
      p_daily_flash_cap_microusd: 250_000,
      p_daily_pro_cap_microusd: 750_000,
    });
  });

  it("falls back to the built-in caps when the console has set none", async () => {
    const harness = install({ reservationGranted: false });
    const { completeRoutedJson } = await import("@/lib/ai/config");
    const { DEFAULT_FLASH_CAP_MICROUSD, DEFAULT_PRO_CAP_MICROUSD } =
      await import("@/lib/ai/launch-flags");

    await expect(
      completeRoutedJson({
        capability: "cluster",
        user: "cluster this",
        feature: "cluster",
        secrets: SECRETS,
      }),
    ).rejects.toThrow();

    expect(reserveCalls(harness)[0]?.args).toMatchObject({
      p_daily_flash_cap_microusd: DEFAULT_FLASH_CAP_MICROUSD,
      p_daily_pro_cap_microusd: DEFAULT_PRO_CAP_MICROUSD,
    });
  });

  it("lets an environment override beat the stored setting", async () => {
    // The operator's escape hatch: a cap that has to change faster than a
    // console round trip.
    const harness = install({
      reservationGranted: false,
      settings: { "ai.daily_flash_cap_microusd": 250_000 },
    });
    const { completeRoutedJson } = await import("@/lib/ai/config");

    await expect(
      completeRoutedJson({
        capability: "cluster",
        user: "cluster this",
        feature: "cluster",
        secrets: { ...SECRETS, AI_DAILY_FLASH_CAP_MICROUSD: "42" },
      }),
    ).rejects.toThrow();

    expect(reserveCalls(harness)[0]?.args).toMatchObject({ p_daily_flash_cap_microusd: 42 });
  });
});

describe("every reservation says which feature it is for", () => {
  // Without this, an unsettled call — a crash, an outage, a timeout — lands in
  // the ledger as 'unknown', and 'unknown' is precisely the row an operator
  // chasing a cost spike cannot act on.
  const features = ["cluster", "analyse", "enrich", "translate", "impact", "ask"] as const;

  for (const feature of features) {
    it(`tags a ${feature} reservation before the call, not only after it`, async () => {
      const harness = install({ reservationGranted: false });
      const { completeRoutedJson } = await import("@/lib/ai/config");

      await expect(
        completeRoutedJson({
          capability: feature === "cluster" ? "cluster" : "reason",
          user: "a call",
          feature,
          secrets: SECRETS,
        }),
      ).rejects.toThrow();

      expect(reserveCalls(harness)[0]?.args["p_feature"]).toBe(feature);
    });
  }
});
