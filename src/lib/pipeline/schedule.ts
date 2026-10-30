/**
 * When a reader's next briefing is due.
 *
 * Timezone arithmetic is deliberately not a model call and not a SQL function.
 * The product promise is "at 09:30 and 16:30 in your timezone, every day", and
 * that is calendar arithmetic over `notification_preferences`. A library
 * that pulled in IANA data as a Node builtin would fail on Workers; `Intl`
 * is the API both runtimes actually have.
 */

export type DigestSchedule = {
  /** `HH:MM` or `HH:MM:SS`, as `notification_preferences.send_at` stores it. */
  sendAt: string;
  timezone: string;
  /** ISO weekday numbers, 1 = Monday .. 7 = Sunday. */
  days: number[];
  frequency: "daily" | "weekly";
};

export type ClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday, 1 = Monday .. 7 = Sunday. */
  weekday: number;
};

/**
 * The next send instant strictly after `now`, or null if the schedule cannot
 * fire — no days selected, or a timezone the runtime does not know.
 *
 * `weekly` means once a week, on the earliest allowed weekday. `daily` means
 * every allowed weekday. A reader who left Mon–Fri ticked and switched the
 * frequency to weekly therefore gets Monday, not five emails.
 */
export function nextSlot(schedule: DigestSchedule, now: Date): Date | null {
  const clock = parseClock(schedule.sendAt);
  if (clock === null) return null;

  const days = uniqueDays(schedule.days);
  if (days.length === 0) return null;

  const allowed = schedule.frequency === "weekly" ? [days[0] ?? 1] : days;

  try {
    partsInZone(now, schedule.timezone);
  } catch {
    return null;
  }

  const today = partsInZone(now, schedule.timezone);

  for (let offset = 0; offset <= 14; offset += 1) {
    const local = addDays(today, offset);
    if (!allowed.includes(local.weekday)) continue;

    const utc = utcFromZoned(
      local.year,
      local.month,
      local.day,
      clock.hour,
      clock.minute,
      schedule.timezone,
    );
    if (utc === null) continue;
    if (utc.getTime() > now.getTime()) return utc;
  }

  return null;
}

/**
 * Every slot in the reader's day that is still ahead of `now`, earliest first.
 *
 * One call per clock time in `times` (`deliveryTimesFor` in
 * `briefing-slots.ts` decides that list), then deduped by instant: a reader
 * whose morning time is 16:30 has one briefing, not the same row twice.
 */
export function nextSlots(
  schedule: Omit<DigestSchedule, "sendAt">,
  now: Date,
  times: string[],
): Date[] {
  const slots = new Map<number, Date>();
  for (const time of times) {
    const slot = nextSlot({ ...schedule, sendAt: time }, now);
    if (slot !== null) slots.set(slot.getTime(), slot);
  }
  return [...slots.values()].sort((a, b) => a.getTime() - b.getTime());
}

/** `HH:MM` from a timestamptz, in the reader's zone — for the dashboard chip. */
export function clockInZone(at: Date, timeZone: string): string {
  const parts = partsInZone(at, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Human label for the next briefing slot in the reader's own timezone. */
export function nextBriefingLabel(at: Date, timeZone: string, now = new Date()): string {
  const target = partsInZone(at, timeZone);
  const today = partsInZone(now, timeZone);
  const daysAway = localDayDistance(today, target);
  const clock = `${pad(target.hour)}:${pad(target.minute)}`;

  if (daysAway === 0) return `Today · ${clock}`;
  if (daysAway === 1) return `Tomorrow · ${clock}`;

  const weekday = at.toLocaleDateString(undefined, {
    timeZone,
    weekday: "long",
  });
  return `${weekday} · ${clock}`;
}

/**
 * The hour of the day this instant fell on where the reader is, or null when
 * the zone is one the runtime cannot read.
 *
 * Null rather than a throw or a UTC guess: the one caller is push copy deciding
 * between "morning" and "evening", and a briefing that arrives with no
 * time-of-day word is correct, where one that calls 22:00 "morning" is not.
 */
export function hourInZone(at: Date, timeZone: string): number | null {
  try {
    return partsInZone(at, timeZone).hour;
  } catch {
    return null;
  }
}

export function parseClock(sendAt: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(sendAt.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function uniqueDays(days: number[]): number[] {
  return [...new Set(days.filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localDayDistance(from: ClockParts, to: ClockParts): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}

function addDays(parts: ClockParts, days: number): ClockParts {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days);
  const date = new Date(utc);
  const weekday = isoWeekday(date.getUTCDay());
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    weekday,
  };
}

/** 0 = Sunday .. 6 = Saturday → 1 = Monday .. 7 = Sunday. */
function isoWeekday(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

function partsInZone(date: Date, timeZone: string): ClockParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }

  const year = Number(bag["year"]);
  const month = Number(bag["month"]);
  const day = Number(bag["day"]);
  const hour = Number(bag["hour"]);
  const minute = Number(bag["minute"]);
  const second = Number(bag["second"]);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
    throw new RangeError(`unreadable instant in ${timeZone}`);
  }

  // Weekday of that calendar date, independent of the zone's offset.
  const weekday = isoWeekday(new Date(Date.UTC(year, month - 1, day)).getUTCDay());

  return { year, month, day, hour, minute, second, weekday };
}

/**
 * Wall-clock time in `timeZone` as a UTC Date.
 *
 * Guess UTC, read the zone offset at that instant, subtract, and re-check.
 * DST transitions can move the offset between the guess and the answer; one
 * correction is enough for every zone Intl actually knows.
 */
function utcFromZoned(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = offsetAt(new Date(guess), timeZone);
  if (first === null) return null;

  const utc = guess - first;
  const second = offsetAt(new Date(utc), timeZone);
  if (second === null) return null;
  if (second !== first) return new Date(guess - second);
  return new Date(utc);
}

/** Milliseconds to add to UTC to get wall time in `timeZone`. */
function offsetAt(date: Date, timeZone: string): number | null {
  try {
    const parts = partsInZone(date, timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    return asUtc - date.getTime();
  } catch {
    return null;
  }
}
