/**
 * The timezones a reader can be scheduled in.
 *
 * The list is not hard-coded. `Intl.supportedValuesOf("timeZone")` is exactly
 * the set of zones the runtime can actually do arithmetic in, so asking it is
 * both cheaper than shipping a table and impossible to get out of step with
 * the scheduler — a zone that can be picked is a zone `nextSlot` can resolve.
 *
 * Stored values stay canonical IANA identifiers ("Asia/Kathmandu"). Labels are
 * derived for display only and are never written anywhere.
 */

/** Where the reader is, or UTC if the browser will not say. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Zones for runtimes without `Intl.supportedValuesOf`.
 *
 * Deliberately small and offset-diverse rather than exhaustive: it only has to
 * keep the picker usable on an old engine, and any zone the runtime knows
 * still validates through `isSupportedTimezone`, so a reader who already has
 * one stored is never told it is invalid. Includes the fractional offsets
 * (+05:45, +05:30, +09:30) that a naive whole-hour list would drop.
 */
const FALLBACK_ZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "America/St_Johns",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Bangkok",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Kabul",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tehran",
  "Asia/Tokyo",
  "Atlantic/Reykjavik",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Oslo",
  "Europe/Paris",
  "Europe/Prague",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Zurich",
  "Pacific/Auckland",
  "Pacific/Chatham",
  "Pacific/Fiji",
  "Pacific/Honolulu",
] as const;

/**
 * Renames where `supportedValuesOf` cannot be trusted to give the modern name.
 *
 * ICU resolves these to whichever spelling its own tables call primary, and
 * that differs by engine: this project's Node returns `Asia/Katmandu` and
 * canonicalises `Asia/Kathmandu` *backwards* into it, while current browsers
 * return `Asia/Kathmandu`. Leaving it to the runtime would mean a reader in
 * Nepal being offered a different string depending on where the list was
 * built, so the modern IANA spelling is pinned here.
 *
 * This maps the picker's labels only. Stored values are never rewritten —
 * both spellings resolve to the same zone, so an existing `Asia/Katmandu`
 * schedules identically and is left exactly as it is.
 */
const MODERN_NAMES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Godthab": "America/Nuuk",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/**
 * The spelling to show for a zone. Falls back to the input when the runtime is
 * too old to know the modern name, so the picker never offers a zone that
 * cannot then be scheduled.
 */
export function modernName(zone: string): string {
  const modern = MODERN_NAMES[zone];
  return modern && isSupportedTimezone(modern) ? modern : zone;
}

/** Whether two identifiers name the same zone despite different spellings. */
export function sameZone(a: string, b: string): boolean {
  return a === b || modernName(a) === modernName(b);
}

let cached: string[] | null = null;

/** Every zone this runtime can schedule in, sorted, under its modern name. */
export function supportedTimezones(): string[] {
  if (cached) return cached;
  let zones: string[] = [];
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf;
    if (typeof supportedValuesOf === "function") zones = supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = [...FALLBACK_ZONES];
  zones = zones.map(modernName);
  // supportedValuesOf omits UTC on some engines, and it is the stored default
  // for anyone who has not finished onboarding.
  if (!zones.includes("UTC")) zones = ["UTC", ...zones];
  cached = [...new Set(zones)].sort((a, b) => a.localeCompare(b));
  return cached;
}

/**
 * Whether the runtime can do timezone arithmetic in `value`.
 *
 * This is the gate on stored values, so it is deliberately not "is in the
 * picker list". Legacy aliases like `Asia/Calcutta` and `US/Eastern` resolve
 * correctly but are absent from `supportedValuesOf`, and a reader who has had
 * one stored for a year must not have their schedule rejected. The shape test
 * is what keeps out arbitrary strings: no bare offsets, no free text.
 */
export function isSupportedTimezone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A stored value if it is usable, otherwise the fallback. Never throws. */
export function toTimezone(value: unknown, fallback = "UTC"): string {
  if (isSupportedTimezone(value)) return value;
  return isSupportedTimezone(fallback) ? fallback : "UTC";
}

/**
 * Minutes this zone is ahead of UTC at `at`.
 *
 * Read off the formatted wall clock rather than a table, which is what makes
 * it correct for both halves of a DST year and for the fractional zones —
 * Kathmandu is +345, not +330 rounded to something tidy.
 */
export function offsetMinutes(timeZone: string, at: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    if (Number.isNaN(asUtc)) return null;
    // Seconds are dropped on both sides, so the difference is whole minutes.
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  } catch {
    return null;
  }
}

/** `UTC+05:45`, or `UTC` on the meridian. */
export function offsetLabel(timeZone: string, at: Date = new Date()): string {
  const minutes = offsetMinutes(timeZone, at);
  if (minutes === null) return "";
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/** `Asia/Kathmandu` → `Kathmandu`. Keeps sub-regions: `Buenos_Aires` → `Buenos Aires`. */
export function cityName(timeZone: string): string {
  const tail = timeZone.split("/").pop() ?? timeZone;
  return tail.replace(/_/g, " ");
}

/** `Asia/Kathmandu` → `Asia`. Empty for single-segment zones like `UTC`. */
export function regionName(timeZone: string): string {
  const head = timeZone.split("/");
  return head.length > 1 ? (head[0] ?? "").replace(/_/g, " ") : "";
}

export type TimezoneOption = {
  /** The canonical IANA id — the only thing ever stored. */
  value: string;
  /** `Kathmandu` */
  city: string;
  /** `Asia` */
  region: string;
  /** `UTC+05:45` at the moment the list was built. */
  offset: string;
  /** Lowercased haystack for matching. */
  search: string;
};

export function timezoneOption(value: string, at: Date = new Date()): TimezoneOption {
  const city = cityName(value);
  const region = regionName(value);
  const offset = offsetLabel(value, at);
  return {
    value,
    city,
    region,
    offset,
    search: `${value} ${city} ${region} ${offset}`.toLowerCase().replace(/_/g, " "),
  };
}

/**
 * The picker list, with `include` appended if the runtime knows it but
 * `supportedValuesOf` does not list it — so a reader whose stored zone is a
 * legacy alias still sees their own setting rather than a blank field.
 */
export function timezoneOptions(include?: string, at: Date = new Date()): TimezoneOption[] {
  const zones = supportedTimezones();
  // `sameZone`, not `includes`: a stored `Asia/Katmandu` is already on the list
  // as `Asia/Kathmandu`, and appending it again would show the same place
  // twice.
  const extra =
    include && isSupportedTimezone(include) && !zones.some((zone) => sameZone(zone, include))
      ? [include]
      : [];
  return [...zones, ...extra].map((zone) => timezoneOption(zone, at));
}

/**
 * Match on city, region, full id or offset, in that order of usefulness.
 *
 * `limit` exists because rendering ~450 rows into a popover on a phone is the
 * difference between instant and janky; an empty query shows the head of the
 * list, and typing anything narrows it well below the cap.
 */
export function searchTimezones(
  query: string,
  options: TimezoneOption[],
  limit = 60,
): TimezoneOption[] {
  const q = query.trim().toLowerCase().replace(/_/g, " ");
  if (!q) return options.slice(0, limit);
  const starts: TimezoneOption[] = [];
  const contains: TimezoneOption[] = [];
  for (const option of options) {
    if (option.city.toLowerCase().startsWith(q)) starts.push(option);
    else if (option.search.includes(q)) contains.push(option);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
