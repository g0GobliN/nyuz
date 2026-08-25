/**
 * Telegram Bot API transport.
 *
 * Plain fetch: Cloudflare Workers has no Node http, and this API is one POST.
 * Never import from a component — the token can send as the bot.
 */

export type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string;
  VITE_SITE_URL?: string;
};

export type TelegramSendResult =
  { ok: true; id: string } | { ok: false; error: string; retryable: boolean };

function readToken(env?: TelegramEnv): string | undefined {
  const proc = globalThis.process?.env;
  const token = env?.TELEGRAM_BOT_TOKEN ?? proc?.["TELEGRAM_BOT_TOKEN"];
  return token?.trim() || undefined;
}

export function telegramConfigured(env?: TelegramEnv): boolean {
  return Boolean(readToken(env));
}

export function telegramApi(method: string, env?: TelegramEnv): string | null {
  const token = readToken(env);
  return token ? `https://api.telegram.org/bot${token}/${method}` : null;
}

export function readWebhookSecret(env?: TelegramEnv): string {
  const proc = globalThis.process?.env;
  return (env?.TELEGRAM_WEBHOOK_SECRET ?? proc?.["TELEGRAM_WEBHOOK_SECRET"] ?? "").trim();
}

export async function getBotUsername(env?: TelegramEnv): Promise<string | null> {
  const proc = globalThis.process?.env;
  const fromEnv = env?.TELEGRAM_BOT_USERNAME ?? proc?.["TELEGRAM_BOT_USERNAME"];
  if (fromEnv?.trim()) return fromEnv.trim().replace(/^@/, "");

  const url = telegramApi("getMe", env);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; result?: { username?: string } };
  return body.ok && body.result?.username ? body.result.username : null;
}

export async function sendTelegramMessage(input: {
  chatId: string;
  html: string;
  env?: TelegramEnv | undefined;
}): Promise<TelegramSendResult> {
  const url = telegramApi("sendMessage", input.env);
  if (!url) {
    return { ok: false, error: "Telegram is not configured", retryable: false };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
      error_code?: number;
    };
    if (res.ok && body.ok) {
      return { ok: true, id: String(body.result?.message_id ?? "ok") };
    }
    const error = body.description ?? `Telegram ${res.status}`;
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, error, retryable };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "network error";
    return { ok: false, error, retryable: true };
  }
}
