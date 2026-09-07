import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { signedInOnly } from "@/lib/server/guard";
import { pushConfigured, vapidPublicKey } from "./send";

const subInput = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

/**
 * What the account knows about push. Deliberately says nothing about the
 * current browser.
 *
 * `count` is informational — it is the number of devices, and no device can
 * read its own state out of it. Whether notifications are on *here* comes from
 * `getDeviceSubscription()` in src/lib/push/client.ts, which asks this
 * browser's own PushManager.
 */
export type PushStatus = {
  configured: boolean;
  publicKey: string | null;
  /** Devices subscribed on this account. Informational; never a toggle state. */
  count: number;
};

export const getPushStatus = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<PushStatus> => {
    const configured = pushConfigured();
    const publicKey = vapidPublicKey();
    const { count } = await context.actor.db
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.actor.id);
    return {
      configured: configured && Boolean(publicKey),
      publicKey,
      count: count ?? 0,
    };
  });

/**
 * Adds this device's endpoint to the account, leaving every other device be.
 *
 * The upsert conflicts on `endpoint`, not on `user_id`: one row per browser,
 * so a phone registering does not overwrite the desktop that registered first.
 */
export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => subInput.parse(input))
  .handler(async ({ context, data }): Promise<PushStatus> => {
    if (!pushConfigured()) {
      return { configured: false, publicKey: null, count: 0 };
    }
    const { error } = await context.actor.db.from("push_subscriptions").upsert(
      {
        user_id: context.actor.id,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    const { count } = await context.actor.db
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.actor.id);
    return {
      configured: true,
      publicKey: vapidPublicKey(),
      count: count ?? 1,
    };
  });

/**
 * Removes one device's endpoint.
 *
 * The endpoint is required. It used to be optional, and an absent one meant
 * "delete every subscription on this account" — which is what the Delivery
 * toggle sent whenever the current browser had nothing to unsubscribe, so
 * turning notifications off on a phone that had never subscribed silently
 * unsubscribed the desktop too. Signing off every device is a real thing to
 * want, but it is a separate, explicit action, not the fallback branch of a
 * per-device toggle.
 */
export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => z.object({ endpoint: z.string().max(2048) }).parse(input))
  .handler(async ({ context, data }): Promise<{ ok: true; count: number }> => {
    await context.actor.db
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.actor.id)
      .eq("endpoint", data.endpoint);
    const { count } = await context.actor.db
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.actor.id);
    return { ok: true, count: count ?? 0 };
  });
