import { PlanAccessError } from "./plan-access";
import { currentPlan, validatePlanPreferences, assertTopicAddition } from "./plan-access";
import { STANDARD_DELIVERY_TIME } from "../plans";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { type Actor, signedInOnly } from "./guard";
import { type KeptTopic, keepUsableTopics } from "@/lib/coverage";
import { PLAN_LIMITS, allowedBreaking } from "@/lib/plans";
import { DEFAULT_PREFS, type Prefs } from "@/lib/prefs";
import { notificationRowToPrefs, prefsToNotificationRow } from "@/lib/preferences-map";
import { keepUsableExclusions } from "@/lib/exclusions";
import { MAX_TOPIC_LABEL } from "@/lib/topics";
import { isSupportedTimezone } from "@/lib/timezones";
import { backfill } from "@/lib/pipeline/backfill";

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
  // The transport guard, not the product rule. `keepUsableTopics` decides what
  // a topic is; this only stops an absurd body reaching it. The two differ on
  // purpose — a value between MAX_TOPIC_LABEL and 80 is received and refused
  // with a reason rather than silently truncated into a different subject.
  topics: z.array(z.string().min(1).max(80)).max(200).optional(),
  exclusions: z.array(z.string().min(1).max(80)).max(200).optional(),
  time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  // Constrained to zones the runtime can actually do arithmetic in. A free
  // string here is a briefing that silently never sends, because `nextSlot`
  // returns null for a zone `Intl` cannot resolve. Legacy aliases still pass,
  // so nobody's stored value is rejected on their next save.
  timezone: z.string().max(64).refine(isSupportedTimezone).optional(),
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
    const plan = subscription.data?.plan ?? "uno";

    return {
      ...DEFAULT_PREFS,
      ...stored,
      time: PLAN_LIMITS[plan].customDeliveryTime
        ? (stored.time ?? STANDARD_DELIVERY_TIME)
        : STANDARD_DELIVERY_TIME,
      frequency: "daily",
      channels: {
        ...DEFAULT_PREFS.channels,
        ...stored.channels,
        telegram: PLAN_LIMITS[plan].telegram && (stored.channels?.telegram ?? false),
        whatsapp: false,
      },
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
    validatePlanPreferences(await currentPlan(actor), data);

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

      const { error } = await actor.db
        .from("notification_preferences")
        .upsert({ user_id: actor.id, ...patch }, { onConflict: "user_id" });
      if (error) throw new PlanAccessError(error.message);
    }

    let followedSomethingNew = false;
    if (data.topics !== undefined) {
      followedSomethingNew = await replaceTopics(actor, data.topics);
    }
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

    // A newly followed subject should not sit empty until the next cron. This is
    // the FREE half of day one — `match()` over events that were analysed for
    // somebody else — so it spends no tokens and can run every time somebody
    // adds a topic. `onDemand: false` is what holds that line: the paid path
    // stays reserved for a brand-new account, once, as `backfill` documents.
    if (followedSomethingNew) {
      try {
        await backfill(actor.db, { userId: actor.id, onDemand: false });
      } catch (error) {
        // A failed backfill costs the reader a wait until the scheduled run, and
        // must never cost them the save that has already been written.
        console.warn(`preferences: backfill after topic change failed: ${String(error)}`);
      }
    }

    return { ok: true };
  });

/**
 * Exclusions carry no state of their own, so the cheap thing is also the correct
 * one: clear and reinsert. `user_topics` cannot be treated this way — see below.
 */
async function replaceExclusions(actor: Actor, terms: string[]): Promise<void> {
  const { kept, refused } = keepUsableExclusions(terms);
  const wanted = kept;

  if (refused.length > 0) {
    console.warn(
      `preferences: ignored unusable exclusions for ${actor.id}: ${refused.map((r) => JSON.stringify(r.label)).join(", ")}`,
    );
  }

  await actor.db.from("user_exclusions").delete().eq("user_id", actor.id);
  if (wanted.length === 0) return;
  await actor.db
    .from("user_exclusions")
    .insert(wanted.map((term) => ({ user_id: actor.id, term })));
}

/**
 * How many canonical topic rows one reader may create in a day.
 *
 * NOT a product limit — the plan cap is, and this sits far above it: Plura
 * allows fifteen topics at once, so nobody legitimately creates thirty in a
 * day. It exists because the plan cap bounds how many topics a reader HOLDS
 * and nothing bounded how many they could CREATE by adding and removing in a
 * loop. `topics` is read whole by the analyser and the matcher on every run, so
 * an unbounded table is a pipeline cost, not just a storage one.
 *
 * Following an existing topic is never affected. Only minting a new canonical
 * row counts, which is why a hundred readers arriving at "Nepal" spend one.
 */
const DAILY_TOPIC_CREATIONS = 30;

/**
 * Brings `user_topics` in line with the list the reader is looking at.
 *
 * Topics are a SHARED table — that is the whole cost argument. Two readers who
 * both follow "OpenAI" must point at one row, so an event analysed once serves
 * both. The same now holds for anything they invent: two strangers who
 * independently type "Nepal" resolve through `topicSlug` to one canonical row
 * and one demand signal, never `alice_nepal` and `bob_nepal`.
 *
 * That reuse is why this runs server-side under the service role. `topics` has
 * no insert policy and, since 0049, a select policy that hides other readers'
 * custom rows — so the browser can neither create a row nor discover the one it
 * should be reusing. Resolving here is what keeps deduplication working across
 * readers who cannot see each other.
 *
 * Existing links are left alone rather than deleted and recreated, because
 * `user_topics` carries state the reader did not set — `weight`, adjusted by the
 * feedback loop. Rewriting the row on every save would reset months of learning
 * because somebody added an unrelated topic.
 *
 * Returns whether anything was newly followed, so the caller can decide whether
 * a backfill is worth running.
 */
async function replaceTopics(actor: Actor, labels: string[]): Promise<boolean> {
  const { db, id: userId } = actor;

  const plan = await planFor(actor);
  const limit = PLAN_LIMITS[plan]?.topics ?? PLAN_LIMITS.uno.topics;
  const { kept, refused } = keepUsableTopics(labels);

  // Refusals are logged rather than thrown. A malformed entry in a list of ten
  // must not fail the other nine, and the selector already refuses to offer a
  // label this would reject — anything reaching here is a stale tab or a
  // hand-made request, neither of which is worth a 400 to the reader.
  if (refused.length > 0) {
    console.warn(
      `preferences: refused ${refused.length} topic(s) for ${userId}: ` +
        refused.map((r) => r.reason).join(", ") +
        ` (max ${MAX_TOPIC_LABEL} chars)`,
    );
  }

  if (kept.length === 0) {
    await db.from("user_topics").delete().eq("user_id", userId);
    return false;
  }

  const bySlug = new Map(kept.map((topic) => [topic.slug, topic] as const));
  const slugs = [...bySlug.keys()];

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
  // limited. Removing one still removes it normally. A custom topic is counted
  // here exactly like a predefined one — the allowance is over interests, and a
  // reader who could bypass it by typing their own would make it decorative.
  assertTopicAddition(plan, slugs, new Set(existingSlugToId.keys()));
  const retainedExisting = slugs.filter((slug) => existingSlugToId.has(slug));
  const room = Number.isFinite(limit) ? Math.max(0, limit - retainedExisting.length) : Infinity;
  const admittedNew = slugs.filter((slug) => !existingSlugToId.has(slug)).slice(0, room);
  const admittedSlugs = new Set([...retainedExisting, ...admittedNew]);

  const admitted = [...admittedSlugs]
    .map((slug) => bySlug.get(slug))
    .filter((topic): topic is KeptTopic => topic !== undefined);

  const wantedIds = await resolveTopics(actor, admitted);

  const existingIds = new Set((existing ?? []).map((row) => row.topic_id));

  const toAdd = wantedIds.filter((id) => !existingIds.has(id));
  const toRemove = [...existingIds].filter((id) => !wantedIds.includes(id));

  // Unfollowing removes the reader's reference and nothing else. The `topics`
  // row survives, and so do every `event`, `article` and `event_topics` link
  // behind it — content is global, interests are personal references to it.
  // Demand decays through `refresh_source_demand` and the grace window in 0031,
  // which is a measurement changing, not history being destroyed.
  if (toRemove.length > 0) {
    await db.from("user_topics").delete().eq("user_id", userId).in("topic_id", toRemove);
  }
  if (toAdd.length > 0) {
    const { error } = await db
      .from("user_topics")
      .insert(toAdd.map((topic_id) => ({ user_id: userId, topic_id })));
    if (error) throw new PlanAccessError(error.message);
  }

  return toAdd.length > 0;
}

/**
 * Canonical ids for a set of topics, creating only what does not exist.
 *
 * Read before write, deliberately. An upsert of every label would be one round
 * trip fewer and would also count every already-canonical topic against the
 * creation brake below, which would penalise readers for following popular
 * subjects — the opposite of what the shared table is for.
 */
async function resolveTopics(actor: Actor, topics: KeptTopic[]): Promise<string[]> {
  const { db, id: userId } = actor;
  if (topics.length === 0) return [];

  const slugs = topics.map((topic) => topic.slug);
  const { data: found } = await db.from("topics").select("id, slug").in("slug", slugs);
  const idBySlug = new Map((found ?? []).map((row) => [row.slug, row.id] as const));

  const missing = topics.filter((topic) => !idBySlug.has(topic.slug));

  if (missing.length > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await db
      .from("topics")
      .select("id", { count: "exact", head: true })
      .eq("created_by", userId)
      .gte("created_at", since);

    const room = Math.max(0, DAILY_TOPIC_CREATIONS - (count ?? 0));
    const creatable = missing.slice(0, room);

    if (creatable.length < missing.length) {
      console.warn(
        `preferences: topic creation limit reached for ${userId}, ` +
          `${missing.length - creatable.length} not created`,
      );
    }

    if (creatable.length > 0) {
      // `ignoreDuplicates` makes a race between two readers typing the same new
      // subject at the same moment a no-op rather than an error, and it is the
      // reason the loser of that race still ends up on the winner's row: the
      // re-read below resolves whatever is actually there.
      await db.from("topics").upsert(
        creatable.map((topic) => ({
          slug: topic.slug,
          label: topic.label,
          kind: topic.predefined ? ("predefined" as const) : ("custom" as const),
          // Predefined topics keep an empty term list: they reach events through
          // `event_topics`, which the model writes, and giving them terms as
          // well would widen the editorial list by a side effect.
          terms: topic.predefined ? [] : topic.terms,
          created_by: userId,
        })),
        { onConflict: "slug", ignoreDuplicates: true },
      );

      const { data: created } = await db
        .from("topics")
        .select("id, slug")
        .in(
          "slug",
          creatable.map((topic) => topic.slug),
        );
      for (const row of created ?? []) idBySlug.set(row.slug, row.id);
    }
  }

  return slugs.map((slug) => idBySlug.get(slug)).filter((id): id is string => Boolean(id));
}

async function planFor(actor: Actor) {
  const { data } = await actor.db
    .from("subscriptions")
    .select("plan")
    .eq("user_id", actor.id)
    .maybeSingle();
  return data?.plan ?? "uno";
}
