import { buildPushPayload } from "@block65/webcrypto-web-push";
import { envValue } from "@/lib/runtime-env";
import type { StoryPush } from "@/lib/push/payload";

export type PushEnv = {
  VITE_VAPID_PUBLIC_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

export type PushSendResult =
  | {
      ok: true;
      /** Devices that failed permanently even though the reader was reached. */
      partialError?: string;
    }
  | { ok: false; error: string; retryable: boolean };

type StoredSub = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * How long one push service gets before we give up on it.
 *
 * Without this the fetch inherits the platform timeout, and a hung endpoint
 * holds the `claim_delivery` lease for its full 10 minutes while occupying
 * Worker CPU. Ten seconds is far past a healthy push service (tens of
 * milliseconds) and far short of the lease, so a wedged provider costs one slow
 * delivery rather than a stalled queue.
 */
const PUSH_TIMEOUT_MS = 10_000;

type SubOutcome =
  | { kind: "delivered" }
  /** 404/410: this device unsubscribed. Its row should go. */
  | { kind: "gone" }
  | { kind: "failed"; error: string; retryable: boolean };

function readVapid(
  env?: PushEnv,
): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = (
    envValue("VITE_VAPID_PUBLIC_KEY", env) ??
    envValue("VAPID_PUBLIC_KEY", env) ??
    ""
  ).trim();
  const privateKey = (envValue("VAPID_PRIVATE_KEY", env) ?? "").trim();
  const subject = (envValue("VAPID_SUBJECT", env) ?? "mailto:privacy@nyuz.app").trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export function pushConfigured(env?: PushEnv): boolean {
  return readVapid(env) !== null;
}

export function vapidPublicKey(env?: PushEnv): string | null {
  const key = (
    envValue("VITE_VAPID_PUBLIC_KEY", env) ??
    envValue("VAPID_PUBLIC_KEY", env) ??
    ""
  ).trim();
  return key || null;
}

/**
 * Every story to one device, stopping at that device's first refusal.
 *
 * Stopping matters: if a push service just answered 500 or 410 for story one,
 * pushing stories two and three at the same endpoint cannot succeed and only
 * spends the delivery's time budget. The outcome describes the device, which is
 * the unit the caller has to make decisions about.
 */
async function sendToSubscription(
  sub: StoredSub,
  stories: StoryPush[],
  vapid: { publicKey: string; privateKey: string; subject: string },
  urgency: "normal" | "high",
): Promise<SubOutcome> {
  for (const story of stories) {
    try {
      const payload = await buildPushPayload(
        { data: story, options: { ttl: 86_400, urgency } },
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
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      } as RequestInit);
      if (res.status === 200 || res.status === 201) continue;
      if (res.status === 404 || res.status === 410) return { kind: "gone" };
      return {
        kind: "failed",
        error: `push ${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    } catch (cause) {
      // Includes the AbortSignal firing. A timeout is transient by nature —
      // the endpoint was reachable enough to hang — so it is worth another go.
      return {
        kind: "failed",
        error: cause instanceof Error ? cause.message : "network error",
        retryable: true,
      };
    }
  }
  return { kind: "delivered" };
}

/**
 * Sends one OS notice per story to every device this reader has subscribed.
 *
 * ---------------------------------------------------------------------------
 * Why the result is computed per device and not per batch
 * ---------------------------------------------------------------------------
 *
 * This used to answer `ok: true` whenever a single push landed anywhere, and
 * carry one `lastError`/`retryable` pair overwritten by each iteration. A
 * reader with three devices where one succeeded and two returned 503 was
 * recorded as fully delivered: the caller marked the `deliveries` row `sent`,
 * and the two phones that got nothing were never retried, because as far as the
 * ledger was concerned nothing had failed. The last-write-wins `retryable` flag
 * could also turn a genuine 503 into a permanent failure if a later device
 * happened to answer 400.
 *
 * So each subscription now produces its own outcome and they are folded once,
 * with these rules:
 *
 *   - Any device that can still be reached later (429, 5xx, timeout, network)
 *     makes the whole delivery retryable. Duplicates on the devices that
 *     already succeeded are not a concern: both payloads carry a stable `tag`
 *     (event id for alerts, digest id for briefings — see push/payload.ts), so
 *     the OS replaces the existing notification rather than stacking a second.
 *
 *   - Devices that failed permanently (4xx that is not 404/410) do not fail a
 *     delivery that reached the reader somewhere else. Retrying cannot fix
 *     them, and letting one wedged endpoint mark every future briefing `failed`
 *     would bury the ledger in noise. The error is reported as `partialError`
 *     so it is still visible rather than swallowed.
 *
 *   - A 404/410 is not a failure at all. That device unsubscribed; its row is
 *     returned in `dropIds` for the caller to delete.
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
  const failures: { error: string; retryable: boolean }[] = [];
  let delivered = 0;

  for (const sub of input.subscriptions) {
    const outcome = await sendToSubscription(sub, input.stories, vapid, input.urgency ?? "normal");
    if (outcome.kind === "delivered") delivered += 1;
    else if (outcome.kind === "gone") dropIds.push(sub.id);
    else failures.push({ error: outcome.error, retryable: outcome.retryable });
  }

  const total = input.subscriptions.length;
  const retryable = failures.filter((f) => f.retryable);
  const summary = (which: { error: string }[]): string =>
    `${which.length}/${total} device(s): ${which[0]?.error ?? "push failed"}`;

  if (retryable.length > 0) {
    return { ok: false, error: summary(retryable), retryable: true, dropIds };
  }
  if (delivered > 0) {
    return failures.length > 0
      ? { ok: true, partialError: summary(failures), dropIds }
      : { ok: true, dropIds };
  }
  if (failures.length > 0) {
    return { ok: false, error: summary(failures), retryable: false, dropIds };
  }
  // Nothing delivered, nothing failed: every device was gone.
  return { ok: false, error: "no push subscription", retryable: false, dropIds };
}
