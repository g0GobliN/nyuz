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

export type PushStatus = {
  configured: boolean;
  publicKey: string | null;
  subscribed: boolean;
  /** Number of active subscriptions for this user. */
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
      subscribed: (count ?? 0) > 0,
      count: count ?? 0,
    };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => subInput.parse(input))
  .handler(async ({ context, data }): Promise<PushStatus> => {
    if (!pushConfigured()) {
      return { configured: false, publicKey: null, subscribed: false, count: 0 };
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
      subscribed: true,
      count: count ?? 1,
    };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) =>
    z.object({ endpoint: z.string().max(2048).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    let query = context.actor.db
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.actor.id);
    if (data.endpoint) query = query.eq("endpoint", data.endpoint);
    await query;
    return { ok: true };
  });
