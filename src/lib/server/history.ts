import type { SupabaseClient } from "@supabase/supabase-js";
import type { MonthFacts } from "@/lib/history-window";
import type { Database } from "@/lib/supabase/types";

/**
 * Every read of personal history, bounded by the reader's current entitlement.
 *
 * ---------------------------------------------------------------------------
 * Why this exists as its own module
 * ---------------------------------------------------------------------------
 *
 * Server functions run with the **service-role client** (`guard.ts` hands one
 * down on `context.actor.db`), and service_role bypasses row-level security. So
 * the digests policy added in 0067 protects the browser — which talks to
 * PostgREST directly, as `plan-state.ts` does — and protects nothing at all
 * here. Every server-side read has to apply the window itself.
 *
 * Doing that inline at call sites is how the original gap happened. Collecting
 * the queries here means the boundary is applied in one file, and the tests
 * can drive that file against a fake PostgREST without a framework in the way.
 *
 * The window itself is never computed in TypeScript. It comes from
 * `history_window_start()`, the same function the RLS policy calls, so the two
 * layers cannot disagree about what "seven days" means.
 */

type Db = SupabaseClient<Database>;

export type MonthBounds = MonthFacts & { startsAt: string; endsAt: string };

export type HistoryDigestRow = {
  digest_id: string;
  scheduled_for: string;
  status: string;
  item_count: number;
};

/**
 * The oldest timestamp this reader may read, as the database sees it.
 *
 * Throws rather than falling back. A failed lookup here is the entitlement
 * boundary being unavailable, and the safe reading of that is "no history right
 * now", not "all of it" — an error page is recoverable, a leak is not.
 */
export async function historyWindowStart(db: Db, userId: string): Promise<string> {
  const { data, error } = await db.rpc("history_window_start", { p_user: userId });
  if (error) throw new Error(`reading history window: ${error.message}`);
  if (typeof data !== "string") throw new Error("reading history window: no window returned");
  return data;
}

/** Calendar months that overlap the reader's current history window. */
export async function readHistoryMonths(
  db: Db,
  userId: string,
  windowStart: string,
): Promise<MonthBounds[]> {
  const { data, error } = await db.rpc("history_months", { p_user: userId });
  if (error) throw new Error(`reading history months: ${error.message}`);
  const rows = (data ?? []) as {
    month_key: string;
    starts_at: string;
    ends_at: string;
    available: number;
    locked_newest_at: string | null;
    locked_oldest_at: string | null;
  }[];
  const boundary = Date.parse(windowStart);
  return rows
    .filter((row) => Number.isFinite(boundary) && Date.parse(row.ends_at) > boundary)
    .map((row) => ({
      monthKey: row.month_key,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      available: row.available ?? 0,
      lockedNewestAt: null,
      lockedOldestAt: null,
    }));
}

/** The later of two instants, as an ISO string. */
function latest(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * One month of briefings, clamped to the entitlement window.
 *
 * Clamped rather than filtered afterwards: the month a reader taps may start
 * before their window does, and the days from before it must never leave the
 * database. Reading one month at a time is also what keeps an Omni archive
 * cheap — a bounded range scan on `digests_user_idx` instead of 365 rows
 * fetched so that eleven months of them can be hidden in React.
 */
export async function readHistoryDays(
  db: Db,
  userId: string,
  range: { startsAt: string; endsAt: string; windowStart: string },
): Promise<HistoryDigestRow[]> {
  const { data, error } = await db
    .from("digests")
    .select("digest_id, scheduled_for, status, item_count")
    .eq("user_id", userId)
    .eq("kind", "briefing")
    .in("status", ["ready", "sent", "skipped"])
    .gte("scheduled_for", latest(range.startsAt, range.windowStart))
    .lt("scheduled_for", range.endsAt)
    .order("scheduled_for", { ascending: false })
    .limit(40);
  if (error) throw new Error(`reading history: ${error.message}`);
  return (data ?? []) as HistoryDigestRow[];
}

/**
 * A digest this reader owns *and* may still open, or null.
 *
 * Ownership alone used to be the whole check, which made a digest id from a
 * bookmark or a browser history entry a way around the plan window: the
 * History page would refuse to list the day, and this would happily return
 * every story in it.
 */
export async function digestInWindow(
  db: Db,
  userId: string,
  digestId: string,
  windowStart: string,
): Promise<{ digest_id: string; scheduled_for: string } | null> {
  const { data, error } = await db
    .from("digests")
    .select("digest_id, scheduled_for")
    .eq("digest_id", digestId)
    .eq("user_id", userId)
    .gte("scheduled_for", windowStart)
    .maybeSingle();
  if (error) throw new Error(`reading digest: ${error.message}`);
  return (data as { digest_id: string; scheduled_for: string } | null) ?? null;
}

/**
 * Whether this reader may open this story at all.
 *
 * Three ways in, checked cheapest first:
 *
 *   saved        — a bookmark outlives the window on purpose (§9). Saving is a
 *                  decision the reader made; expiry is not allowed to undo it.
 *   matched      — a `user_events` row inside the window: the story reached
 *                  them through their own interests and still counts as theirs.
 *   delivered    — an in-window digest of theirs contains it. Kept as a
 *                  separate check because `user_events` is pruned on the same
 *                  cutoff, and a match recorded the day before a briefing can
 *                  age out one day before the briefing does. Without this, the
 *                  oldest readable day would list stories that refuse to open.
 *
 * Anything else — an event id typed into the URL, a story from before the
 * window, another reader's briefing — is not visible, and `loadStory` returns
 * null rather than explaining which of the three it failed.
 */
export async function storyVisible(
  db: Db,
  userId: string,
  eventId: string,
  windowStart: string,
): Promise<boolean> {
  const saved = await db
    .from("saved_stories")
    .select("event_id")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (saved.error) throw new Error(`reading saved story: ${saved.error.message}`);
  if (saved.data) return true;

  const matched = await db
    .from("user_events")
    .select("event_id")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .gte("matched_at", windowStart)
    .maybeSingle();
  if (matched.error) throw new Error(`reading match: ${matched.error.message}`);
  if (matched.data) return true;

  const delivered = await db
    .from("digest_items")
    .select("event_id, digests!inner ( user_id, scheduled_for )")
    .eq("event_id", eventId)
    .eq("digests.user_id", userId)
    .gte("digests.scheduled_for", windowStart)
    .limit(1);
  if (delivered.error) throw new Error(`reading delivered story: ${delivered.error.message}`);
  return (delivered.data ?? []).length > 0;
}
