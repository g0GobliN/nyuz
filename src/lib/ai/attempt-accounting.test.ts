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

async function storyReader(secretOverrides: Record<string, string> = {}) {
  const { FakeDb, asDb } = await import("@/lib/test-support/fake-db");
  const { ensureUnderstanding } = await import("@/lib/server/understanding");
  let failure: boolean | undefined;
  const db = new FakeDb(
    {},
    {
      claim_shared_story: () =>
        failure === undefined ? "won" : failure ? "reconciliation" : "cooldown",
      begin_shared_story_attempt: () => true,
      fail_shared_story: (args) => {
        failure = args["p_uncertain"] === true;
      },
    },
  );
  return {
    db,
    open: () =>
      ensureUnderstanding(
        asDb(db),
        { id: "event", title: "Council approves library", understand: null },
        [
          {
            id: "article",
            title: "Council approves library",
            source_id: "source",
            published_at: "2026-09-16T12:00:00Z",
            excerpt:
              "The council approved a new public library on Monday. The project includes a reading room and extended opening hours. Funding will come from the existing community development budget, according to the council announcement. Construction is expected to begin next spring.",
          },
        ],
        { userId: "reader", explicitOpen: true, secrets: { ...secrets, ...secretOverrides } },
      ),
  };
}

describe("every provider attempt is independently accounted", () => {
  it("a missing credential never consumes a story attempt or user start", async () => {
    const h = await harness([]);
    const story = await storyReader({ DEEPSEEK_API_KEY: "" });
    expect((await story.open()).status).toBe("skipped");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.calls.some((c) => c.name === "reserve_ai_tokens")).toBe(false);
    // This RPC owns both the lifetime increment and user-start insertion.
    expect(story.db.rpcCalls.some((c) => c.fn === "begin_shared_story_attempt")).toBe(false);
  });

  it.each([false, true])(
    "story transport failure uncertain=%s is classified after actual metering",
    async (uncertain) => {
      const h = await harness(
        uncertain ? [new Error("network response lost")] : [""],
        false,
        false,
        { finishReason: "length" },
      );
      const story = await storyReader();
      expect((await story.open()).status).toBe("failed");
      expect(story.db.rpcCalls.find((c) => c.fn === "fail_shared_story")?.args["p_uncertain"]).toBe(
        uncertain,
      );
      expect(h.calls.filter((c) => c.name === "settle_ai_tokens")).toHaveLength(uncertain ? 0 : 1);
      expect(story.db.rpcCalls.filter((c) => c.fn === "begin_shared_story_attempt")).toHaveLength(
        1,
      );
      expect((await story.open()).status).toBe("skipped");
      expect(h.fetch).toHaveBeenCalledTimes(1);
    },
  );

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
    await expect(h.run()).rejects.toMatchObject({
      name: "TruncatedCompletionError",
      usageSettled: true,
    });
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.calls.filter((c) => c.name === "settle_ai_tokens")).toHaveLength(1);
  });
  it("retains a truncated response's reservation when usage is unavailable", async () => {
    const h = await harness([""], false, false, { finishReason: "length", omitUsage: true });
    await expect(h.run()).rejects.toMatchObject({ usageReported: false, usageSettled: false });
    expect(h.calls.filter((c) => c.name === "settle_ai_tokens")).toHaveLength(0);
    expect(h.calls.filter((c) => c.name === "release_ai_reservation")).toHaveLength(0);
  });
  it("settles a response whose model name the rate card does not recognise", async () => {
    // Was: "retains an unpriceable response and saves its measured usage" —
    // which asserted a rejection and NO settlement. That contract cost real
    // money on 2026-09-10, when DeepSeek began echoing `deepseek-flash` for
    // requests routed to `deepseek-v4-flash`. 266 calls were billed by the
    // provider, priced to null here, and never settled: the measured tokens were
    // lost and each pessimistic reservation stayed standing against the monthly
    // ceiling. Refusing to settle does not un-spend the money — it only hides
    // what was spent and holds ~4x its true cost against the cap.
    const h = await harness(['{"ok":true}'], false, false, { model: "deepseek-flash" });
    await expect(h.run()).resolves.toMatchObject({ usage: { promptTokens: 100 } });
    const settlements = h.calls.filter((c) => c.name === "settle_ai_tokens");
    expect(settlements).toHaveLength(1);
    // Priced by the routed model, so the cost is a real number rather than null.
    expect(Number(settlements[0]?.args["p_cost_microusd"])).toBeGreaterThan(0);
    expect(settlements[0]?.args["p_prompt_tokens"]).toBe(100);
  });

  it("records the substituted model beside the one it was priced as", async () => {
    const h = await harness(['{"ok":true}'], false, false, { model: "deepseek-flash" });
    await h.run();
    const attempt = h.calls
      .filter((c) => c.name === "record_ai_attempt")
      .map((c) => c.args["p_usage"] as { model?: string; priced_as?: string } | null)
      .find((usage) => usage != null);
    expect(attempt?.model).toBe("deepseek-flash");
    expect(attempt?.priced_as).toBe("deepseek-v4-flash");
  });
});
