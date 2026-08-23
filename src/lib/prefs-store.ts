import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadPreferences, savePreferences, type PrefsInput } from "@/lib/server/preferences";

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
  /** Briefings stop entirely. Mirrors notification_preferences.paused. */
  paused: boolean;
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
  paused: false,
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

function readLocal(): Partial<Prefs> | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : null;
  } catch {
    return null;
  }
}

function writeLocal(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* Private modes refuse to store. The account still has the real copy. */
  }
}

/**
 * The reader's settings.
 *
 * The account is the source of truth; `localStorage` is a cache in front of it.
 * That ordering is the whole point of this hook. Browser storage alone could not
 * be read by the pipeline, which runs on a cron with no browser attached, so a
 * topic list held only in a tab could never actually produce a briefing.
 *
 * Signed out — onboarding before sign-up — it still works entirely locally, and
 * whatever was chosen is pushed up on the first authenticated load. Nobody loses
 * the answers they gave before they had an account.
 *
 * Writes are optimistic: the interface updates immediately and the save happens
 * behind it. A settings toggle that waits on a round trip feels broken, and the
 * local copy means a failed save is not a lost preference.
 */
export function usePrefs() {
  const { user, loading: authLoading } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);
  // Guards against a save firing while the server copy is still arriving, which
  // would push defaults over real stored settings.
  const loaded = useRef(false);

  useEffect(() => {
    const local = readLocal();
    setPrefs({
      ...DEFAULT_PREFS,
      // First visit: adopt the browser's timezone so the schedule step opens on
      // the right one instead of making everybody correct UTC by hand.
      ...(local ?? { timezone: detectTimezone() }),
    });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (authLoading || !user || loaded.current) return;
    let active = true;

    void (async () => {
      try {
        const remote = await loadPreferences();
        if (!active) return;
        loaded.current = true;

        const local = readLocal();
        // A reader who filled in onboarding before signing up has answers the
        // account has never seen. Carry them up once, then let the account win
        // from here — the alternative is silently discarding the only thing
        // they have done so far.
        const unsynced = local && remote.topics.length === 0 && (local.topics?.length ?? 0) > 0;

        const next = unsynced ? { ...remote, ...local } : remote;
        setPrefs(next);
        writeLocal(next);

        if (unsynced) {
          await savePreferences({
            data: {
              topics: next.topics,
              exclusions: next.exclusions,
              time: next.time,
              timezone: next.timezone,
              days: next.days,
              channels: next.channels,
              density: next.density,
              frequency: next.frequency,
              breaking: next.breaking,
              paused: next.paused,
            },
          });
        }
      } catch (error) {
        // An unreachable account is not a reason to lose the local copy; the
        // cache is already rendering and the next save will retry.
        console.error(error);
      }
    })();

    return () => {
      active = false;
    };
  }, [user, authLoading]);

  const update = useCallback(
    (patch: Partial<Prefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        writeLocal(next);
        return next;
      });

      // Only what changed goes up, so two tabs editing different settings do
      // not overwrite each other with their own stale view of the rest.
      if (user) {
        void savePreferences({ data: patch as PrefsInput }).catch((error: unknown) =>
          console.error(error),
        );
      }
    },
    [user],
  );

  return { prefs, update, hydrated };
}
