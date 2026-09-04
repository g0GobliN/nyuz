import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiBudgetExceededError } from "@/lib/ai/config";

/**
 * Kill-switch behaviour: when on, completeRoutedJson must throw
 * AiBudgetExceededError before calling reserve_ai_tokens.
 *
 * We bypass createAdminClient by mocking the whole module so the test does
 * not need a real Supabase URL or service-role key.
 */

function mockAdmin(killSwitch: boolean) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const select = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: async () => ({
        data: killSwitch ? { enabled: true } : null,
        error: null,
      }),
    }),
    // The daily-cap lookup, which reads both settings in one round trip.
    // Returning nothing means the built-in caps are used.
    in: async () => ({ data: [], error: null }),
  });

  const client = {
    from: vi.fn(() => ({ select })),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "reserve_ai_tokens") {
        return { data: "reservation-id", error: null };
      }
      return { data: null, error: null };
    }),
  };

  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: vi.fn(() => client),
  }));

  return { client, rpcCalls };
}

describe("kill switch gates completeRoutedJson", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws AiBudgetExceededError before reserve_ai_tokens when kill switch is on", async () => {
    const { client, rpcCalls } = mockAdmin(true);

    const { completeRoutedJson } = await import("@/lib/ai/config");

    await expect(
      completeRoutedJson({
        capability: "cluster",
        user: "test-user",
        feature: "cluster",
      }),
    ).rejects.toMatchObject({ name: "AiBudgetExceededError" });

    // The kill switch fires before reserve_ai_tokens is called.
    expect(rpcCalls.some((c) => c.fn === "reserve_ai_tokens")).toBe(false);
  });

  it("reaches reserve_ai_tokens when kill switch is off", async () => {
    const { rpcCalls } = mockAdmin(false);

    const { completeRoutedJson } = await import("@/lib/ai/config");

    // The call will fail at the provider layer (no real key in test env) but
    // the kill switch is not the reason. We only assert that reserve_ai_tokens
    // was attempted — proving the kill switch did not block the call.
    try {
      await completeRoutedJson({
        capability: "cluster",
        user: "test-user",
        feature: "cluster",
      });
    } catch {
      // expected: no provider key configured in test env
    }

    expect(rpcCalls.some((c) => c.fn === "reserve_ai_tokens")).toBe(true);
  });
});
