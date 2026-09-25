import { PlanAccessError } from "../plan-access";
import { deviceErrorMessage } from "@/lib/device-errors";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestProtocol, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { signedInOnly } from "@/lib/server/guard";
import { registerThisDevice } from "@/lib/server/devices";
import { DEVICE_COOKIE, deviceCookieAttributes } from "@/lib/device-anchor";
import { pushConfigured, vapidPublicKey } from "./send";

const subInput = z.object({
  installId: z.string().uuid(),
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
  /**
   * How to name the device, when this call is what first registers one.
   *
   * Optional, because the anchor decides which row this belongs to either way —
   * it is here so a device that turns notifications on before it ever opens
   * Settings is not left called "Browser" for as long as it exists.
   */
  label: z.string().trim().min(1).max(80).optional(),
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
 * The upsert conflicts on `(user_id, install_id)`, not on `user_id` alone: one
 * row per browser, so a phone registering does not overwrite the desktop that
 * registered first. Keying on the stable install id rather than the endpoint
 * means a browser that rotates its push subscription updates its own row
 * instead of inserting a second one.
 */
export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => subInput.parse(input))
  .handler(async ({ context, data }): Promise<PushStatus> => {
    if (!pushConfigured()) {
      return { configured: false, publicKey: null, count: 0 };
    }
    const registered = await registerThisDevice(context.actor, {
      installId: data.installId,
      label: data.label,
      endpoint: data.endpoint,
      anchor: getCookie(DEVICE_COOKIE),
    });
    // This path registers a device too, so it anchors it too. Everything about
    // why lives in src/lib/device-anchor.ts.
    setCookie(DEVICE_COOKIE, registered, deviceCookieAttributes(getRequestProtocol() === "https"));
    const { error } = await context.actor.db.from("push_subscriptions").upsert(
      {
        user_id: context.actor.id,
        install_id: registered,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
      },
      { onConflict: "user_id,install_id" },
    );
    if (error) throw new PlanAccessError(error.message);
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
