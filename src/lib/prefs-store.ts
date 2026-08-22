import { useCallback, useEffect, useState } from "react";

export type Prefs = {
  name: string;
  topics: string[];
  exclusions: string[];
  time: string;
  timezone: string;
  days: string[];
  channels: { email: boolean; telegram: boolean; whatsapp: boolean };
  density: number; // 0 minimal .. 100 deep
  frequency: "daily" | "weekly";
  breaking: "important" | "everything" | "off";
  onboarded: boolean;
};

/**
 * What a brand-new visitor starts with.
 *
 * These must stay GENERIC. This object shipped with a real person's name,
 * timezone and interests baked in as prototype fixtures, so every visitor who
 * finished onboarding was greeted by somebody else's first name. Anything
 * added here is shown to strangers — if a value is personal, it belongs in the
 * account, not in a default.
 *
 * `name` is empty on purpose rather than "there" or "friend": the greeting is
 * written to work without one, and inventing a placeholder identity is what
 * caused the original bug.
 */
export const DEFAULT_PREFS: Prefs = {
  name: "",
  topics: [],
  exclusions: [],
  time: "07:30",
  // Overwritten with the browser's own zone on hydration — see below. A literal
  // is still needed because this is read during SSR, where there is no browser.
  timezone: "UTC",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  channels: { email: true, telegram: false, whatsapp: false },
  density: 35,
  frequency: "daily",
  breaking: "important",
  onboarded: false,
};

/**
 * The visitor's actual timezone, or UTC if the browser will not say.
 *
 * Never called during render — only from the hydration effect — because it
 * returns a different answer on the server than in the browser, which is the
 * definition of a hydration mismatch.
 */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Bumped to v2 when the prototype fixtures came out of `DEFAULT_PREFS`.
 *
 * Anyone who used the app before that has a v1 blob holding the old defaults —
 * including the hard-coded name — and `{...DEFAULT_PREFS, ...stored}` would
 * faithfully restore it, so fixing the default alone would not have fixed the
 * browsers that actually saw the bug. Changing the key retires those blobs.
 *
 * Bump this again whenever a change to the shape or the defaults would be wrong
 * to merge onto a stored value.
 */
const KEY = "nyuz.prefs.v2";

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) });
      } else {
        // First visit: adopt the browser's timezone so the schedule step opens
        // on the right one instead of making everybody correct UTC by hand.
        setPrefs({ ...DEFAULT_PREFS, timezone: detectTimezone() });
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { prefs, update, hydrated };
}
