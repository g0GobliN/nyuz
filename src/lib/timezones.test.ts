import { describe, expect, it, vi, afterEach } from "vitest";
import {
  cityName,
  detectTimezone,
  isSupportedTimezone,
  offsetLabel,
  offsetMinutes,
  regionName,
  modernName,
  sameZone,
  searchTimezones,
  signupMetadata,
  supportedTimezones,
  timezoneOption,
  timezoneOptions,
  toTimezone,
} from "@/lib/timezones";
import { nextSlot } from "@/lib/pipeline/schedule";

describe("detectTimezone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the runtime's own zone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "Asia/Kathmandu" }),
    } as unknown as Intl.DateTimeFormat);
    expect(detectTimezone()).toBe("Asia/Kathmandu");
  });

  it("falls back to UTC when the browser reports nothing", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "" }),
    } as unknown as Intl.DateTimeFormat);
    expect(detectTimezone()).toBe("UTC");
  });

  it("falls back to UTC when resolvedOptions throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no ICU");
    });
    expect(detectTimezone()).toBe("UTC");
  });

  it("produces a value the scheduler accepts", () => {
    // The whole point of detection: whatever comes back must be schedulable.
    const zone = detectTimezone();
    expect(isSupportedTimezone(zone)).toBe(true);
    expect(
      nextSlot(
        { sendAt: "07:30", timezone: zone, days: [1, 2, 3, 4, 5], frequency: "daily" },
        new Date("2026-03-02T00:00:00Z"),
      ),
    ).not.toBeNull();
  });
});

/**
 * The one value that reaches the row an account is born with.
 *
 * The database half -- that `handle_new_user` reads this field, gates it, and
 * writes it to both rows -- is executed in `schema-migrations.test.ts`. What can
 * only be tested here is that the browser actually sends it, and that it sends
 * it *only* when the account is being created.
 */
describe("signupMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("carries the browser's zone when the account is being created", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "Asia/Kathmandu" }),
    } as unknown as Intl.DateTimeFormat);
    expect(signupMetadata(true)).toEqual({ timezone: "Asia/Kathmandu" });
  });

  it("sends nothing on a sign-in to an account that already exists", () => {
    // `data` merges into `raw_user_meta_data`, so anything sent here would
    // rewrite the day the reader signed up with wherever they are today.
    expect(signupMetadata(false)).toBeUndefined();
  });

  it("still sends a zone the scheduler can use when the browser will not say", () => {
    expect(signupMetadata(true, "UTC")).toEqual({ timezone: "UTC" });
  });
});

describe("isSupportedTimezone", () => {
  it("accepts canonical IANA identifiers", () => {
    for (const zone of [
      "UTC",
      "Asia/Tokyo",
      "Asia/Kathmandu",
      "America/New_York",
      "Europe/London",
      "America/Argentina/Buenos_Aires",
      "Pacific/Chatham",
    ]) {
      expect(isSupportedTimezone(zone)).toBe(true);
    }
  });

  it("accepts legacy aliases so existing stored values keep working", () => {
    // Absent from supportedValuesOf but resolvable, and some readers have had
    // them stored since before the picker existed.
    expect(isSupportedTimezone("Asia/Calcutta")).toBe(true);
    expect(isSupportedTimezone("US/Eastern")).toBe(true);
  });

  it("rejects arbitrary custom strings", () => {
    for (const bad of [
      "",
      "   ",
      "Mars/Olympus_Mons",
      "Not A Zone",
      "GMT+5:45; DROP TABLE",
      "<script>",
      "x".repeat(65),
    ]) {
      expect(isSupportedTimezone(bad)).toBe(false);
    }
  });

  it("rejects bare offsets, which are not zones and do not observe DST", () => {
    expect(isSupportedTimezone("+05:45")).toBe(false);
    expect(isSupportedTimezone("-0500")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isSupportedTimezone(null)).toBe(false);
    expect(isSupportedTimezone(undefined)).toBe(false);
    expect(isSupportedTimezone(330)).toBe(false);
    expect(isSupportedTimezone({ timeZone: "Asia/Tokyo" })).toBe(false);
  });
});

describe("toTimezone", () => {
  it("preserves an existing valid value untouched", () => {
    expect(toTimezone("Asia/Kathmandu")).toBe("Asia/Kathmandu");
    expect(toTimezone("America/New_York")).toBe("America/New_York");
  });

  it("preserves a legacy alias rather than rewriting it", () => {
    // Rewriting to the modern spelling would be a silent migration of a value
    // the reader never asked us to change.
    expect(toTimezone("Asia/Calcutta")).toBe("Asia/Calcutta");
  });

  it("replaces an unusable value with the fallback", () => {
    expect(toTimezone("Mars/Olympus_Mons", "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(toTimezone(undefined, "Europe/London")).toBe("Europe/London");
  });

  it("lands on UTC when the fallback is itself unusable", () => {
    expect(toTimezone("nonsense", "also nonsense")).toBe("UTC");
  });
});

describe("supportedTimezones", () => {
  it("covers the zones the old hard-coded list had", () => {
    const zones = supportedTimezones();
    for (const zone of [
      "Asia/Tokyo",
      "Asia/Kathmandu",
      "Asia/Singapore",
      "Europe/London",
      "Europe/Berlin",
      "America/New_York",
      "America/Los_Angeles",
    ]) {
      expect(zones).toContain(zone);
    }
  });

  it("is far larger than the seven it replaced, and includes UTC", () => {
    const zones = supportedTimezones();
    expect(zones.length).toBeGreaterThan(50);
    expect(zones).toContain("UTC");
  });

  it("only contains zones the scheduler can resolve", () => {
    for (const zone of supportedTimezones()) {
      expect(isSupportedTimezone(zone)).toBe(true);
    }
  });
});

describe("modern spellings", () => {
  it("offers the modern IANA name whatever the runtime's ICU calls primary", () => {
    // This project's Node lists Asia/Katmandu and canonicalises Kathmandu
    // backwards into it; browsers do the opposite. The picker must not depend
    // on which one built the list.
    expect(modernName("Asia/Katmandu")).toBe("Asia/Kathmandu");
    expect(modernName("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(modernName("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(modernName("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
  });

  it("leaves a name alone when it is already modern", () => {
    expect(modernName("Asia/Kathmandu")).toBe("Asia/Kathmandu");
    expect(modernName("America/New_York")).toBe("America/New_York");
    expect(modernName("UTC")).toBe("UTC");
  });

  it("treats both spellings as the same zone", () => {
    expect(sameZone("Asia/Katmandu", "Asia/Kathmandu")).toBe(true);
    expect(sameZone("Asia/Calcutta", "Asia/Kolkata")).toBe(true);
    expect(sameZone("Asia/Tokyo", "Asia/Tokyo")).toBe(true);
    expect(sameZone("Asia/Tokyo", "Asia/Kathmandu")).toBe(false);
  });

  it("schedules a deprecated spelling identically to the modern one", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const schedule = { sendAt: "07:30", days: [1, 2, 3, 4, 5, 6, 7], frequency: "daily" as const };
    expect(nextSlot({ ...schedule, timezone: "Asia/Katmandu" }, now)?.toISOString()).toBe(
      nextSlot({ ...schedule, timezone: "Asia/Kathmandu" }, now)?.toISOString(),
    );
  });

  it("never rewrites a stored value to the modern spelling", () => {
    // Relabelling the picker is not a migration. What is in the database stays
    // in the database.
    expect(toTimezone("Asia/Katmandu")).toBe("Asia/Katmandu");
    expect(toTimezone("Asia/Calcutta")).toBe("Asia/Calcutta");
  });
});

describe("offsets", () => {
  it("gets fractional offsets exactly right", () => {
    const at = new Date("2026-01-15T00:00:00Z");
    expect(offsetMinutes("Asia/Kathmandu", at)).toBe(345);
    expect(offsetLabel("Asia/Kathmandu", at)).toBe("UTC+05:45");
    expect(offsetMinutes("Asia/Kolkata", at)).toBe(330);
    expect(offsetLabel("Asia/Kolkata", at)).toBe("UTC+05:30");
    expect(offsetMinutes("Australia/Adelaide", at)).toBe(630);
    expect(offsetLabel("Australia/Adelaide", at)).toBe("UTC+10:30");
  });

  it("handles the 45-minute and negative-fraction cases", () => {
    const at = new Date("2026-01-15T00:00:00Z");
    expect(offsetLabel("Pacific/Chatham", at)).toBe("UTC+13:45");
    expect(offsetLabel("America/St_Johns", at)).toBe("UTC-03:30");
  });

  it("tracks DST rather than reporting a fixed offset", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    const summer = new Date("2026-07-15T12:00:00Z");
    expect(offsetMinutes("America/New_York", winter)).toBe(-300);
    expect(offsetMinutes("America/New_York", summer)).toBe(-240);
    expect(offsetMinutes("Europe/London", winter)).toBe(0);
    expect(offsetMinutes("Europe/London", summer)).toBe(60);
    // Southern hemisphere runs the other way.
    expect(offsetMinutes("Australia/Sydney", winter)).toBe(660);
    expect(offsetMinutes("Australia/Sydney", summer)).toBe(600);
  });

  it("reports UTC without a sign", () => {
    expect(offsetLabel("UTC", new Date("2026-01-15T00:00:00Z"))).toBe("UTC");
  });

  it("returns null for a zone it cannot resolve", () => {
    expect(offsetMinutes("Mars/Olympus_Mons")).toBeNull();
    expect(offsetLabel("Mars/Olympus_Mons")).toBe("");
  });
});

describe("labels", () => {
  it("reads a city out of the identifier", () => {
    expect(cityName("Asia/Kathmandu")).toBe("Kathmandu");
    expect(cityName("America/New_York")).toBe("New York");
    expect(cityName("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(cityName("UTC")).toBe("UTC");
  });

  it("reads the region, and leaves it empty for single-segment zones", () => {
    expect(regionName("Asia/Kathmandu")).toBe("Asia");
    expect(regionName("America/Argentina/Buenos_Aires")).toBe("America");
    expect(regionName("UTC")).toBe("");
  });

  it("keeps the canonical id as the value, never the label", () => {
    const option = timezoneOption("America/New_York", new Date("2026-01-15T00:00:00Z"));
    expect(option.value).toBe("America/New_York");
    expect(option.city).toBe("New York");
    expect(option.offset).toBe("UTC-05:00");
  });
});

describe("searchTimezones", () => {
  const options = timezoneOptions(undefined, new Date("2026-01-15T00:00:00Z"));

  it("finds a zone by city name", () => {
    const hits = searchTimezones("kathmandu", options);
    expect(hits[0]?.value).toBe("Asia/Kathmandu");
  });

  it("finds a zone typed with an underscore or a space", () => {
    expect(searchTimezones("new_york", options).some((o) => o.value === "America/New_York")).toBe(
      true,
    );
    expect(searchTimezones("new york", options).some((o) => o.value === "America/New_York")).toBe(
      true,
    );
  });

  it("finds a zone by full identifier and by region", () => {
    expect(searchTimezones("Europe/London", options)[0]?.value).toBe("Europe/London");
    expect(searchTimezones("europe", options).every((o) => o.value.includes("Europe"))).toBe(true);
  });

  it("is case-insensitive and prefers a prefix match", () => {
    const hits = searchTimezones("TOKYO", options);
    expect(hits[0]?.value).toBe("Asia/Tokyo");
  });

  it("finds zones by offset", () => {
    expect(searchTimezones("UTC+05:45", options).some((o) => o.value === "Asia/Kathmandu")).toBe(
      true,
    );
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchTimezones("zzzzznotazone", options)).toEqual([]);
  });

  it("caps results so the popover stays cheap to render", () => {
    expect(searchTimezones("", options, 20)).toHaveLength(20);
    expect(searchTimezones("a", options, 20).length).toBeLessThanOrEqual(20);
  });

  it("shows a renamed zone once, under its modern spelling", () => {
    // A reader stored as Asia/Calcutta sees Kolkata, not both — same place.
    const withAlias = timezoneOptions("Asia/Calcutta", new Date("2026-01-15T00:00:00Z"));
    expect(withAlias.some((o) => o.value === "Asia/Kolkata")).toBe(true);
    expect(withAlias.some((o) => o.value === "Asia/Calcutta")).toBe(false);
  });

  it("appends a stored zone the list does not otherwise cover", () => {
    const withLegacy = timezoneOptions("US/Eastern", new Date("2026-01-15T00:00:00Z"));
    expect(withLegacy.some((o) => o.value === "US/Eastern")).toBe(true);
  });

  it("does not duplicate a zone that is already listed", () => {
    const listed = timezoneOptions("Asia/Tokyo");
    expect(listed.filter((o) => o.value === "Asia/Tokyo")).toHaveLength(1);
  });
});

/**
 * The picker is only worth anything if every zone it offers actually schedules.
 * These run the real `nextSlot` rather than re-deriving the arithmetic.
 */
describe("scheduling in selectable zones", () => {
  const daily = { sendAt: "07:30", days: [1, 2, 3, 4, 5, 6, 7], frequency: "daily" as const };

  function localClock(at: Date, timeZone: string): string {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(at);
  }

  it("fires at 07:30 local in a fractional-offset zone", () => {
    const slot = nextSlot(
      { ...daily, timezone: "Asia/Kathmandu" },
      new Date("2026-01-15T00:00:00Z"),
    );
    expect(slot).not.toBeNull();
    expect(localClock(slot!, "Asia/Kathmandu")).toBe("07:30");
    // 07:30 at +05:45 is 01:45 UTC.
    expect(slot!.toISOString()).toBe("2026-01-15T01:45:00.000Z");
  });

  it("still fires at 07:30 local on both sides of a US DST change", () => {
    // US DST starts 2026-03-08. Before and after, the wall clock is what the
    // reader was promised even though the UTC instant moves an hour.
    const before = nextSlot(
      { ...daily, timezone: "America/New_York" },
      new Date("2026-03-01T00:00:00Z"),
    );
    const after = nextSlot(
      { ...daily, timezone: "America/New_York" },
      new Date("2026-03-15T00:00:00Z"),
    );
    expect(localClock(before!, "America/New_York")).toBe("07:30");
    expect(localClock(after!, "America/New_York")).toBe("07:30");
    expect(before!.toISOString()).toBe("2026-03-01T12:30:00.000Z");
    expect(after!.toISOString()).toBe("2026-03-15T11:30:00.000Z");
  });

  it("still fires at 07:30 local on both sides of a UK DST change", () => {
    // UK DST starts 2026-03-29.
    const before = nextSlot(
      { ...daily, timezone: "Europe/London" },
      new Date("2026-03-20T00:00:00Z"),
    );
    const after = nextSlot(
      { ...daily, timezone: "Europe/London" },
      new Date("2026-04-05T00:00:00Z"),
    );
    expect(localClock(before!, "Europe/London")).toBe("07:30");
    expect(localClock(after!, "Europe/London")).toBe("07:30");
    expect(before!.toISOString()).toBe("2026-03-20T07:30:00.000Z");
    expect(after!.toISOString()).toBe("2026-04-05T06:30:00.000Z");
  });

  it("schedules a legacy alias exactly like its modern spelling", () => {
    const now = new Date("2026-01-15T00:00:00Z");
    const alias = nextSlot({ ...daily, timezone: "Asia/Calcutta" }, now);
    const modern = nextSlot({ ...daily, timezone: "Asia/Kolkata" }, now);
    expect(alias?.toISOString()).toBe(modern?.toISOString());
  });

  it("refuses to schedule a zone that is not selectable", () => {
    expect(nextSlot({ ...daily, timezone: "Mars/Olympus_Mons" }, new Date())).toBeNull();
  });

  it("schedules correctly in a sample from across the real list", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const sample = [
      "UTC",
      "Pacific/Auckland",
      "Pacific/Chatham",
      "Australia/Adelaide",
      "Asia/Tokyo",
      "Asia/Kathmandu",
      "Asia/Tehran",
      "Europe/London",
      "America/St_Johns",
      "America/Los_Angeles",
      "Pacific/Honolulu",
    ];
    for (const timezone of sample) {
      const slot = nextSlot({ ...daily, timezone }, now);
      expect(slot, timezone).not.toBeNull();
      expect(localClock(slot!, timezone), timezone).toBe("07:30");
    }
  });
});
