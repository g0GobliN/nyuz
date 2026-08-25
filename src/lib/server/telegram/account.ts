import { createServerFn } from "@tanstack/react-start";
import { signedInOnly } from "@/lib/server/guard";
import { getBotUsername, telegramConfigured } from "./send";

const NONCE_MS = 30 * 60 * 1000;

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type TelegramStatus = {
  configured: boolean;
  linked: boolean;
  connectUrl: string | null;
};

export const getTelegramStatus = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<TelegramStatus> => {
    const { db, id } = context.actor;
    if (!telegramConfigured()) {
      return { configured: false, linked: false, connectUrl: null };
    }
    const { data } = await db
      .from("telegram_accounts")
      .select("chat_id")
      .eq("user_id", id)
      .maybeSingle();
    return {
      configured: true,
      linked: Boolean(data?.chat_id),
      connectUrl: null,
    };
  });

export const createTelegramLink = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<TelegramStatus & { error?: string }> => {
    const { db, id } = context.actor;
    if (!telegramConfigured()) {
      return {
        configured: false,
        linked: false,
        connectUrl: null,
        error: "Telegram is not configured.",
      };
    }

    const { data: existing } = await db
      .from("telegram_accounts")
      .select("chat_id")
      .eq("user_id", id)
      .maybeSingle();
    if (existing?.chat_id) {
      return { configured: true, linked: true, connectUrl: null };
    }

    const username = await getBotUsername();
    if (!username) {
      return {
        configured: true,
        linked: false,
        connectUrl: null,
        error: "Could not reach Telegram.",
      };
    }

    const token = nonce();
    const expires = new Date(Date.now() + NONCE_MS).toISOString();
    const { error } = await db.from("telegram_accounts").upsert({
      user_id: id,
      connect_nonce: token,
      connect_expires_at: expires,
    });
    if (error) {
      return { configured: true, linked: false, connectUrl: null, error: error.message };
    }

    return {
      configured: true,
      linked: false,
      connectUrl: `https://t.me/${username}?start=${token}`,
    };
  });

export const disconnectTelegram = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { db, id } = context.actor;
    await db
      .from("telegram_accounts")
      .update({
        chat_id: null,
        connect_nonce: null,
        connect_expires_at: null,
        linked_at: null,
      })
      .eq("user_id", id);
    return { ok: true };
  });
