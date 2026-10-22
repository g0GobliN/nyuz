import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { DEFAULT_PREFS, type Prefs } from "@/lib/prefs";
import { startFirstBriefing } from "@/lib/server/briefing";
import { loadPreferences, savePreferences, type PrefsInput } from "@/lib/server/preferences";
import { captureSignupTimezone } from "@/lib/server/timezone";
import { detectTimezone, sameZone, toTimezone } from "@/lib/timezones";

export { DEFAULT_PREFS, type Prefs };

/**
 * `detectTimezone` returns a different answer on the server than in the
 * browser, so it is only ever called from the hydration effect — calling it
 * during render is the definition of a hydration mismatch.
 */

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
  const [accountLoaded, setAccountLoaded] = useState(false);
  // Guards against a save firing while the server copy is still arriving, which
  // would push defaults over real stored settings.
  const loaded = useRef(false);

  useEffect(() => {
    const local = readLocal();
    const merged = {
      ...DEFAULT_PREFS,
      // First visit: adopt the browser's timezone so the schedule step opens on
      // the right one instead of making everybody correct UTC by hand.
      ...(local ?? { timezone: detectTimezone() }),
      channels: { ...DEFAULT_PREFS.channels, ...local?.channels },
    };
    // A stored zone is kept whenever the runtime can still schedule in it,
    // including legacy aliases like Asia/Calcutta. Only a value that would
    // make `nextSlot` return null is replaced, and it falls back to where the
    // reader actually is rather than to UTC.
    setPrefs({ ...merged, timezone: toTimezone(merged.timezone, detectTimezone()) });
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

        // Where the reader is, stored once, on the first authenticated load.
        //
        // A reader who has not finished the schedule step holds the `'UTC'`
        // column default rather than a choice: that step is the only place a
        // zone can be picked, and `/dashboard` sends them to `/onboarding`
        // until they have. The email path may already have carried the
        // browser's zone in through signup metadata; Google and GitHub cannot,
        // and neither can any row written before 0123. So this is the
        // correction for them.
        //
        // `!remote.onboarded` is checked here as well as in the database
        // because it is also the cheap answer: an onboarded reader who picked
        // a zone other than their browser's must not send a request that is
        // certain to be refused, on every mount of every `usePrefs`. The
        // database refuses the same readers again -- and additionally leaves a
        // zone the signup already captured alone -- so this is an optimisation,
        // never the guard.
        //
        // `sameZone` rather than `===`, so a legacy alias for the zone already
        // stored (`Asia/Calcutta` against `Asia/Kolkata`) is not treated as a
        // difference worth a write.
        //
        // Awaited rather than fired and forgotten, because the answer is used
        // below: the settings that come out of this load must be the ones the
        // account now holds, and a correction that landed after `setPrefs`
        // would be overwritten by it. It costs one request, once, and only for
        // an account that still carries the default -- `setAccountLoaded` is
        // already waiting on a request here, so the page does not gain a
        // loading state it did not have.
        const zone = detectTimezone();
        let account = remote;
        if (!remote.onboarded && !sameZone(remote.timezone, zone)) {
          try {
            const captured = await captureSignupTimezone({ data: { timezone: zone } });
            if (!active) return;
            // The zone the account holds now, which is the reader's own when
            // the database wrote it and their existing one when it refused.
            if (!sameZone(captured.timezone, remote.timezone)) {
              account = { ...remote, timezone: captured.timezone };
            }
          } catch (error) {
            // A correction that cannot be stored is not a reason to lose the
            // reader's settings. The next load tries again.
            console.error(error);
          }
        }

        const local = readLocal();
        // A reader who filled in onboarding before signing up has answers the
        // account has never seen. Carry them up once, then let the account win
        // from here — the alternative is silently discarding the only thing
        // they have done so far.
        const unsynced = local && remote.topics.length === 0 && (local.topics?.length ?? 0) > 0;

        const next = unsynced
          ? {
              ...account,
              ...local,
              channels: { ...DEFAULT_PREFS.channels, ...account.channels, ...local.channels },
            }
          : account;
        setPrefs(next);
        writeLocal(next);

        if (unsynced) {
          await savePreferences({
            data: {
              name: next.name,
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
              onboarded: next.onboarded,
            },
          });

          // The account has topics for the first time, so day one starts here.
          // A visitor who completed onboarding before signing up had nothing on
          // the server to match against at the moment they finished; this is
          // the first instant that stops being true. Fire and forget — the
          // backfill writes rows the dashboard reads on its next load, and it
          // refuses to spend anything twice for one account.
          void startFirstBriefing().catch((error: unknown) => console.error(error));
        }
        setAccountLoaded(true);
      } catch (error) {
        // An unreachable account is not a reason to lose the local copy; the
        // cache is already rendering and the next save will retry.
        console.error(error);
        setAccountLoaded(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [user, authLoading]);

  /**
   * Applies a change locally and pushes it up.
   *
   * Returns a promise so a caller that has to know when the account has the new
   * value can wait for it — onboarding does, because the day-one backfill
   * matches against `user_topics`, and matching before the topics have landed
   * would match an empty list and conclude the reader is interested in nothing.
   * Every other caller ignores the promise, and is right to: the local copy has
   * already updated and a settings toggle that waited on a round trip would feel
   * broken.
   */
  const update = useCallback(
    async (patch: Partial<Prefs>): Promise<void> => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        writeLocal(next);
        return next;
      });

      // Only what changed goes up, so two tabs editing different settings do
      // not overwrite each other with their own stale view of the rest.
      if (!user) return;
      try {
        await savePreferences({ data: patch as PrefsInput });
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : "Could not save preferences.");
        const saved = await loadPreferences().catch(() => null);
        if (saved) {
          setPrefs(saved);
          writeLocal(saved);
        }
      }
    },
    [user],
  );

  return { prefs, update, hydrated, accountLoaded };
}
