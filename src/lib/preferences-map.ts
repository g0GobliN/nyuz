import type { Prefs } from "@/lib/prefs-store";
import type { DeliveryChannel, NotificationPreferences } from "@/lib/supabase/types";

/**
 * Translation between what the interface holds and what the database stores.
 *
 * These are two genuinely different shapes and always were. The dashboard has
 * carried weekday labels, a channel object and a plain topic list since it was a
 * prototype backed by browser storage; `0001` specifies ISO weekday numbers, a
 * `delivery_channel[]`, and topics as rows in a shared table.
 *
 * Pure functions in their own module so the mapping is testable without a
 * database, and so a round trip can be asserted — a preference that survives
 * saving but comes back subtly different is worse than one that fails to save,
 * because nobody notices until a briefing arrives on the wrong day.
 */

/** ISO weekday numbers, which is what `notification_preferences.days` holds. */
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function daysToIso(labels: string[]): number[] {
  const seen = new Set<number>();
  for (const label of labels) {
    const index = DAY_LABELS.indexOf(label as (typeof DAY_LABELS)[number]);
    if (index >= 0) seen.add(index + 1);
  }
  // Sorted so a save followed by a load does not reorder the reader's week.
  return [...seen].sort((a, b) => a - b);
}

export function daysFromIso(numbers: number[]): string[] {
  const labels: string[] = [];
  for (const n of [...new Set(numbers)].sort((a, b) => a - b)) {
    const label = DAY_LABELS[n - 1];
    if (label) labels.push(label);
  }
  return labels;
}

export function channelsToArray(channels: Prefs["channels"]): DeliveryChannel[] {
  const out: DeliveryChannel[] = [];
  if (channels.email) out.push("email");
  if (channels.telegram) out.push("telegram");
  if (channels.whatsapp) out.push("whatsapp");
  return out;
}

export function channelsFromArray(channels: DeliveryChannel[]): Prefs["channels"] {
  return {
    email: channels.includes("email"),
    telegram: channels.includes("telegram"),
    whatsapp: channels.includes("whatsapp"),
  };
}

/**
 * "07:30" from Postgres `time`, which comes back as "07:30:00".
 *
 * The input control is `type="time"` and rejects a value carrying seconds, so
 * loading a saved row without trimming leaves the field silently blank.
 */
export function timeFromDb(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : "07:30";
}

/**
 * The stable identity of a topic, derived from whatever the reader typed.
 *
 * Onboarding accepts free text, so "Open Source", "open source" and " open
 * source " must reach the same row — otherwise every reader creates their own
 * near-duplicate and the shared analysis they are supposed to share is split
 * across three topics.
 */
export function topicSlug(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      // Strip combining marks so "Café" and "Cafe" do not diverge.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
  );
}

/** Rejects a topic that slugifies to nothing — punctuation, emoji, whitespace. */
export function isUsableTopic(label: string): boolean {
  return topicSlug(label).length > 0;
}

/** The notification row for a set of preferences. `user_id` is added by the caller. */
export function prefsToNotificationRow(
  prefs: Prefs,
): Omit<NotificationPreferences, "user_id" | "updated_at" | "instructions"> {
  return {
    send_at: prefs.time,
    timezone: prefs.timezone,
    days: daysToIso(prefs.days),
    channels: channelsToArray(prefs.channels),
    frequency: prefs.frequency,
    breaking: prefs.breaking,
    // The column is constrained to 0..100; a slider cannot leave that range but
    // a stale stored blob can.
    density: Math.min(100, Math.max(0, Math.round(prefs.density))),
    paused: prefs.paused,
  };
}

/** The interface's view of a stored notification row. */
export function notificationRowToPrefs(
  row: NotificationPreferences,
): Pick<
  Prefs,
  "time" | "timezone" | "days" | "channels" | "frequency" | "breaking" | "density" | "paused"
> {
  return {
    time: timeFromDb(row.send_at),
    timezone: row.timezone,
    days: daysFromIso(row.days),
    channels: channelsFromArray(row.channels),
    frequency: row.frequency,
    breaking: row.breaking,
    density: row.density,
    paused: row.paused,
  };
}
