import { describe, it, expect, vi, beforeEach } from "vitest";
import { completeJson, CompletionUsageError } from "@/lib/ai/deepseek";

/**
 * Tests for completeJson retry behaviour and attempt_count tracking.
 *
 * We mock `createDeepSeek` at the module boundary by providing a fake env
 * and intercepting the `openai` SDK. This keeps the test fast, offline, and
 * independent of a real provider key.
 */

function mockOpenAIResponses(responses: Array<{ content: string }>) {
  const calls: Array<{ model: string; user: string }> = [];

  const mockClient = {
    chat: {
      completions: {
        create: vi.fn(async ({ messages }: { messages: { role: string; content: string }[] }) => {
          const response = responses.shift() ?? { content: "", usage: {} };
          calls.push({
            model: "deepseek-v4-flash",
            user: messages[1]?.content ?? "",
          });
          return {
            choices: [{ message: { content: response.content }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              completion_tokens_details: { reasoning_tokens: 0 },
              prompt_tokens_details: { cached_tokens: 0 },
            },
          };
        }),
      },
    },
  };

  vi.doMock("openai", () => ({
    default: vi.fn(() => mockClient),
  }));

  return { mockClient, calls };
}

describe("completeJson retry and attempt_count", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
    vi.stubEnv("MODEL_CLUSTER", "deepseek-v4-flash");
  });

  it("returns attempt_count 1 on valid raw JSON with no retry", async () => {
    const { calls } = mockOpenAIResponses([{ content: '{"ok": true}' }]);

    const { completeJson } = await import("@/lib/ai/deepseek");
    const { data, usage } = await completeJson<Record<string, unknown>>({
      tier: "cluster",
      user: "test",
    });

    expect(data).toEqual({ ok: true });
    expect(usage.attempt_count).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("returns attempt_count 1 on fenced JSON with no retry", async () => {
    const { calls } = mockOpenAIResponses([{ content: '```json\n{"ok": true}\n```' }]);

    const { completeJson } = await import("@/lib/ai/deepseek");
    const { data, usage } = await completeJson<Record<string, unknown>>({
      tier: "cluster",
      user: "test",
    });

    expect(data).toEqual({ ok: true });
    expect(usage.attempt_count).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("returns attempt_count 1 on prose-wrapped JSON when recoverable", async () => {
    const { calls } = mockOpenAIResponses([
      { content: 'Sure, here is the JSON: {"ok": true} — hope that helps!' },
    ]);

    const { completeJson } = await import("@/lib/ai/deepseek");
    const { data, usage } = await completeJson<Record<string, unknown>>({
      tier: "cluster",
      user: "test",
    });

    expect(data).toEqual({ ok: true });
    expect(usage.attempt_count).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("retries once (attempt_count 2) on malformed JSON, then throws CompletionUsageError on second failure", async () => {
    const { calls } = mockOpenAIResponses([
      { content: "not json at all" },
      { content: "still not json" },
    ]);

    const { completeJson } = await import("@/lib/ai/deepseek");
    const error = await completeJson<Record<string, unknown>>({
      tier: "cluster",
      user: "test",
    }).catch((e) => e);

    expect(error.name).toBe("CompletionUsageError");
    expect(error.usage.attempt_count).toBe(2);
  });

  it("never retries more than once", async () => {
    const { calls } = mockOpenAIResponses([
      { content: "garbage" },
      { content: "also garbage" },
      { content: "third call should never happen" },
    ]);

    const { completeJson } = await import("@/lib/ai/deepseek");
    const error = await completeJson<Record<string, unknown>>({
      tier: "cluster",
      user: "test",
    }).catch((e) => e);

    expect(error.name).toBe("CompletionUsageError");
    // One call, one retry, then CompletionUsageError — never a third.
    expect(calls).toHaveLength(2);
  });

  it("attempt_count sums both attempts' tokens", async () => {
    const { calls } = mockOpenAIResponses([{ content: "not json" }, { content: '{"ok": true}' }]);

    const { completeJson } = await import("@/lib/ai/deepseek");
    const { usage } = await completeJson<Record<string, unknown>>({
      tier: "cluster",
      user: "test",
    });

    expect(usage.attempt_count).toBe(2);
    expect(usage.promptTokens).toBe(20); // 10 + 10
    expect(usage.completionTokens).toBe(10); // 5 + 5
  });
});
