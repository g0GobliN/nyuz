/**
 * Every side of the product, measured against the live system in one run.
 *
 *   npm run audit:posture
 *
 * Why this exists. `db:status` counts rows in the pipeline tables and
 * `briefing:checkpoint` reads one digest in detail; neither answers "which part
 * of the product is not working today". That question has been answered from
 * memory, and a product judged from memory is judged by whoever last read a
 * failure log. This prints one line of truth per side — accounts and money,
 * every delivery channel, alerts, briefings, the pipeline's intake against its
 * drain, cost, and the health rows the app writes about itself.
 *
 * It is an **instrument, not a gate**: it exits 0 even when it finds a channel
 * that has not delivered anything since August, because a posture read that
 * fails the build the moment something is wrong is a posture read that gets
 * skipped. `npm run ci` is where failures are gated.
 *
 * Read-only. Every query is a SELECT against the live project.
 */

import { db, heading, row, say } from "./lib/db.ts";

const DAY = 86_400_000;
const now = new Date();
const iso = (ms: number) => new Date(now.getTime() - ms).toISOString();
const days = (n: number) => iso(n * DAY);

async function n(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** `{ count, error }` queries the admin client types as a promise-like. */
type Counted = PromiseLike<{ count: number | null; error: { message: string } | null }>;

async function safeCount(build: () => Counted): Promise<string> {
  try {
    const { count, error } = await build();
    if (error) return `ERROR ${error.message}`;
    return String(count ?? 0);
  } catch (error) {
    return `ERROR ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Collapses the near-duplicate provider error strings into one class each.
 *
 * Stored failures differ only in the key order of the provider's own JSON, so
 * the raw strings split one outage across two lines and hide its size. The class
 * is what carries the meaning; the raw string is printed for the classes that
 * do not have one.
 */
function errorClass(raw: string): string {
  if (raw.startsWith("Resend 401")) return "Resend 401 — API key is invalid";
  if (raw.includes("EMAIL_UNSUBSCRIBE_SECRET")) return "missing EMAIL_UNSUBSCRIBE_SECRET";
  if (raw.includes("registered_devices")) return "registered_devices missing from the schema cache";
  if (raw.includes("no push subscription")) return "no push subscription";
  return raw.slice(0, 80);
}

function tally(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function print(counts: Map<string, number>, indent = "  "): void {
  for (const [key, value] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    say(`${indent}${String(value).padStart(6)}  ${key}`);
  }
}

async function run(): Promise<void> {
  /* -------------------------------------------------------------------- */
  heading("Accounts, money and devices");

  const { data: profiles } = await db()
    .from("profiles")
    .select("id, created_at, last_seen_at, onboarded_at");
  const people = profiles ?? [];
  say(row("profiles", people.length));
  say(
    row(
      "seen in the last 7 days",
      people.filter((p) => p.last_seen_at && p.last_seen_at > days(7)).length,
    ),
  );
  say(row("finished onboarding", people.filter((p) => p.onboarded_at).length));

  const { data: subs } = await db()
    .from("subscriptions")
    .select("plan, status, stripe_customer_id, stripe_subscription_id");
  const subscriptions = subs ?? [];
  print(tally(subscriptions.map((s) => `${s.plan}/${s.status}`)));
  const withStripe = subscriptions.filter((s) => s.stripe_customer_id && s.stripe_subscription_id);
  say(row("with a Stripe customer", withStripe.length));
  say(
    row(
      "paid rows with Stripe ids",
      subscriptions.filter((s) => s.plan !== "uno" && s.stripe_customer_id).length,
    ),
  );
  say(
    row(
      "stripe_events rows",
      await safeCount(() => db().from("stripe_events").select("*", { count: "exact" })),
    ),
  );
  say(
    row(
      "billing_ledger rows",
      await safeCount(() => db().from("billing_ledger").select("*", { count: "exact" })),
    ),
  );
  say(
    row(
      "registered_devices",
      await safeCount(() => db().from("registered_devices").select("*", { count: "exact" })),
    ),
  );
  say(
    row(
      "push_subscriptions",
      await safeCount(() => db().from("push_subscriptions").select("*", { count: "exact" })),
    ),
  );
  say(
    row(
      "telegram_accounts",
      await safeCount(() => db().from("telegram_accounts").select("*", { count: "exact" })),
    ),
  );
  say(
    row("waitlist", await safeCount(() => db().from("waitlist").select("*", { count: "exact" }))),
  );
  say(
    row(
      "feedback rows",
      await safeCount(() => db().from("feedback").select("*", { count: "exact" })),
    ),
  );
  say(
    row(
      "ask_log rows",
      await safeCount(() => db().from("ask_log").select("*", { count: "exact" })),
    ),
  );

  /* -------------------------------------------------------------------- */
  heading("Delivery, last 30 days, by channel and state");

  const { data: deliveries } = await db()
    .from("deliveries")
    .select("channel, status, last_error, created_at, delivered_at")
    .gte("created_at", days(30));
  const recent = deliveries ?? [];
  print(tally(recent.map((d) => `${d.channel}/${d.status}`)));
  say("");
  say("  failures by class:");
  print(tally(recent.filter((d) => d.last_error).map((d) => errorClass(d.last_error ?? ""))));

  const { data: everSent } = await db()
    .from("deliveries")
    .select("channel, delivered_at")
    .eq("status", "sent")
    .not("delivered_at", "is", null)
    .order("delivered_at", { ascending: false })
    .limit(400);
  say("");
  say("  last time each channel was accepted by its provider:");
  for (const channel of ["email", "push", "telegram", "whatsapp"]) {
    const latest = (everSent ?? []).find((d) => d.channel === channel);
    say(`  ${channel.padEnd(9)} ${latest?.delivered_at ?? "never"}`);
  }

  /* -------------------------------------------------------------------- */
  heading("Alerts");

  const { data: alerts } = await db()
    .from("digests")
    .select("digest_id, status, scheduled_for, item_count")
    .eq("kind", "alert")
    .gte("scheduled_for", days(45));
  const alertRows = alerts ?? [];
  print(tally(alertRows.map((a) => `alert/${a.status}`)));

  const { data: alertDeliveries } = await db()
    .from("deliveries")
    .select("status, last_error")
    .in(
      "digest_id",
      alertRows.map((a) => a.digest_id),
    );
  const alertLegs = alertDeliveries ?? [];
  print(
    tally(
      alertLegs.map(
        (d) => `leg ${d.status}${d.last_error ? ` — ${errorClass(d.last_error)}` : ""}`,
      ),
    ),
  );
  const undelivered = alertRows.filter((a) => !alertLegs.some((d) => d.status === "sent"));
  say(row("alerts with no accepted channel", undelivered.length));

  const perDay = new Map<string, number>();
  for (const a of alertRows) {
    const day = a.scheduled_for.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  say("");
  say("  alerts per day:");
  for (const [day, count] of [...perDay.entries()].sort().slice(-14)) say(`  ${day}  ${count}`);

  /* -------------------------------------------------------------------- */
  heading("Briefings");

  const { data: briefingRows } = await db()
    .from("digests")
    .select("status, scheduled_for, item_count, generation_failure_reason")
    .eq("kind", "briefing")
    .gte("scheduled_for", days(45));
  const briefings = briefingRows ?? [];
  print(tally(briefings.map((b) => `briefing/${b.status}`)));
  const failed = briefings.filter((b) => b.status === "failed");
  say("");
  say("  failures by local slot time:");
  print(tally(failed.map((f) => f.scheduled_for.slice(11, 16))));
  const thrownAway = failed.filter((f) => (f.item_count ?? 0) > 0);
  say(row("failures with a briefing already built", thrownAway.length));
  say(
    row(
      "items thrown away with them",
      thrownAway.reduce((sum, f) => sum + (f.item_count ?? 0), 0),
    ),
  );
  say("");
  say("  why they failed:");
  print(tally(failed.map((f) => f.generation_failure_reason ?? "(no reason recorded)")));

  /* -------------------------------------------------------------------- */
  heading("Pipeline: intake against drain, by day");

  for (let i = 6; i >= 0; i--) {
    const from = iso((i + 1) * DAY);
    const to = iso(i * DAY);
    const articles = await n(
      db()
        .from("articles")
        .select("*", { count: "exact" })
        .gte("fetched_at", from)
        .lt("fetched_at", to),
    );
    const clustered = await n(
      db()
        .from("articles")
        .select("*", { count: "exact" })
        .gte("fetched_at", from)
        .lt("fetched_at", to)
        .not("event_id", "is", null),
    );
    const events = await n(
      db()
        .from("events")
        .select("*", { count: "exact" })
        .gte("first_seen_at", from)
        .lt("first_seen_at", to),
    );
    const analysed = await n(
      db()
        .from("events")
        .select("*", { count: "exact" })
        .gte("analysed_at", from)
        .lt("analysed_at", to),
    );
    say(
      `  ${to.slice(0, 10)}  articles +${String(articles).padStart(5)} (clustered ${String(clustered).padStart(5)})` +
        `   events +${String(events).padStart(5)} (analysed ${String(analysed).padStart(5)})`,
    );
  }

  say("");
  say(
    row(
      "articles not in an event",
      await n(db().from("articles").select("*", { count: "exact" }).is("event_id", null)),
    ),
  );
  say(
    row(
      "events awaiting analysis",
      await n(db().from("events").select("*", { count: "exact" }).is("analysed_at", null)),
    ),
  );
  say(
    row(
      "events eligible and pending",
      await n(
        db()
          .from("events")
          .select("*", { count: "exact" })
          .is("analysed_at", null)
          .eq("status", "pending"),
      ),
    ),
  );
  say(
    row(
      "events failed",
      await n(
        db()
          .from("events")
          .select("*", { count: "exact" })
          .is("analysed_at", null)
          .eq("status", "failed"),
      ),
    ),
  );
  say(
    row(
      "reader matches, last 7 days",
      await n(db().from("user_events").select("*", { count: "exact" }).gte("matched_at", days(7))),
    ),
  );

  /* -------------------------------------------------------------------- */
  heading("Cost, caps and what is switched on");

  const { data: routes } = await db()
    .from("ai_model_routes")
    .select("capability, model, max_tokens");
  for (const r of routes ?? [])
    say(`  ${r.capability.padEnd(8)} ${r.model.padEnd(20)} max_tokens ${r.max_tokens}`);

  const { data: flags } = await db().from("feature_flags").select("key, enabled");
  const flags_on = (flags ?? []).filter((f) => f.enabled).map((f) => f.key);
  const flags_off = (flags ?? []).filter((f) => !f.enabled).map((f) => f.key);
  say("");
  say(row("flags on", flags_on.length));
  say(row("flags off", flags_off.length));
  say(`  off: ${flags_off.join(", ")}`);

  /* -------------------------------------------------------------------- */
  heading("What the app records about its own health");

  const { data: ops } = await db().from("ops_status").select("key, status, detail, updated_at");
  const unhealthy = (ops ?? []).filter((o) => o.status !== "healthy");
  say(row("status rows", (ops ?? []).length));
  say(row("not healthy", unhealthy.length));
  for (const o of unhealthy.sort((a, b) => a.updated_at.localeCompare(b.updated_at))) {
    const ageDays = ((now.getTime() - new Date(o.updated_at).getTime()) / DAY).toFixed(1);
    say(`  ${o.status.padEnd(7)} ${ageDays.padStart(5)}d  ${o.key}`);
    say(`          ${JSON.stringify(o.detail).slice(0, 180)}`);
  }
  say("");
  say("  A health row that has said the same thing for weeks is a failure nobody acted on.");
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
