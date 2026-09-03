/**
 * Telegram Bot API transport.
 *
 * Plain fetch: Cloudflare Workers has no Node http, and this API is one POST.
 * Never import from a component — the token can send as the bot.
 */

import { envValue } from "@/lib/runtime-env";

export type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BOT_USERNAME?: string;
  VITE_SITE_URL?: string;
};

export type TelegramSendResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      /**
       * The chat is not coming back: the reader blocked the bot, deleted their
       * account, or the chat no longer exists. The caller should unlink rather
       * than keep a dead row that fails every future send.
       */
      gone?: boolean;
    };

/**
 * How long the Bot API gets before we give up.
 *
 * Same reasoning as the push transport: without it a hung call holds the
 * `claim_delivery` lease for its full ten minutes and occupies Worker CPU while
 * doing nothing.
 */
const TELEGRAM_TIMEOUT_MS = 10_000;

/**
 * Whether Telegram is saying this chat is permanently unreachable.
 *
 * Telegram signals a blocked bot, a deactivated user and a kicked bot all as
 * 403, and a chat that no longer exists as 400 "chat not found". None of those
 * improve with a retry, and none of them should leave the reader's settings
 * page claiming Telegram is still linked.
 *
 * Deliberately narrow: a bare 400 is far more likely to be our own malformed
 * HTML than a dead chat, and unlinking a working account over a formatting bug
 * would be a much worse failure than one that retries.
 */
function chatIsGone(status: number, description: string): boolean {
  if (status === 403) return true;
  return status === 400 && /chat not found|user not found/i.test(description);
}

function readToken(env?: TelegramEnv): string | undefined {
  const token = envValue("TELEGRAM_BOT_TOKEN", env);
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
  return (envValue("TELEGRAM_WEBHOOK_SECRET", env) ?? "").trim();
}

export async function getBotUsername(env?: TelegramEnv): Promise<string | null> {
  const fromEnv = envValue("TELEGRAM_BOT_USERNAME", env);
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
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
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
    const gone = chatIsGone(res.status, body.description ?? "");
    return gone ? { ok: false, error, retryable, gone } : { ok: false, error, retryable };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "network error";
    return { ok: false, error, retryable: true };
  }
}
