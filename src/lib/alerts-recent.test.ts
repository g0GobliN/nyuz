import { describe, expect, it } from "vitest";
import {
  ALERT_CANDIDATE_FACTOR,
  ALERT_HISTORY_PAGE,
  RECENT_ALERT_LIMIT,
  alertDeliveryOutcome,
  groupAlertsByMonth,
  isAlertCursor,
  selectDeliveredAlerts,
  type AlertDeliveryRow,
  type AlertDigestRow,
  type AlertItemRow,
} from "@/lib/alerts-recent";

function digest(id: string, scheduledFor: string): AlertDigestRow {
  return { digest_id: id, scheduled_for: scheduledFor };
}

function item(id: string, title = `Story ${id}`): AlertItemRow {
  return { digest_id: id, event_id: `event-${id}`, title, why: `Why ${id}` };
}

function sent(id: string, at: string | null, channel = "email"): AlertDeliveryRow {
  void channel;
  return { digest_id: id, status: "sent", delivered_at: at };
}

function failed(id: string): AlertDeliveryRow {
  return { digest_id: id, status: "failed", delivered_at: null };
}

function queued(id: string): AlertDeliveryRow {
  return { digest_id: id, status: "queued", delivered_at: null };
}

describe("alertDeliveryOutcome", () => {
  it("is success when every channel delivered", () => {
    expect(alertDeliveryOutcome([sent("a", "2026-09-09T10:00:00Z")])).toBe("success");
    expect(
      alertDeliveryOutcome([
        sent("a", "2026-09-09T10:00:00Z", "email"),
        sent("a", "2026-09-09T10:01:00Z", "push"),
      ]),
    ).toBe("success");
  });

  it("is partial when one channel delivered and another failed", () => {
    expect(alertDeliveryOutcome([sent("a", "2026-09-09T10:00:00Z"), failed("a")])).toBe("partial");
  });

  it("is failed when no channel delivered", () => {
    expect(alertDeliveryOutcome([failed("a")])).toBe("failed");
    expect(alertDeliveryOutcome([])).toBe("failed");
  });

  it("is pending while any channel is still queued", () => {
    expect(alertDeliveryOutcome([queued("a")])).toBe("pending");
    expect(alertDeliveryOutcome([sent("a", "2026-09-09T10:00:00Z"), queued("a")])).toBe("pending");
  });
});

describe("selectDeliveredAlerts", () => {
  it("keeps only alerts a channel actually delivered", () => {
    const { alerts } = selectDeliveredAlerts({
      digests: [digest("a", "2026-09-09T10:00:00Z"), digest("b", "2026-09-09T09:00:00Z")],
      deliveries: [
        sent("a", "2026-09-09T10:00:05Z"),
        { digest_id: "b", status: "failed", delivered_at: null },
      ],
      items: [item("a"), item("b")],
      limit: RECENT_ALERT_LIMIT,
    });

    expect(alerts.map((a) => a.digestId)).toEqual(["a"]);
  });

  it("keeps an alert whose email arrived even though another channel failed", () => {
    // The digest stays `ready` for ever in this case, because the digest is
    // only marked sent when no queued delivery remains. Reading the digest's
    // own status would hide an alert the reader demonstrably received.
    const { alerts } = selectDeliveredAlerts({
      digests: [digest("a", "2026-09-09T10:00:00Z")],
      deliveries: [
        sent("a", "2026-09-09T10:00:05Z", "email"),
        { digest_id: "a", status: "failed", delivered_at: null },
      ],
      items: [item("a")],
      limit: RECENT_ALERT_LIMIT,
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.at).toBe("2026-09-09T10:00:05Z");
  });

  it("reports the latest successful channel as the time it reached the reader", () => {
    const { alerts } = selectDeliveredAlerts({
      digests: [digest("a", "2026-09-09T10:00:00Z")],
      deliveries: [
        sent("a", "2026-09-09T10:00:05Z", "email"),
        sent("a", "2026-09-09T10:04:00Z", "push"),
      ],
      items: [item("a")],
      limit: RECENT_ALERT_LIMIT,
    });

    expect(alerts[0]?.at).toBe("2026-09-09T10:04:00Z");
  });

  it("falls back to the scheduled time when a sent row has no delivered_at", () => {
    const { alerts } = selectDeliveredAlerts({
      digests: [digest("a", "2026-09-09T10:00:00Z")],
      deliveries: [sent("a", null)],
      items: [item("a")],
      limit: RECENT_ALERT_LIMIT,
    });

    expect(alerts[0]?.at).toBe("2026-09-09T10:00:00Z");
  });

  it("orders by when the alert fired, not by when a retry happened to land", () => {
    // The cursor pages on scheduled_for, so the display order has to agree with
    // it. Ordering on delivery time would drop a retried alert into the middle
    // of a page already fetched, which is how paging grows holes.
    const { alerts } = selectDeliveredAlerts({
      digests: [digest("later", "2026-09-09T10:00:00Z"), digest("earlier", "2026-09-09T09:00:00Z")],
      deliveries: [sent("later", "2026-09-09T10:00:30Z"), sent("earlier", "2026-09-09T11:00:00Z")],
      items: [item("later"), item("earlier")],
      limit: RECENT_ALERT_LIMIT,
    });

    expect(alerts.map((a) => a.digestId)).toEqual(["later", "earlier"]);
    // Still labelled with the moment it reached the reader.
    expect(alerts[1]?.at).toBe("2026-09-09T11:00:00Z");
    expect(alerts[1]?.firedAt).toBe("2026-09-09T09:00:00Z");
  });

  it("drops an alert whose event row no longer names anything", () => {
    const { alerts } = selectDeliveredAlerts({
      digests: [digest("a", "2026-09-09T10:00:00Z")],
      deliveries: [sent("a", "2026-09-09T10:00:05Z")],
      items: [item("a", "")],
      limit: RECENT_ALERT_LIMIT,
    });

    expect(alerts).toEqual([]);
  });

  it("caps the page and hands back a cursor for the next one", () => {
    const digests = Array.from({ length: 25 }, (_, i) =>
      digest(
        `d${String(i).padStart(2, "0")}`,
        `2026-09-09T${String(i % 24).padStart(2, "0")}:00:00Z`,
      ),
    );
    const result = selectDeliveredAlerts({
      digests,
      deliveries: digests.map((d) => sent(d.digest_id, d.scheduled_for)),
      items: digests.map((d) => item(d.digest_id)),
      limit: RECENT_ALERT_LIMIT,
    });

    expect(result.alerts).toHaveLength(RECENT_ALERT_LIMIT);
    expect(result.hasMore).toBe(true);
    // The cursor is the last row shown, so the next page starts strictly below
    // it and cannot repeat one.
    expect(result.nextBefore).toBe(result.alerts[RECENT_ALERT_LIMIT - 1]?.firedAt);
  });

  it("does not claim there is more when the list is exactly full", () => {
    const digests = Array.from({ length: RECENT_ALERT_LIMIT }, (_, i) =>
      digest(`d${String(i).padStart(2, "0")}`, `2026-09-09T${String(i).padStart(2, "0")}:00:00Z`),
    );
    const result = selectDeliveredAlerts({
      digests,
      deliveries: digests.map((d) => sent(d.digest_id, d.scheduled_for)),
      items: digests.map((d) => item(d.digest_id)),
      limit: RECENT_ALERT_LIMIT,
    });

    expect(result.alerts).toHaveLength(RECENT_ALERT_LIMIT);
    expect(result.hasMore).toBe(false);
    expect(result.nextBefore).toBeNull();
  });

  it("applies one eligibility rule to both limits", () => {
    // The history page differs from the Alerts page in how many rows it keeps
    // and in nothing else. If these ever disagree about WHICH alerts exist, a
    // reader sees an alert in one list that the other denies.
    const digests = [digest("a", "2026-09-09T10:00:00Z"), digest("b", "2026-09-09T09:00:00Z")];
    const deliveries = [
      sent("a", "2026-09-09T10:00:05Z"),
      { digest_id: "b", status: "queued", delivered_at: null },
    ];
    const items = [item("a"), item("b")];

    const recent = selectDeliveredAlerts({ digests, deliveries, items, limit: RECENT_ALERT_LIMIT });
    const history = selectDeliveredAlerts({
      digests,
      deliveries,
      items,
      limit: ALERT_HISTORY_PAGE,
    });

    expect(recent.alerts).toEqual(history.alerts);
  });
});

describe("alert list limits", () => {
  it("reads enough candidates to fill a list past the undelivered ones", () => {
    expect(ALERT_CANDIDATE_FACTOR).toBeGreaterThan(1);
    expect(RECENT_ALERT_LIMIT * ALERT_CANDIDATE_FACTOR).toBeGreaterThan(RECENT_ALERT_LIMIT);
  });

  it("keeps a history page small enough to be worth paging", () => {
    expect(ALERT_HISTORY_PAGE).toBeGreaterThan(0);
    expect(ALERT_HISTORY_PAGE).toBeLessThanOrEqual(50);
  });
});

describe("groupAlertsByMonth", () => {
  function alertAt(id: string, firedAt: string) {
    return { digestId: id, eventId: `event-${id}`, title: id, why: "", at: firedAt, firedAt };
  }

  it("cuts a page into the months its alerts happened in, in order", () => {
    const groups = groupAlertsByMonth(
      [
        alertAt("a", "2026-09-09T10:00:00Z"),
        alertAt("b", "2026-09-01T10:00:00Z"),
        alertAt("c", "2026-08-30T10:00:00Z"),
      ],
      "en-GB",
    );

    expect(groups.map((g) => g.label)).toEqual(["September 2026", "August 2026"]);
    expect(groups[0]?.alerts.map((a) => a.digestId)).toEqual(["a", "b"]);
    expect(groups[1]?.alerts.map((a) => a.digestId)).toEqual(["c"]);
  });

  it("groups nothing into nothing", () => {
    expect(groupAlertsByMonth([])).toEqual([]);
  });
});

describe("isAlertCursor", () => {
  it("accepts the timestamp Postgres actually returns", () => {
    // The regression this exists for: `z.string().datetime()` takes only the Z
    // form, so paging rejected its own cursor and the second page of history
    // failed every single time it was asked for.
    expect(isAlertCursor("2026-09-09T10:00:00.123456+00:00")).toBe(true);
    expect(isAlertCursor("2026-09-09T10:00:00+00:00")).toBe(true);
    expect(isAlertCursor("2026-09-09T10:00:00.123Z")).toBe(true);
  });

  it("rejects anything that is not a time", () => {
    expect(isAlertCursor("")).toBe(false);
    expect(isAlertCursor("yesterday")).toBe(false);
    expect(isAlertCursor("'; drop table digests; --")).toBe(false);
  });
});
