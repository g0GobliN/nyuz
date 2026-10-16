import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, asDb } from "@/lib/test-support/fake-db";

const { sendStoryPushes, sendEmail } = vi.hoisted(() => ({
  sendStoryPushes: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/server/push/send", () => ({ sendStoryPushes }));

vi.mock("@/lib/server/email/send", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/server/email/send")>("@/lib/server/email/send");
  return { ...actual, sendEmail };
});

import { flushDeliveries } from "./digest";

describe("scheduled delivery isolation", () => {
  beforeEach(() => {
    sendStoryPushes.mockReset();
    sendStoryPushes.mockResolvedValue({ ok: true, dropIds: [] });
  });

  it("releases a broken delivery and continues to the next notification", async () => {
    const db = new FakeDb(
      {
        deliveries: [
          {
            id: "broken-delivery",
            digest_id: "missing-digest",
            channel: "push",
            status: "queued",
            attempts: 0,
            next_attempt_at: null,
          },
          {
            id: "due-delivery",
            digest_id: "due-digest",
            channel: "push",
            status: "queued",
            attempts: 0,
            next_attempt_at: null,
          },
        ],
        digests: [
          {
            digest_id: "due-digest",
            user_id: "reader-1",
            scheduled_for: "2026-09-10T22:30:00Z",
            status: "ready",
            item_count: 1,
            kind: "briefing",
          },
        ],
        notification_preferences: [{ user_id: "reader-1", language: "en", timezone: "Asia/Tokyo" }],
        digest_items: [
          {
            digest_id: "due-digest",
            event_id: "event-1",
            position: 0,
            why_it_matters: "This changes the rules.",
            events: {
              title: "A timely story",
              what_happened: "Something happened.",
              before_state: null,
              after_state: null,
            },
          },
        ],
        articles: [],
        registered_devices: [
          { user_id: "reader-1", install_id: "install-1", first_seen: "2026-01-01" },
        ],
        push_subscriptions: [
          {
            id: "device-1",
            install_id: "install-1",
            user_id: "reader-1",
            endpoint: "https://push.example/device-1",
            p256dh: "key",
            auth: "auth",
          },
        ],
      },
      { claim_delivery: () => true, mark_delivery_attempt: () => undefined },
    );

    const report = await flushDeliveries(asDb(db), {
      email: { VITE_SITE_URL: "https://nyuz.app" },
    });

    expect(report).toMatchObject({ sent: 1, retried: 1 });
    expect(db.rows("deliveries")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "broken-delivery",
          status: "queued",
          attempts: 1,
          processing_started_at: null,
          next_attempt_at: expect.any(String),
        }),
        expect.objectContaining({ id: "due-delivery", status: "sent", attempts: 1 }),
      ]),
    );
    expect(sendStoryPushes).toHaveBeenCalledOnce();
  });
});

/**
 * The email body reads through the delivery seam, so a stored artifact is what the
 * reader's inbox carries instead of the refused line it was composed for.
 *
 * This is the email half of the ruling's "read at the delivery join" contract, at the
 * point the message is actually built (`loadMailItems` -> `mailGrafs`), which is the
 * one row of its checkpoint table the suite could not otherwise assert: the rule is
 * unit-tested in reader-summary.test.ts, this pins the wiring.
 */
describe("the emailed body of a digest whose stored line was refused", () => {
  const ARTIFACT =
    "OpenAI released a reasoning model this morning, published alongside API documentation and a pricing page, according to The Verge.";
  const REFUSED_RAW =
    "Explore more than 20 announcements from OpenAI DevDay 2026 and see what we are building next.";

  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ ok: true });
  });

  it("prints the composed artifact and never the refused stored line", async () => {
    const db = new FakeDb(
      {
        deliveries: [
          {
            id: "mail-delivery",
            digest_id: "mail-digest",
            channel: "email",
            status: "queued",
            attempts: 0,
            next_attempt_at: null,
          },
        ],
        digests: [
          {
            digest_id: "mail-digest",
            user_id: "reader-1",
            // In the past on purpose: a slot still ahead is not sent yet.
            scheduled_for: "2026-10-15T05:30:00Z",
            status: "ready",
            item_count: 1,
            kind: "briefing",
          },
        ],
        notification_preferences: [{ user_id: "reader-1", language: "en", timezone: "UTC" }],
        profiles: [{ id: "reader-1", email: "reader@example.com", display_name: "Reader" }],
        digest_items: [
          {
            digest_id: "mail-digest",
            event_id: "event-1",
            position: 0,
            why_it_matters: "The lab's pricing change resets what rivals can charge.",
            // The artifact the build stored (0118), beside the revision it came from.
            summary: ARTIFACT,
            delivered_revision: 3,
            events: {
              title: "OpenAI ships a reasoning model",
              what_happened: REFUSED_RAW,
              before_state: null,
              after_state: null,
            },
          },
        ],
        articles: [],
        registered_devices: [],
        push_subscriptions: [],
      },
      { claim_delivery: () => true, mark_delivery_attempt: () => undefined },
    );

    const report = await flushDeliveries(asDb(db), {
      email: {
        VITE_SITE_URL: "https://nyuz.app",
        // The unsubscribe link is built before the message is (unsubscribe.ts requires this).
        EMAIL_UNSUBSCRIBE_SECRET: "test-secret-that-is-at-least-32-chars",
      },
    });

    expect(report.sent).toBe(1);
    expect(sendEmail).toHaveBeenCalledOnce();
    const message = sendEmail.mock.calls[0]?.[0]?.message as { text: string; html: string };
    expect(message.text).toContain(ARTIFACT);
    expect(message.text).not.toContain(REFUSED_RAW);
    expect(message.html).toContain(ARTIFACT);
    expect(message.html).not.toContain(REFUSED_RAW);
  });
});

describe("a digest no leg can deliver", () => {
  const digestRow = {
    digest_id: "doomed-digest",
    user_id: "reader-1",
    scheduled_for: "2026-09-10T22:30:00Z",
    status: "ready",
    item_count: 25,
    kind: "briefing",
  };
  const baseTables = () => ({
    digests: [{ ...digestRow }],
    notification_preferences: [{ user_id: "reader-1", language: "en", timezone: "Asia/Tokyo" }],
    digest_items: [
      {
        digest_id: "doomed-digest",
        event_id: "event-1",
        position: 0,
        why_it_matters: "This changes the rules.",
        events: {
          title: "A timely story",
          what_happened: "Something happened.",
          before_state: null,
          after_state: null,
        },
      },
    ],
    articles: [],
  });
  const run = (tables: Record<string, Record<string, unknown>[]>) => {
    const db = new FakeDb(tables, {
      claim_delivery: () => true,
      mark_delivery_attempt: () => undefined,
    });
    return flushDeliveries(asDb(db), {
      email: { VITE_SITE_URL: "https://nyuz.app" },
    }).then((report) => ({ db, report }));
  };

  it("fails the digest at send time instead of leaving it ready for the sweeper", async () => {
    // Push has no subscription (terminal) and Telegram is not on Uno
    // (terminal): nothing is queued afterwards, nothing was sent.
    const { db } = await run({
      ...baseTables(),
      deliveries: [
        {
          id: "push-leg",
          digest_id: "doomed-digest",
          channel: "push",
          status: "queued",
          attempts: 0,
          next_attempt_at: null,
        },
        {
          id: "telegram-leg",
          digest_id: "doomed-digest",
          channel: "telegram",
          status: "queued",
          attempts: 0,
          next_attempt_at: null,
        },
      ],
    });

    expect(db.rows("deliveries").every((r) => r["status"] === "failed")).toBe(true);
    const digest = db.rows("digests")[0];
    expect(digest?.["status"]).toBe("failed");
    expect(String(digest?.["generation_failure_reason"])).toContain("all deliveries failed");
  });

  it("still marks the digest sent when one leg succeeds and the other is terminally excluded", async () => {
    const { db } = await run({
      ...baseTables(),
      deliveries: [
        {
          id: "push-leg",
          digest_id: "doomed-digest",
          channel: "push",
          status: "queued",
          attempts: 0,
          next_attempt_at: null,
        },
        {
          id: "telegram-leg",
          digest_id: "doomed-digest",
          channel: "telegram",
          status: "queued",
          attempts: 0,
          next_attempt_at: null,
        },
      ],
      registered_devices: [
        { user_id: "reader-1", install_id: "install-1", first_seen: "2026-01-01" },
      ],
      push_subscriptions: [
        {
          id: "device-1",
          install_id: "install-1",
          user_id: "reader-1",
          endpoint: "https://push.example/device-1",
          p256dh: "key",
          auth: "auth",
        },
      ],
    });

    expect(db.rows("digests")[0]?.["status"]).toBe("sent");
  });
});
