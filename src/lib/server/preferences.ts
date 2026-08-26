import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { type Actor, signedInOnly } from "./guard";
import { keepCoveredTopics } from "@/lib/coverage";
import { PLAN_LIMITS, allowedBreaking } from "@/lib/plans";
import { DEFAULT_PREFS, type Prefs } from "@/lib/prefs";
import { notificationRowToPrefs, prefsToNotificationRow, topicSlug } from "@/lib/preferences-map";

/**
 * The reader's own settings, on the server.
 *
 * These used to live in `localStorage` alone, which made them invisible to
 * everything that matters: the pipeline runs on a cron with no browser attached,
 * so a topic list held in one tab could never be matched against anything, and
 * `notification_preferences.paused` could not stop a send it never saw.
 *
 * Everything here is scoped to `context.actor.id`, taken from a verified token.
 * No handler accepts a user id.
 */

const prefsInput = z.object({
  name: z.string().max(120).optional(),
  topics: z.array(z.string().min(1).max(80)).max(200).optional(),
  exclusions: z.array(z.string().min(1).max(80)).max(200).optional(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  timezone: z.string().max(64).optional(),
  days: z.array(z.string().max(3)).max(7).optional(),
  channels: z
    .object({ email: z.boolean(), telegram: z.boolean(), whatsapp: z.boolean(), push: z.boolean() })
    .optional(),
  density: z.number().int().min(0).max(100).optional(),
  frequency: z.enum(["daily", "weekly"]).optional(),
  breaking: z.enum(["important", "everything", "off"]).optional(),
  paused: z.boolean().optional(),
  onboarded: z.boolean().optional(),
});

export type PrefsInput = z.infer<typeof prefsInput>;

/**
 * Everything the dashboard needs, in the shape it already uses.
 *
 * A missing row is not an error: `handle_new_user` seeds one, but an account
 * created before that trigger existed has none, and the honest answer for a
 * reader with no stored settings is the defaults rather than a failure.
 */
export const loadPreferences = createServerFn({ method: "GET" })
  .middleware([signedInOnly])
  .handler(async ({ context }): Promise<Prefs> => {
    const { actor } = context;

    const [profile, notifications, topics, exclusions, subscription] = await Promise.all([
      actor.db
        .from("profiles")
        .select("display_name, onboarded_at")
        .eq("id", actor.id)
        .maybeSingle(),
      actor.db.from("notification_preferences").select("*").eq("user_id", actor.id).maybeSingle(),
      actor.db
        .from("user_topics")
        .select("created_at, topics ( label )")
        .eq("user_id", actor.id)
        .eq("muted", false)
        .order("created_at", { ascending: true }),
      actor.db.from("user_exclusions").select("term").eq("user_id", actor.id),
      actor.db.from("subscriptions").select("plan").eq("user_id", actor.id).maybeSingle(),
    ]);

    // Order is the weighting the product has — the topics page pauses the tail
    // past a plan limit — so the insertion order has to survive a round trip.
    const topicLabels = (topics.data ?? [])
      .map((row) => (row.topics as { label?: string } | null)?.label)
      .filter((label): label is string => Boolean(label));

    const stored: Partial<Prefs> = notifications.data
      ? notificationRowToPrefs(notifications.data)
      : {};
    const plan = subscription.data?.plan ?? "free";

    return {
      ...DEFAULT_PREFS,
      ...stored,
      breaking: allowedBreaking(plan, stored.breaking ?? DEFAULT_PREFS.breaking),
      name: profile.data?.display_name ?? "",
      topics: topicLabels,
      exclusions: (exclusions.data ?? []).map((row) => row.term),
      onboarded: Boolean(profile.data?.onboarded_at),
    };
  });

/**
 * Writes whatever changed.
 *
 * A partial update rather than a whole-object replace, because the dashboard
 * saves on every interaction — a full replace would let a stale tab overwrite a
 * change made in another one with values it had never seen.
 */
export const savePreferences = createServerFn({ method: "POST" })
  .middleware([signedInOnly])
  .validator((input: unknown) => prefsInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { actor } = context;

    if (data.name !== undefined || data.onboarded !== undefined) {
      await actor.db
        .from("profiles")
        .update({
          ...(data.name !== undefined ? { display_name: data.name.trim() } : {}),
          // Stamped once. Re-running onboarding should not reset the date the
          // account actually became a reader.
          ...(data.onboarded ? { onboarded_at: new Date().toISOString() } : {}),
        })
        .eq("id", actor.id);
    }

    // The notification row is only touched when one of its fields is present,
    // so saving a topic does not rewrite a schedule.
    const scheduleKeys = [
      "time",
      "timezone",
      "days",
      "channels",
      "density",
      "frequency",
      "breaking",
      "paused",
    ] as const;

    if (scheduleKeys.some((key) => data[key] !== undefined)) {
      const merged = { ...DEFAULT_PREFS, ...data } as Prefs;
      const row = prefsToNotificationRow(merged);

      // Only the keys the caller actually sent — `merged` filled the rest from
      // defaults, and writing those would silently reset them.
      const patch: Record<string, unknown> = {};
      if (data.time !== undefined) patch["send_at"] = row.send_at;
      if (data.timezone !== undefined) patch["timezone"] = row.timezone;
      if (data.days !== undefined) patch["days"] = row.days;
      if (data.channels !== undefined) patch["channels"] = row.channels;
      if (data.density !== undefined) patch["density"] = row.density;
      if (data.frequency !== undefined) patch["frequency"] = row.frequency;
      if (data.breaking !== undefined) {
        const plan = await planFor(actor);
        patch["breaking"] = allowedBreaking(plan, row.breaking);
      }
      if (data.paused !== undefined) patch["paused"] = row.paused;
      patch["updated_at"] = new Date().toISOString();

      await actor.db
        .from("notification_preferences")
        .upsert({ user_id: actor.id, ...patch }, { onConflict: "user_id" });
    }

    if (data.topics !== undefined) await replaceTopics(actor, data.topics);
    if (data.exclusions !== undefined) await replaceExclusions(actor, data.exclusions);
    if (data.paused === false) {
      await actor.db
        .from("profiles")
        .update({ paused_notified_at: null, auto_paused_at: null })
        .eq("id", actor.id);
    } else if (data.paused === true) {
      // A deliberate reader pause must never be undone by the presence ping.
      await actor.db.from("profiles").update({ auto_paused_at: null }).eq("id", actor.id);
    }

    return { ok: true };
  });

/**
 * Exclusions carry no state of their own, so the cheap thing is also the correct
 * one: clear and reinsert. `user_topics` cannot be treated this way — see below.
 */
async function replaceExclusions(actor: Actor, terms: string[]): Promise<void> {
  const wanted = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];

  await actor.db.from("user_exclusions").delete().eq("user_id", actor.id);
  if (wanted.length === 0) return;
  await actor.db
    .from("user_exclusions")
    .insert(wanted.map((term) => ({ user_id: actor.id, term })));
}

/**
 * Brings `user_topics` in line with the list the reader is looking at.
 *
 * Topics are a SHARED table — that is the whole cost argument. Two readers who
 * both follow "OpenAI" must point at one row, so an event analysed once serves
 * both. Hence the slug: whatever they typed resolves to a stable identity before
 * anything is linked.
 *
 * Existing links are left alone rather than deleted and recreated, because
 * `user_topics` carries state the reader did not set — `weight`, adjusted by the
 * feedback loop. Rewriting the row on every save would reset months of learning
 * because somebody added an unrelated topic.
 */
async function replaceTopics(actor: Actor, labels: string[]): Promise<void> {
  const { db, id: userId } = actor;

  const plan = await planFor(actor);
  const limit = PLAN_LIMITS[plan]?.topics ?? PLAN_LIMITS.free.topics;
  const covered = keepCoveredTopics(labels);

  const wanted = new Map<string, string>();
  for (const label of covered) {
    const slug = topicSlug(label);
    if (!wanted.has(slug)) wanted.set(slug, label);
  }

  const slugs = [...wanted.keys()];

  if (slugs.length === 0) {
    await db.from("user_topics").delete().eq("user_id", userId);
    return;
  }

  const { data: existing } = await db
    .from("user_topics")
    .select("topic_id, topics ( slug )")
    .eq("user_id", userId);
  const existingSlugToId = new Map<string, string>();
  for (const row of existing ?? []) {
    const slug = (row.topics as { slug?: string } | null)?.slug;
    if (slug) existingSlugToId.set(slug, row.topic_id);
  }

  // A downgrade does not delete preferences. Existing rows past the new cap
  // remain stored and become inert in matching; only genuinely new rows are
  // limited. Removing one still removes it normally.
  const retainedExisting = slugs.filter((slug) => existingSlugToId.has(slug));
  const room = Number.isFinite(limit) ? Math.max(0, limit - retainedExisting.length) : Infinity;
  const admittedNew = slugs.filter((slug) => !existingSlugToId.has(slug)).slice(0, room);
  const admittedSlugs = new Set([...retainedExisting, ...admittedNew]);

  // Create any admitted topic that does not exist yet. `topics` is readable by everyone
  // and writable only by service_role, which is why this runs here and not in
  // the browser. `ignoreDuplicates` makes a race between two readers adding the
  // same new topic a no-op rather than an error.
  await db.from("topics").upsert(
    [...admittedSlugs].map((slug) => ({ slug, label: wanted.get(slug) ?? slug })),
    { onConflict: "slug", ignoreDuplicates: true },
  );

  const { data: topicRows } = await db
    .from("topics")
    .select("id, slug")
    .in("slug", [...admittedSlugs]);
  const idBySlug = new Map((topicRows ?? []).map((row) => [row.slug, row.id]));
  const wantedIds = [...admittedSlugs]
    .map((slug) => idBySlug.get(slug))
    .filter((id): id is string => Boolean(id));

  const existingIds = new Set((existing ?? []).map((row) => row.topic_id));

  const toAdd = wantedIds.filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !wantedIds.includes(id));

  if (toRemove.length > 0) {
    await db.from("user_topics").delete().eq("user_id", userId).in("topic_id", toRemove);
  }
  if (toAdd.length > 0) {
    await db.from("user_topics").insert(toAdd.map((topic_id) => ({ user_id: userId, topic_id })));
  }
}

async function planFor(actor: Actor) {
  const { data } = await actor.db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", actor.id)
    .maybeSingle();
  return data?.plan ?? "free";
}
