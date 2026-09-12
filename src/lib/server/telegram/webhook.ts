import { PLAN_LIMITS } from "../../plans";
import { createAdminClient, type ServerEnv } from "@/lib/supabase/admin";
import { parseStartCommand } from "@/lib/telegram/format";
import {
  readWebhookSecret,
  sendTelegramMessage,
  telegramConfigured,
  type TelegramEnv,
} from "./send";

export type TelegramWebhookEnv = ServerEnv & TelegramEnv;

/**
 * Telegram posts here when a reader taps Start on the bot.
 *
 * The nonce in `/start <nonce>` is the only thing that binds a chat id to an
 * account. Anyone can message the bot; without a live nonce they cannot attach
 * it to a nyuz user.
 */
export async function handleTelegramWebhook(
  request: Request,
  env?: TelegramWebhookEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!telegramConfigured(env)) {
    return new Response("not configured", { status: 503 });
  }

  const expected = readWebhookSecret(env);
  if (!expected) {
    return new Response("not configured", { status: 503 });
  }
  const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (got !== expected) return new Response("unauthorized", { status: 401 });

  let update: { message?: { chat?: { id?: number }; text?: string } };
  try {
    update = (await request.json()) as typeof update;
  } catch {
    return new Response("ok");
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text ?? "";
  if (chatId == null) return new Response("ok");

  const db = createAdminClient(env);
  const nonce = parseStartCommand(text);
  const chat = String(chatId);

  if (!nonce) {
    await sendTelegramMessage({
      chatId: chat,
      html: "Open Delivery in nyuz and tap <b>Connect Telegram</b>, then use the link it gives you.",
      env,
    });
    return new Response("ok");
  }

  const { data: row } = await db
    .from("telegram_accounts")
    .select("user_id, connect_expires_at")
    .eq("connect_nonce", nonce)
    .maybeSingle();

  if (!row || (row.connect_expires_at && Date.parse(row.connect_expires_at) < Date.now())) {
    await sendTelegramMessage({
      chatId: chat,
      html: "That link expired. Open Delivery in nyuz and tap Connect Telegram again.",
      env,
    });
    return new Response("ok");
  }

  const { data: subscription, error: planError } = await db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (planError) return new Response("Plan unavailable", { status: 503 });
  if (!PLAN_LIMITS[subscription?.plan ?? "uno"].telegram) return new Response("ok");
  await db.from("telegram_accounts").update({ chat_id: null }).eq("chat_id", chat);
  await db
    .from("telegram_accounts")
    .update({
      chat_id: chat,
      connect_nonce: null,
      connect_expires_at: null,
      linked_at: new Date().toISOString(),
    })
    .eq("user_id", row.user_id);

  await sendTelegramMessage({
    chatId: chat,
    html: "Linked. Briefings will arrive here when you have Telegram on in Delivery.",
    env,
  });
  return new Response("ok");
}
