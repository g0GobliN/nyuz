import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, type Prefs } from "@/lib/prefs-store";
import {
  channelsFromArray,
  channelsToArray,
  daysFromIso,
  daysToIso,
  isUsableTopic,
  notificationRowToPrefs,
  prefsToNotificationRow,
  timeFromDb,
  topicSlug,
} from "@/lib/preferences-map";
import type { NotificationPreferences } from "@/lib/supabase/types";

/**
 * The interface and the database hold these settings in different shapes, so
 * every save crosses a translation. A value that survives the trip but comes
 * back subtly different is worse than one that fails outright — nobody notices
 * until a briefing arrives on the wrong day.
 */

describe("weekdays", () => {
  it("round-trips a working week", () => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    expect(daysFromIso(daysToIso(days))).toEqual(days);
  });

  it("uses ISO numbering, Monday = 1 and Sunday = 7", () => {
    expect(daysToIso(["Mon"])).toEqual([1]);
    expect(daysToIso(["Sun"])).toEqual([7]);
  });

  it("sorts, so saving does not reorder the reader's week", () => {
    expect(daysToIso(["Fri", "Mon", "Wed"])).toEqual([1, 3, 5]);
  });

  it("drops labels it does not recognise instead of writing a bad row", () => {
    // The column is smallint[]; an unmapped label would otherwise become NaN.
    expect(daysToIso(["Mon", "Funday"])).toEqual([1]);
    expect(daysFromIso([1, 99])).toEqual(["Mon"]);
  });

  it("collapses duplicates", () => {
    expect(daysToIso(["Mon", "Mon"])).toEqual([1]);
  });
});

describe("channels", () => {
  it("round-trips", () => {
    const channels: Prefs["channels"] = { email: true, telegram: false, whatsapp: true };
    expect(channelsFromArray(channelsToArray(channels))).toEqual(channels);
  });

  it("treats every channel off as an empty array, not as a default", () => {
    // "Send me nothing anywhere" is a real choice and must not silently become
    // "email", which is what a defaulting fallback would do.
    expect(channelsToArray({ email: false, telegram: false, whatsapp: false })).toEqual([]);
    expect(channelsFromArray([])).toEqual({ email: false, telegram: false, whatsapp: false });
  });
});

describe("timeFromDb", () => {
  it("trims the seconds Postgres returns on a time column", () => {
    // <input type="time"> rejects a value with seconds and renders blank.
    expect(timeFromDb("07:30:00")).toBe("07:30");
  });

  it("passes through a value already in the right shape", () => {
    expect(timeFromDb("18:05")).toBe("18:05");
  });

  it("falls back rather than returning something the input cannot render", () => {
    expect(timeFromDb("")).toBe("07:30");
  });
});

describe("topicSlug", () => {
  it("gives one identity to the spellings a reader might type", () => {
    // Topics are shared: two readers following OpenAI must point at one row, or
    // the event analysed once for both is split across near-duplicates.
    const forms = ["OpenAI", "openai", "  OpenAI  ", "Open AI"];
    const slugs = new Set(forms.map(topicSlug));
    expect(slugs.size).toBeLessThanOrEqual(2);
    expect(topicSlug("OpenAI")).toBe(topicSlug("  openai "));
  });

  it("folds accents so Café and Cafe do not diverge", () => {
    expect(topicSlug("Café")).toBe(topicSlug("Cafe"));
  });

  it("produces a url-safe slug", () => {
    expect(topicSlug("Next.js 15!")).toMatch(/^[a-z0-9-]+$/);
    expect(topicSlug("C++")).not.toMatch(/[+]/);
  });

  it("does not leave leading or trailing separators", () => {
    expect(topicSlug("...AI...")).toBe("ai");
  });

  it("bounds the length", () => {
    expect(topicSlug("a".repeat(500)).length).toBeLessThanOrEqual(64);
  });

  it("rejects a label with nothing usable in it", () => {
    for (const label of ["", "   ", "!!!", "🙂"]) {
      expect(isUsableTopic(label)).toBe(false);
    }
    expect(isUsableTopic("AI")).toBe(true);
  });
});

describe("notification row", () => {
  const prefs: Prefs = {
    ...DEFAULT_PREFS,
    time: "06:45",
    timezone: "Asia/Tokyo",
    days: ["Mon", "Wed", "Fri"],
    channels: { email: true, telegram: true, whatsapp: false },
    density: 62,
    frequency: "weekly",
    breaking: "everything",
    paused: true,
  };

  it("round-trips every field the schedule page can set", () => {
    const row = {
      ...prefsToNotificationRow(prefs),
      user_id: "u1",
      instructions: "",
      updated_at: "",
    } as NotificationPreferences;

    expect(notificationRowToPrefs(row)).toEqual({
      time: prefs.time,
      timezone: prefs.timezone,
      days: prefs.days,
      channels: prefs.channels,
      density: prefs.density,
      frequency: prefs.frequency,
      breaking: prefs.breaking,
      paused: prefs.paused,
    });
  });

  it("clamps density into the range the column allows", () => {
    // The slider cannot leave 0..100, but a stale stored blob can, and the
    // check constraint would reject the whole save.
    expect(prefsToNotificationRow({ ...prefs, density: 900 }).density).toBe(100);
    expect(prefsToNotificationRow({ ...prefs, density: -5 }).density).toBe(0);
  });

  it("carries paused through, since that is what stops a send", () => {
    expect(prefsToNotificationRow({ ...prefs, paused: false }).paused).toBe(false);
    expect(prefsToNotificationRow({ ...prefs, paused: true }).paused).toBe(true);
  });
});
