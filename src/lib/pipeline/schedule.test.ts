import { describe, expect, it } from "vitest";
import { clockInZone, nextSlot, parseClock } from "./schedule";

const WEEKDAYS = [1, 2, 3, 4, 5];

describe("parseClock", () => {
  it("reads HH:MM and HH:MM:SS", () => {
    expect(parseClock("07:30")).toEqual({ hour: 7, minute: 30 });
    expect(parseClock("07:30:00")).toEqual({ hour: 7, minute: 30 });
  });

  it("refuses an impossible time rather than wrapping it", () => {
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("07:60")).toBeNull();
    expect(parseClock("")).toBeNull();
  });
});

describe("nextSlot", () => {
  it("returns today's send time when it is still ahead", () => {
    // Wednesday 26 August 2026, 06:00 UTC.
    const now = new Date("2026-08-26T06:00:00Z");
    expect(
      nextSlot({ sendAt: "07:30", timezone: "UTC", days: WEEKDAYS, frequency: "daily" }, now),
    ).toEqual(new Date("2026-08-26T07:30:00Z"));
  });

  it("rolls to the next allowed weekday after the send time has passed", () => {
    const now = new Date("2026-08-26T08:00:00Z");
    expect(
      nextSlot({ sendAt: "07:30", timezone: "UTC", days: WEEKDAYS, frequency: "daily" }, now),
    ).toEqual(new Date("2026-08-27T07:30:00Z"));
  });

  it("skips the weekend when weekdays are selected", () => {
    // Friday 28 August 2026, after 07:30.
    const now = new Date("2026-08-28T12:00:00Z");
    expect(
      nextSlot({ sendAt: "07:30", timezone: "UTC", days: WEEKDAYS, frequency: "daily" }, now),
    ).toEqual(new Date("2026-08-31T07:30:00Z"));
  });

  it("weekly fires once, on the earliest allowed day", () => {
    // Wednesday, before 07:30 — weekly Mon–Fri is Monday next week, not today.
    const now = new Date("2026-08-26T06:00:00Z");
    expect(
      nextSlot({ sendAt: "07:30", timezone: "UTC", days: WEEKDAYS, frequency: "weekly" }, now),
    ).toEqual(new Date("2026-08-31T07:30:00Z"));
  });

  it("interprets send_at in the reader's timezone, not UTC", () => {
    // 12:00 UTC is 08:00 in New York (EDT, UTC-4) on 26 August 2026.
    // 07:30 Eastern has already passed, so the next slot is Thursday 07:30 EDT
    // = 11:30 UTC.
    const now = new Date("2026-08-26T12:00:00Z");
    expect(
      nextSlot(
        { sendAt: "07:30", timezone: "America/New_York", days: WEEKDAYS, frequency: "daily" },
        now,
      ),
    ).toEqual(new Date("2026-08-27T11:30:00Z"));
  });

  it("returns null when nothing is selected", () => {
    const now = new Date("2026-08-26T06:00:00Z");
    expect(
      nextSlot({ sendAt: "07:30", timezone: "UTC", days: [], frequency: "daily" }, now),
    ).toBeNull();
  });
});

describe("clockInZone", () => {
  it("prints the hour the reader asked for", () => {
    expect(clockInZone(new Date("2026-08-26T11:30:00Z"), "America/New_York")).toBe("07:30");
  });
});
