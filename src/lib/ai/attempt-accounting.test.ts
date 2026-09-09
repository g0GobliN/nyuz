import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secrets = {
  DEEPSEEK_API_KEY: "test",
  AI_MONTHLY_COST_USD: "10",
  AI_MONTHLY_TOKEN_BUDGET: "500000",
};

async function harness(
  responses: (string | Error)[],
  refuseRepair = false,
  failSettlement = false,
  responseOptions: { finishReason?: string; omitUsage?: boolean; model?: string } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let reservations = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        in: async () => ({ data: [], error: null }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === "reserve_ai_tokens")
        return {
          data: ++reservations === 2 && refuseRepair ? null : `reservation-${reservations}`,
          error: null,
        };
      if (name === "settle_ai_tokens" && failSettlement)
        return { data: null, error: { message: "unavailable" } };
      return { data: null, error: null };
    },
  };
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
  vi.doMock("@/lib/server/ops", () => ({ recordOps: async () => {} }));
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: next }, finish_reason: responseOptions.finishReason ?? "stop" },
        ],
        model: responseOptions.model ?? "deepseek-v4-flash",
        usage: responseOptions.omitUsage
          ? undefined
          : {
              prompt_tokens: 100,
              completion_tokens: 50,
              prompt_cache_hit_tokens: 25,
              completion_tokens_details: { reasoning_tokens: 10 },
            },
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetch);
  const { completeRoutedJson, meterProviderProbe } = await import("./config");
  return {
    calls,
    fetch,
    probe: (send: Parameters<typeof meterProviderProbe>[3]) =>
      meterProviderProbe(
        {
          capability: "reason",
          providerSlug: "deepseek",
          providerLabel: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          model: "deepseek-v4-pro",
          maxTokens: 2048,
          temperature: undefined,
          source: "database",
          missingSecret: false,
        },
        "Reply ready",
        secrets,
        send,
      ),
    run: () =>
      completeRoutedJson({
        capability: "cluster",
        feature: "cluster",
        system: "JSON",
        user: "headline",
        secrets,
      }),
  };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("every provider attempt is independently accounted", () => {
  it("meters the admin probe through the same reservation and settlement gate", async () => {
    const h = await harness([]);
    await h.probe(async () => {
      expect(
        h.calls.some((c) => c.name === "reserve_ai_tokens" && c.args["p_feature"] === "probe"),
      ).toBe(true);
      expect(h.calls.some((c) => c.name === "record_ai_attempt")).toBe(true);
      return {
        content: "ready",
        model: "deepseek-v4-pro",
        promptTokens: 10,
        completionTokens: 20,
        cachedTokens: 0,
        reasoningTokens: 10,
        attempt_count: 1,
      };
    });
    expect(h.calls.filter((c) => c.name === "settle_ai_tokens")).toHaveLength(1);
  });
  it("settles the first response before reserving a repair with its larger prompt", async () => {
    const h = await harness(["bad JSON", '{"ok":true}']);
    const result = await h.run();
    expect(result.usage.promptTokens).toBe(200);
    expect(result.usage.cachedTokens).toBe(50);
    const names = h.calls.map((c) => c.name);
    expect(names.indexOf("settle_ai_tokens")).toBeLessThan(names.lastIndexOf("reserve_ai_tokens"));
    const reserves = h.calls.filter((c) => c.name === "reserve_ai_tokens");
    expect(reserves).toHaveLength(2);
    expect(Number(reserves[1]?.args["p_reserve"])).toBeGreaterThan(
      Number(reserves[0]?.args["p_reserve"]),
    );
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it("does not call the provider when the repair reservation is refused", async () => {
    const h = await harness(["bad JSON"], true);
    await expect(h.run()).rejects.toMatchObject({
      usage: { promptTokens: 100, completionTokens: 50 },
    });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.calls.filter((c) => c.name === "settle_ai_tokens")).toHaveLength(1);
  });
  it("keeps ambiguous repairs reserved and preserves the first billed response", async () => {
    const h = await harness(["bad JSON", new Error("network response lost")]);
    await expect(h.run()).rejects.toMatchObject({ usage: { promptTokens: 100 } });
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.calls.filter((c) => c.name === "release_ai_reservation")).toHaveLength(0);
  });
  it("does not buy a repair or release a charge when settlement fails", async () => {
    const h = await harness(["bad JSON"], false, true);
    await expect(h.run()).rejects.toMatchObject({ usage: { promptTokens: 100 } });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.calls.filter((c) => c.name === "release_ai_reservation")).toHaveLength(0);
  });
  it("rejects partial truncated JSON and accounts for its billed usage", async () => {
    const h = await harness(['{"ok":'], false, false, { finishReason: "length" });
    await expect(h.run()).rejects.toMatchObject({ name: "TruncatedCompletionError" });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.calls.filter((c) => c.name === "settle_ai_tokens")).toHaveLength(1);
  });
  it("retains a truncated response's reservation when usage is unavailable", async () => {
    const h = await harness([""], false, false, { finishReason: "length", omitUsage: true });
    await expect(h.run()).rejects.toMatchObject({ usageReported: false });
    expect(h.calls.filter((c) => c.name === "settle_ai_tokens")).toHaveLength(0);
    expect(h.calls.filter((c) => c.name === "release_ai_reservation")).toHaveLength(0);
  });
  it("retains an unpriceable response and saves its measured usage", async () => {
    const h = await harness(['{"ok":true}'], false, false, { model: "unknown-billed-model" });
    await expect(h.run()).rejects.toMatchObject({ usage: { promptTokens: 100 } });
    expect(h.calls.filter((c) => c.name === "record_ai_attempt")).toHaveLength(2);
    expect(h.calls.filter((c) => c.name === "settle_ai_tokens")).toHaveLength(0);
  });
});
