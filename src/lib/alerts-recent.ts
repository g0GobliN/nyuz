/**
 * Which breaking alerts a reader is shown, and in what order.
 *
 * Pure, and handed rows rather than a database, because two pages ask the same
 * question with a different limit — the Alerts page wants the latest twenty,
 * the history page wants the window — and "which alerts count" has to be one
 * answer rather than two that drift. A reader must never see an alert in one
 * list that the other silently disagrees about.
 *
 * Deliberately separate from src/lib/history-window.ts. That module is the
 * briefing archive's entitlement; this is a display rule for a different
 * product surface, and the two only look alike today because the numbers agree.
 */

/**
 * The Alerts page shows the latest twenty and stops.
 *
 * This is a UI limit and nothing else. Alert twenty-one falls out of the list
 * the moment it exists; it is still readable in alert history, and it is still
 * in the database until its retention window expires. Three different numbers,
 * three different jobs — conflating the first with the third is how a display
 * cap turns into silent data loss.
 */
export const RECENT_ALERT_LIMIT = 20;

/**
 * One page of alert history.
 *
 * Paged rather than returned whole. A ninety-day window at Plura's ceiling is
 * nine hundred alerts and Omni's is nine thousand — reading all of them to
 * render a screenful is a cost paid on every visit for rows nobody scrolls to.
 * Twenty-five is a screen and a bit, so the second page is a deliberate act
 * rather than something the reader pays for by default.
 */
export const ALERT_HISTORY_PAGE = 25;

/**
 * How many alert digests to read for every alert eventually shown.
 *
 * Eligibility is "at least one channel actually delivered", which cannot be
 * expressed in the digests query itself, so the delivered ones are filtered out
 * after the read and the read has to be wider than the answer. An alert digest
 * with no successful delivery means every channel failed permanently — rare,
 * and bounded by MAX_ATTEMPTS — so a factor of five is generous. If it were
 * ever exceeded the page shows fewer alerts rather than wrong ones.
 */
export const ALERT_CANDIDATE_FACTOR = 5;

export type AlertDigestRow = {
  digest_id: string;
  scheduled_for: string;
};

export type AlertDeliveryRow = {
  digest_id: string;
  status: string;
  delivered_at: string | null;
};

export type AlertItemRow = {
  digest_id: string;
  event_id: string;
  title: string;
  why: string;
};

export type AlertPage = {
  alerts: SentAlert[];
  /** Whether anything the reader may still read falls outside this page. */
  hasMore: boolean;
  /** The cursor for the next page, or null when this is the last one. */
  nextBefore: string | null;
};

export type SentAlert = {
  digestId: string;
  eventId: string;
  title: string;
  why: string;
  /** When it actually reached the reader, not when it was queued. */
  at: string;
  /**
   * When the alert fired. The ordering key, and the paging cursor.
   *
   * Ordering follows this rather than `at` because a cursor has to agree with
   * the column the query sorts on, and delivery time is not that column — a
   * channel that retried would land a row in the middle of a page already
   * fetched, which is how paging grows duplicates and holes. The two differ by
   * seconds in every ordinary case.
   */
  firedAt: string;
};

/**
 * The delivered alerts among these rows, newest first, capped at `limit`.
 *
 * "Delivered" is at least one `deliveries` row with status `sent`, and not
 * `digests.status`. The digest is only marked sent when no queued delivery
 * remains, so an alert whose email arrived and whose push later failed stays
 * `ready` for ever — reading the digest's own status would hide an alert the
 * reader demonstrably received. Reading one arbitrary delivery row, which is
 * what this replaced, would show a failed push beside an email that arrived.
 *
 * `hasMore` answers "is there anything beyond this list", which is the only
 * thing the Alerts page needs in order to decide whether offering history
 * would lead anywhere.
 */
export function selectDeliveredAlerts(input: {
  digests: AlertDigestRow[];
  deliveries: AlertDeliveryRow[];
  items: AlertItemRow[];
  limit: number;
}): AlertPage {
  const deliveredAt = new Map<string, string | null>();
  for (const row of input.deliveries) {
    if (row.status !== "sent") continue;
    const seen = deliveredAt.get(row.digest_id);
    // The latest successful channel. A reader on email and push was reached
    // when the last of them landed, and either timestamp may be null on a row
    // written before delivered_at was recorded.
    if (
      seen === undefined ||
      (row.delivered_at !== null && (seen === null || row.delivered_at > seen))
    ) {
      deliveredAt.set(row.digest_id, row.delivered_at);
    }
  }

  const itemOf = new Map(input.items.map((item) => [item.digest_id, item] as const));

  const eligible: SentAlert[] = [];
  for (const digest of input.digests) {
    if (!deliveredAt.has(digest.digest_id)) continue;
    const item = itemOf.get(digest.digest_id);
    // A digest whose event row is gone has nothing to name. Skipped rather than
    // rendered with an empty title, which reads as a broken alert.
    if (!item?.title) continue;
    eligible.push({
      digestId: digest.digest_id,
      eventId: item.event_id,
      title: item.title,
      why: item.why,
      at: deliveredAt.get(digest.digest_id) ?? digest.scheduled_for,
      firedAt: digest.scheduled_for,
    });
  }

  // Sorted here rather than trusted from the query, so the order is a property
  // of this function and the same in both lists whatever the query did.
  eligible.sort((a, b) =>
    a.firedAt === b.firedAt ? a.digestId.localeCompare(b.digestId) : a.firedAt < b.firedAt ? 1 : -1,
  );

  const alerts = eligible.slice(0, input.limit);
  const last = alerts[alerts.length - 1];
  return {
    alerts,
    hasMore: eligible.length > input.limit,
    // Null on the last page, so the caller has nothing to ask for rather than a
    // cursor it has to know not to use.
    nextBefore: eligible.length > input.limit && last ? last.firedAt : null,
  };
}

/**
 * Whether a paging cursor is a timestamp this can page on.
 *
 * Deliberately `Date.parse` rather than a shape check. Postgres hands
 * `timestamptz` back through PostgREST as "2026-09-09T10:00:00.123456+00:00" —
 * an offset, not a Z, and microseconds rather than milliseconds. Zod's
 * `.datetime()` accepts only the Z form, so validating the cursor that way
 * rejected the exact string this module had just produced, and the second page
 * of history failed every time it was asked for.
 *
 * A cursor is not a trust boundary: `readAlerts` applies it on top of the
 * entitlement window, so the worst a bad one can do is ask for less.
 */
export function isAlertCursor(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/**
 * The loaded alerts, cut into the months they happened in.
 *
 * Grouping only — never a filter. A month heading orients a reader scrolling a
 * list; a month *picker* would need to know which months hold alerts before
 * loading any, which is a second aggregate query over the whole window, and
 * that is the cost paging exists to avoid.
 */
export function groupAlertsByMonth(
  alerts: SentAlert[],
  locale?: string,
): { key: string; label: string; alerts: SentAlert[] }[] {
  const groups: { key: string; label: string; alerts: SentAlert[] }[] = [];
  for (const alert of alerts) {
    const date = new Date(alert.firedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const current = groups[groups.length - 1];
    if (current?.key === key) {
      current.alerts.push(alert);
      continue;
    }
    groups.push({
      key,
      label: date.toLocaleDateString(locale, { month: "long", year: "numeric" }),
      alerts: [alert],
    });
  }
  return groups;
}
