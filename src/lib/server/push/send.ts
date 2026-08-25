import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { StoryPush } from "@/lib/push/payload";

export type PushEnv = {
  VITE_VAPID_PUBLIC_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

export type PushSendResult = { ok: true } | { ok: false; error: string; retryable: boolean };

type StoredSub = { id: string; endpoint: string; p256dh: string; auth: string };

function readVapid(
  env?: PushEnv,
): { publicKey: string; privateKey: string; subject: string } | null {
  const proc = globalThis.process?.env;
  const publicKey = (
    env?.VITE_VAPID_PUBLIC_KEY ??
    env?.VAPID_PUBLIC_KEY ??
    proc?.["VITE_VAPID_PUBLIC_KEY"] ??
    proc?.["VAPID_PUBLIC_KEY"] ??
    ""
  ).trim();
  const privateKey = (env?.VAPID_PRIVATE_KEY ?? proc?.["VAPID_PRIVATE_KEY"] ?? "").trim();
  const subject = (
    env?.VAPID_SUBJECT ??
    proc?.["VAPID_SUBJECT"] ??
    "mailto:privacy@nyuz.app"
  ).trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function pushConfigured(env?: PushEnv): boolean {
  return readVapid(env) !== null;
}

export function vapidPublicKey(env?: PushEnv): string | null {
  const proc = globalThis.process?.env;
  const key = (
    env?.VITE_VAPID_PUBLIC_KEY ??
    env?.VAPID_PUBLIC_KEY ??
    proc?.["VITE_VAPID_PUBLIC_KEY"] ??
    proc?.["VAPID_PUBLIC_KEY"] ??
    ""
  ).trim();
  return key || null;
}

/**
 * Sends one OS notice per story to every device this reader has subscribed.
 *
 * A 410/404 means that device unsubscribed; those rows are returned so the
 * caller can delete them. Other failures are retryable as a group.
 */
export async function sendStoryPushes(input: {
  subscriptions: StoredSub[];
  stories: StoryPush[];
  urgency?: "normal" | "high";
  env?: PushEnv | undefined;
}): Promise<PushSendResult & { dropIds: string[] }> {
  const vapid = readVapid(input.env);
  if (!vapid) {
    return { ok: false, error: "Push is not configured", retryable: false, dropIds: [] };
  }
  if (input.subscriptions.length === 0) {
    return { ok: false, error: "no push subscription", retryable: false, dropIds: [] };
  }
  if (input.stories.length === 0) {
    return { ok: true, dropIds: [] };
  }

  const dropIds: string[] = [];
  let retryable = false;
  let lastError = "";
  let sent = 0;

  for (const story of input.stories) {
    for (const sub of input.subscriptions) {
      try {
        const payload = await buildPushPayload(
          {
            data: story,
            options: { ttl: 86_400, urgency: input.urgency ?? "normal" },
          },
          {
            endpoint: sub.endpoint,
            expirationTime: null,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          vapid,
        );
        const res = await fetch(sub.endpoint, {
          method: payload.method,
          headers: payload.headers,
          body: payload.body,
        } as RequestInit);
        if (res.status === 201 || res.status === 200) {
          sent += 1;
          continue;
        }
        if (res.status === 404 || res.status === 410) {
          dropIds.push(sub.id);
          continue;
        }
        lastError = `push ${res.status}`;
        retryable = res.status === 429 || res.status >= 500;
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : "network error";
        retryable = true;
      }
    }
  }

  if (sent > 0 || (dropIds.length > 0 && !lastError)) {
    return { ok: true, dropIds };
  }
  if (dropIds.length === input.subscriptions.length) {
    return { ok: false, error: "no push subscription", retryable: false, dropIds };
  }
  return { ok: false, error: lastError || "push failed", retryable, dropIds };
}
