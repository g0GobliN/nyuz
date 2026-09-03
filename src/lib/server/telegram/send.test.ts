import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTelegramMessage } from "./send";

afterEach(() => vi.unstubAllGlobals());

const ENV = { TELEGRAM_BOT_TOKEN: "123:not-a-real-token" };

function telegramReplies(status: number, body: Record<string, unknown>) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

async function send() {
  return sendTelegramMessage({ chatId: "555", html: "<b>hi</b>", env: ENV });
}

describe("sendTelegramMessage", () => {
  it("bounds the request with a timeout signal", async () => {
    const fetchMock = telegramReplies(200, { ok: true, result: { message_id: 7 } });
    vi.stubGlobal("fetch", fetchMock);

    await send();

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("flags a blocked bot as gone rather than as a retryable failure", async () => {
    // The bug this pins: a reader who blocks the bot kept a linked account, so
    // the settings page said "Linked" while every send failed for ever.
    vi.stubGlobal(
      "fetch",
      telegramReplies(403, {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
    );

    const result = await send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gone).toBe(true);
    expect(result.retryable).toBe(false);
  });

  it("flags a chat that no longer exists as gone", async () => {
    vi.stubGlobal(
      "fetch",
      telegramReplies(400, {
        ok: false,
        error_code: 400,
        description: "Bad Request: chat not found",
      }),
    );

    const result = await send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gone).toBe(true);
  });

  it("does not unlink over a plain 400, which is more likely our own bad HTML", async () => {
    vi.stubGlobal(
      "fetch",
      telegramReplies(400, {
        ok: false,
        error_code: 400,
        description: "Bad Request: can't parse entities",
      }),
    );

    const result = await send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gone).toBeUndefined();
  });

  it("keeps a rate limit retryable and not gone", async () => {
    vi.stubGlobal(
      "fetch",
      telegramReplies(429, { ok: false, error_code: 429, description: "Too Many Requests" }),
    );

    const result = await send();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(true);
    expect(result.gone).toBeUndefined();
  });

  it("returns the message id on success", async () => {
    vi.stubGlobal("fetch", telegramReplies(200, { ok: true, result: { message_id: 42 } }));

    const result = await send();

    expect(result).toEqual({ ok: true, id: "42" });
  });
});
