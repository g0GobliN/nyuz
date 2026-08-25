import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { Email } from "@/lib/email/shell";
import {
  briefingsPausedEmail,
  dormantEmail,
  paymentFailedEmail,
  subscriptionCancelledEmail,
  subscriptionStartedEmail,
  welcomeEmail,
  type PlanLabel,
} from "@/lib/email/templates";
import { type EmailEnv, sendEmail, siteUrl } from "./send";

/**
 * Turns "this happened to this user" into a sent message.
 *
 * The templates are pure and the transport is dumb; this is the layer that knows
 * where a reader's address lives and which template an event deserves. Keeping
 * it separate means a webhook handler never touches template internals and a
 * template never touches the database.
 *
 * Nothing here throws. Every caller is a webhook handler or a background job,
 * and failing to send a receipt must never fail the thing the receipt was about
 * — a thrown error inside a Stripe handler turns a successful payment into a
 * retried webhook and, eventually, a disabled endpoint.
 */

type Db = SupabaseClient<Database>;

export type Recipient = { email: string; name: string };

/** `free` has no receipt to send, so the label type excludes it by construction. */
export function planLabel(plan: "personal" | "pro"): PlanLabel {
  return plan === "pro" ? "Pro" : "Personal";
}

/**
 * The address and name for a user, or null when there is nothing to send to.
 *
 * `profiles.email` mirrors `auth.users.email` through a trigger, so this needs
 * no admin auth API call — and the trigger clamps user-initiated updates, which
 * is why the mirrored copy is safe to send to.
 */
export async function findRecipient(db: Db, userId: string): Promise<Recipient | null> {
  const { data, error } = await db
    .from("profiles")
    .select("email, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data?.email) return null;
  return { email: data.email, name: data.display_name ?? "" };
}

async function deliver(
  to: string,
  message: Email,
  env: EmailEnv | undefined,
  options: { idempotencyKey?: string | undefined; unsubscribeUrl?: string | undefined } = {},
): Promise<boolean> {
  const result = await sendEmail({ to, message, env, ...options });
  if (!result.ok) {
    // Logged, not thrown. See the note at the top of the file.
    console.error(`Email to ${to} failed: ${result.error}`);
  }
  return result.ok;
}

/* ---------------------------------------------------------------------- */
/* Account                                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Sends the welcome message once per account, ever.
 *
 * The guard is a conditional update rather than a read-then-write: `welcomed_at
 * is null` in the WHERE clause means two concurrent calls cannot both see an
 * unwelcomed profile and both send. Whichever update returns a row does the
 * sending.
 *
 * The row is stamped BEFORE the send. Sending twice is worse than not sending —
 * a duplicate welcome is a visible defect in the first message a customer ever
 * receives from you, while a missed one is invisible.
 */
export async function sendWelcomeOnce(
  db: Db,
  userId: string,
  env?: EmailEnv,
): Promise<"sent" | "already" | "failed"> {
  const recipient = await findRecipient(db, userId);
  if (!recipient) return "failed";

  const { data, error } = await db
    .from("profiles")
    .update({ welcomed_at: new Date().toISOString() })
    .eq("id", userId)
    .is("welcomed_at", null)
    .select("id");

  if (error) return "failed";
  if (!data || data.length === 0) return "already";

  const ok = await deliver(
    recipient.email,
    welcomeEmail({ name: recipient.name, baseUrl: siteUrl(env) }),
    env,
    { idempotencyKey: `welcome:${userId}` },
  );
  return ok ? "sent" : "failed";
}

export async function sendBriefingsPaused(
  db: Db,
  userId: string,
  env?: EmailEnv,
): Promise<boolean> {
  const recipient = await findRecipient(db, userId);
  if (!recipient) return false;

  const { data, error } = await db
    .from("profiles")
    .update({ paused_notified_at: new Date().toISOString() })
    .eq("id", userId)
    .is("paused_notified_at", null)
    .select("id");
  if (error || !data || data.length === 0) return false;

  return deliver(
    recipient.email,
    briefingsPausedEmail({ name: recipient.name, baseUrl: siteUrl(env) }),
    env,
  );
}

/* ---------------------------------------------------------------------- */
/* Billing                                                                 */
/* ---------------------------------------------------------------------- */

export async function sendSubscriptionStarted(
  db: Db,
  userId: string,
  details: { plan: "personal" | "pro"; priceLabel: string; renewsOn: Date },
  env?: EmailEnv,
): Promise<boolean> {
  const recipient = await findRecipient(db, userId);
  if (!recipient) return false;

  return deliver(
    recipient.email,
    subscriptionStartedEmail({
      name: recipient.name,
      baseUrl: siteUrl(env),
      plan: planLabel(details.plan),
      priceLabel: details.priceLabel,
      renewsOn: details.renewsOn,
    }),
    env,
    // Keyed on the period so a renewal a month later is a different message,
    // but a redelivered webhook for the same period is not.
    { idempotencyKey: `started:${userId}:${details.renewsOn.toISOString()}` },
  );
}

export async function sendSubscriptionCancelled(
  db: Db,
  userId: string,
  details: { plan: "personal" | "pro"; accessUntil: Date },
  env?: EmailEnv,
): Promise<boolean> {
  const recipient = await findRecipient(db, userId);
  if (!recipient) return false;

  return deliver(
    recipient.email,
    subscriptionCancelledEmail({
      name: recipient.name,
      baseUrl: siteUrl(env),
      plan: planLabel(details.plan),
      accessUntil: details.accessUntil,
    }),
    env,
    { idempotencyKey: `cancelled:${userId}:${details.accessUntil.toISOString()}` },
  );
}

export async function sendPaymentFailed(
  db: Db,
  userId: string,
  details: { plan: "personal" | "pro"; retryOn: Date },
  env?: EmailEnv,
): Promise<boolean> {
  const recipient = await findRecipient(db, userId);
  if (!recipient) return false;

  return deliver(
    recipient.email,
    paymentFailedEmail({
      name: recipient.name,
      baseUrl: siteUrl(env),
      plan: planLabel(details.plan),
      retryOn: details.retryOn,
    }),
    env,
    { idempotencyKey: `failed:${userId}:${details.retryOn.toISOString()}` },
  );
}

/* ---------------------------------------------------------------------- */
/* Re-engagement                                                           */
/* ---------------------------------------------------------------------- */

/**
 * The only non-transactional message here, which is why it is the only one that
 * carries a List-Unsubscribe header.
 */
export async function sendDormant(
  db: Db,
  userId: string,
  details: { days: number; unsubscribeUrl: string },
  env?: EmailEnv,
  idempotencyKey?: string,
): Promise<boolean> {
  const recipient = await findRecipient(db, userId);
  if (!recipient) return false;

  return deliver(
    recipient.email,
    dormantEmail({
      name: recipient.name,
      baseUrl: siteUrl(env),
      days: details.days,
      unsubscribeUrl: details.unsubscribeUrl,
    }),
    env,
    {
      unsubscribeUrl: details.unsubscribeUrl,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  );
}
