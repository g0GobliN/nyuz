import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "@/lib/test-support/fake-db";
import { nextSlot } from "./schedule";

/**
 * The timing contract: a reader's schedule is a delivery deadline.
 *
 * ---------------------------------------------------------------------------
 * What these tests are defending, and against what
 * ---------------------------------------------------------------------------
 *
 * A reader picked 07:30 Asia/Tokyo. Between 3 and 11 September that slot was
 * honoured at +0m, +1m, +15m, +31m, +1h56m and +3h20m, one day's briefing was
 * deferred to 2026-10-01 and never sent, and the one briefing generated on time
 * had its push held twenty minutes behind a claim from a worker that had died.
 *
 * Three separate mechanisms, one shared mistake: `scheduled_for` was treated as
 * the moment work *starts*, so every failure after it moved the reader's
 * morning. The fixes are that generation opens early, that AI enrichment can
 * fail without touching the briefing, and that a delivery claim expires in
 * minutes rather than a quarter hour. These tests are the statements of those
 * three, because none of them is visible in a passing typecheck.
 */

const TOKYO_0730 = "2026-09-10T22:30:00.000Z";

/** Nine minutes before the deadline: inside the generation window, before delivery. */
const BEFORE_DEADLINE = new Date("2026-09-10T22:21:00.000Z");
/** The deadline itself, the instant the reader is owed a briefing. */
const AT_DEADLINE = new Date(TOKYO_0730);

const iso = (base: Date, minutes: number) =>
  new Date(base.getTime() + minutes * 60_000).toISOString();

type Doubles = {
  impactCalls: number;
  emailKeys: string[];
  pushTags: string[];
  failImpactsWith: Error | null;
  /** Fail this many email sends retryably before the first success. */
  failEmailSends: number;
};

/**
 * The digest module with its two paid dependencies and its two send channels
 * replaced. Imported per test because the AI double has to be installed before
 * the module graph is built.
 */
async function load(doubles: Doubles) {
  vi.doMock("@/lib/ai/config", async () => {
    const actual = await vi.importActual<typeof import("../ai/config")>("@/lib/ai/config");
    return {
      ...actual,
      completeRoutedJson: async () => {
        doubles.impactCalls += 1;
        if (doubles.failImpactsWith) throw doubles.failImpactsWith;
        return {
          data: { items: [{ event_id: "event-1", why_it_matters: "It changes the rules." }] },
          usage: {
            content: "{}",
            model: "deepseek-v4-pro",
            promptTokens: 40,
            completionTokens: 10,
            reasoningTokens: 0,
            cachedTokens: 0,
            attempt_count: 1,
          },
          route: { capability: "digest", model: "deepseek-v4-pro" },
        };
      },
    };
  });

  vi.doMock("@/lib/server/email/send", async () => {
    const actual =
      await vi.importActual<typeof import("../server/email/send")>("@/lib/server/email/send");
    return {
      ...actual,
      sendEmail: async (input: { idempotencyKey?: string }) => {
        doubles.emailKeys.push(input.idempotencyKey ?? "(none)");
        if (doubles.failEmailSends > 0) {
          doubles.failEmailSends -= 1;
          return { ok: false as const, error: "provider 503", retryable: true as const };
        }
        return { ok: true as const, id: "resend-1" };
      },
    };
  });

  vi.doMock("@/lib/server/email/unsubscribe", () => ({
    unsubscribeUrl: async () => "https://nyuz.test/unsubscribe?t=token",
  }));

  vi.doMock("@/lib/server/push/send", () => ({
    sendStoryPushes: async (input: { stories: { tag: string }[] }) => {
      for (const story of input.stories) doubles.pushTags.push(story.tag);
      return { ok: true as const, dropIds: [] };
    },
  }));

  vi.doMock("./translate", () => ({
    translateEvents: async () => ({ byEventId: new Map(), cacheHits: 0, generated: 0, tokens: 0 }),
  }));

  return import("./digest");
}

function doubles(): Doubles {
  return {
    impactCalls: 0,
    emailKeys: [],
    pushTags: [],
    failImpactsWith: null,
    failEmailSends: 0,
  };
}

/** The origin `siteUrl` builds story links from. */
const SEND_ENV = { email: { VITE_SITE_URL: "https://nyuz.app" } } as const;

/**
 * The column defaults Postgres applies to a freshly queued delivery.
 *
 * `queueDeliveries` inserts `(digest_id, channel, status)` and lets the table
 * supply `attempts = 0` and `next_attempt_at = null`. FakeDb deliberately does
 * not model defaults — it stores exactly what it was given — so without this
 * the rows it creates are invisible to `deliverDue`'s `attempts < MAX_ATTEMPTS`
 * filter and every delivery assertion below would pass vacuously.
 */
function applyDeliveryDefaults(db: FakeDb): void {
  for (const row of db.rows("deliveries")) {
    // `id` is a generated primary key. Without one every row answers to
    // `.eq("id", undefined)` and a single mark would settle the whole table.
    row["id"] ??= `${String(row["digest_id"])}:${String(row["channel"])}`;
    row["attempts"] ??= 0;
    row["next_attempt_at"] ??= null;
    row["processing_started_at"] ??= null;
  }
}

/**
 * One reader, 07:30 Asia/Tokyo, one matched story ninety minutes old.
 *
 * `impact` decides whether the story's shared explanation exists yet — the
 * single lever these tests pull to ask "does missing enrichment move the
 * briefing".
 */
function tables(over: { impact?: Row | null; digest?: Row } = {}): Record<string, Row[]> {
  const matchedAt = iso(AT_DEADLINE, -120);
  return {
    notification_preferences: [
      {
        user_id: "reader-1",
        send_at: "07:30:00",
        timezone: "Asia/Tokyo",
        days: [1, 2, 3, 4, 5, 6, 7],
        channels: ["email", "push"],
        frequency: "daily",
        density: 35,
        paused: false,
        instructions: "",
        language: "en",
      },
    ],
    digests: [
      {
        digest_id: "digest-1",
        user_id: "reader-1",
        scheduled_for: TOKYO_0730,
        status: "scheduled",
        kind: "briefing",
        generated_at: null,
        generation_deferred_until: null,
        generation_attempts: 0,
        item_count: 0,
        ...over.digest,
      },
    ],
    user_events: [
      {
        user_id: "reader-1",
        event_id: "event-1",
        relevance: 0.9,
        matched_at: matchedAt,
        briefed_at: null,
        expired_at: null,
        events: { first_seen_at: matchedAt, importance: 7, novelty: 6 },
      },
    ],
    events: [
      {
        id: "event-1",
        title: "A story the reader was matched to",
        what_happened: "It happened overnight.",
        before_state: null,
        after_state: null,
        importance: 7,
        novelty: 6,
        first_seen_at: matchedAt,
      },
    ],
    event_topics: [],
    event_impacts:
      over.impact === null
        ? []
        : [
            over.impact ?? {
              event_id: "event-1",
              status: "complete",
              text: "It changes the rules.",
              updated_at: matchedAt,
              deferred_until: null,
            },
          ],
    digest_items: [],
    articles: [],
    subscriptions: [{ user_id: "reader-1", plan: "uno" }],
    profiles: [{ id: "reader-1", email: "reader@example.test", name: "Reader" }],
    telegram_accounts: [],
    push_subscriptions: [
      {
        id: "device-1",
        user_id: "reader-1",
        endpoint: "https://push.example/device-1",
        p256dh: "key",
        auth: "auth",
      },
    ],
    deliveries: [],
    feature_flags: [{ key: "story_translation_enabled", enabled: false }],
  };
}

/**
 * `claim_delivery` as 0045 defines it, including the lease the caller asks for.
 *
 * Modelled rather than stubbed true, because the lease length is precisely what
 * the reclaim test is about — a handler that always claimed would make that
 * test pass no matter how long a dead worker held the row.
 */
function claimDelivery(db: FakeDb, now: () => Date) {
  return (args: Record<string, unknown>) => {
    const row = db.rows("deliveries").find((r) => r["id"] === args["p_id"]);
    if (!row || row["status"] !== "queued") return false;
    const lease = Math.max(1, Number(args["p_lease_minutes"] ?? 10));
    const held = row["processing_started_at"];
    if (typeof held === "string") {
      const expires = Date.parse(held) + lease * 60_000;
      if (expires > now().getTime()) return false;
    }
    row["processing_started_at"] = now().toISOString();
    row["claimed_at"] = now().toISOString();
    return true;
  };
}

/**
 * `mark_delivery_attempt`, the other half of the claim.
 *
 * Modelled for the same reason: a test that stubbed this away could not tell a
 * worker that died holding a row from one that died mid-send, which is the
 * distinction the function exists to record.
 */
function markDeliveryAttempt(db: FakeDb, now: () => Date) {
  return (args: Record<string, unknown>) => {
    const row = db.rows("deliveries").find((r) => r["id"] === args["p_id"]);
    if (!row) return undefined;
    row["first_attempt_at"] ??= now().toISOString();
    row["last_attempt_at"] = now().toISOString();
    return undefined;
  };
}

beforeEach(() => {
  vi.resetModules();
});

/* ------------------------------------------------------------------ */
/* 1. The slot itself                                                  */
/* ------------------------------------------------------------------ */

describe("the reader's clock time becomes the right instant", () => {
  it("turns 07:30 Asia/Tokyo into 22:30 UTC the day before", () => {
    const slot = nextSlot(
      {
        sendAt: "07:30:00",
        timezone: "Asia/Tokyo",
        days: [1, 2, 3, 4, 5, 6, 7],
        frequency: "daily",
      },
      new Date("2026-09-10T12:00:00Z"),
    );

    expect(slot?.toISOString()).toBe(TOKYO_0730);
  });

  it("keeps 07:30 local across a DST transition in a zone that has one", () => {
    // Asia/Tokyo has no DST, so a zone that does is what proves the arithmetic
    // is a zone lookup and not a fixed offset. 07:30 in New York is 11:30Z in
    // daylight time and 12:30Z in standard time.
    const days = [1, 2, 3, 4, 5, 6, 7];
    const summer = nextSlot(
      { sendAt: "07:30", timezone: "America/New_York", days, frequency: "daily" },
      new Date("2026-07-01T00:00:00Z"),
    );
    const winter = nextSlot(
      { sendAt: "07:30", timezone: "America/New_York", days, frequency: "daily" },
      new Date("2026-12-01T00:00:00Z"),
    );

    expect(summer?.toISOString()).toBe("2026-07-01T11:30:00.000Z");
    expect(winter?.toISOString()).toBe("2026-12-01T12:30:00.000Z");
  });
});

/* ------------------------------------------------------------------ */
/* 2. AI failure must not move the deadline                            */
/* ------------------------------------------------------------------ */

describe("a model that will not answer costs the sentence, not the slot", () => {
  const cases: { name: string; error: Error }[] = [
    { name: "a 429", error: Object.assign(new Error("Too Many Requests"), { status: 429 }) },
    { name: "a 503", error: Object.assign(new Error("upstream unavailable"), { status: 503 }) },
    { name: "a provider timeout", error: new Error("fetch failed: timed out") },
  ];

  for (const { name, error } of cases) {
    it(`ships the briefing anyway when impact generation fails with ${name}`, async () => {
      const d = doubles();
      d.failImpactsWith = error;
      const { digest } = await load(d);
      const db = new FakeDb(tables({ impact: null }));

      const report = await digest(db as never, { now: AT_DEADLINE, skipSend: true });

      const row = db.rows("digests")[0];
      expect(report.generated).toBe(1);
      expect(row?.["status"]).toBe("ready");
      // The deadline is untouched, and no retry window was opened behind it.
      expect(row?.["scheduled_for"]).toBe(TOKYO_0730);
      expect(row?.["generation_deferred_until"]).toBeNull();
      // The story is in the briefing; only its shared explanation is missing.
      expect(db.rows("digest_items")).toHaveLength(1);
      expect(db.rows("digest_items")[0]?.["why_it_matters"]).toBe("");
    });
  }

  it("never parks a daily briefing in another month when the budget is exhausted", async () => {
    const { AiBudgetExceededError } = await import("@/lib/ai/config");
    const d = doubles();
    d.failImpactsWith = new AiBudgetExceededError();
    const { digest } = await load(d);
    const db = new FakeDb(tables({ impact: null }));

    const report = await digest(db as never, { now: AT_DEADLINE, skipSend: true });

    const row = db.rows("digests")[0];
    expect(report.generated).toBe(1);
    expect(row?.["status"]).toBe("ready");
    expect(row?.["scheduled_for"]).toBe(TOKYO_0730);
    // The bug this replaces wrote 2026-10-01T00:05:00Z here and sent nothing.
    expect(row?.["generation_deferred_until"]).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3. Missing enrichment does not block                                */
/* ------------------------------------------------------------------ */

describe("a shared explanation being written elsewhere does not empty the briefing", () => {
  it("briefs the story without its explanation rather than skipping the day", async () => {
    const d = doubles();
    const { digest } = await load(d);
    // 'generating' is held by another worker: resolveImpacts will not claim it,
    // and before this change the briefing went out with zero stories.
    const db = new FakeDb(
      tables({
        impact: {
          event_id: "event-1",
          status: "generating",
          text: null,
          updated_at: iso(AT_DEADLINE, -5),
          deferred_until: null,
        },
      }),
    );

    const report = await digest(db as never, { now: AT_DEADLINE, skipSend: true });

    expect(d.impactCalls).toBe(0);
    expect(report.generated).toBe(1);
    expect(report.skipped).toBe(0);
    expect(db.rows("digests")[0]?.["status"]).toBe("ready");
    expect(db.rows("digest_items")).toHaveLength(1);
    expect(db.rows("digest_items")[0]?.["why_it_matters"]).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Generation runs early; delivery waits for the deadline           */
/* ------------------------------------------------------------------ */

describe("generation is allowed to run ahead of the deadline; delivery is not", () => {
  it("generates before 07:30 but sends nothing until 07:30", async () => {
    const d = doubles();
    const { digest } = await load(d);
    const db = new FakeDb(tables());
    db.rpcs["claim_delivery"] = claimDelivery(db, () => BEFORE_DEADLINE);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => BEFORE_DEADLINE);

    const report = await digest(db as never, { now: BEFORE_DEADLINE, ...SEND_ENV });

    // Prepared ahead of time...
    expect(report.generated).toBe(1);
    expect(db.rows("digests")[0]?.["status"]).toBe("ready");
    // ...and not a single thing sent, because the reader asked for 07:30.
    expect(report.sent).toBe(0);
    expect(d.emailKeys).toEqual([]);
    expect(d.pushTags).toEqual([]);
    expect(db.rows("deliveries").every((r) => r["status"] === "queued")).toBe(true);
  });

  it("sends the prepared briefing once the deadline arrives", async () => {
    const d = doubles();
    const { digest } = await load(d);
    const db = new FakeDb(tables());
    db.rpcs["claim_delivery"] = claimDelivery(db, () => AT_DEADLINE);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => AT_DEADLINE);

    await digest(db as never, { now: BEFORE_DEADLINE, ...SEND_ENV });
    applyDeliveryDefaults(db);
    const report = await digest(db as never, { now: AT_DEADLINE, ...SEND_ENV });

    expect(report.sent).toBe(2);
    expect(d.emailKeys).toEqual(["digest:digest-1:email"]);
    expect(d.pushTags).toEqual(["digest-1"]);
  });

  it("sends on a tick that fires a second early rather than waiting a whole one", async () => {
    const d = doubles();
    const { digest } = await load(d);
    const db = new FakeDb(tables());
    // Cloudflare hands the 07:30:00 trigger to the Worker at 07:29:59. Read
    // strictly, that is "not due yet", and the reader waits for the next tick
    // for the sake of one second — which is how a minute-resolution schedule
    // still produces minutes of lateness.
    const aSecondEarly = new Date(AT_DEADLINE.getTime() - 1_000);
    db.rpcs["claim_delivery"] = claimDelivery(db, () => aSecondEarly);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => aSecondEarly);

    await digest(db as never, { now: BEFORE_DEADLINE, ...SEND_ENV });
    applyDeliveryDefaults(db);
    const report = await digest(db as never, { now: aSecondEarly, ...SEND_ENV });

    expect(report.sent).toBe(2);
  });

  it("still refuses to send a minute early", async () => {
    const d = doubles();
    const { digest } = await load(d);
    const db = new FakeDb(tables());
    // The grace absorbs tick jitter and nothing else. A minute is not jitter —
    // it is a briefing arriving before the reader asked for it.
    const aMinuteEarly = new Date(AT_DEADLINE.getTime() - 60_000);
    db.rpcs["claim_delivery"] = claimDelivery(db, () => aMinuteEarly);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => aMinuteEarly);

    await digest(db as never, { now: BEFORE_DEADLINE, ...SEND_ENV });
    applyDeliveryDefaults(db);
    const report = await digest(db as never, { now: aMinuteEarly, ...SEND_ENV });

    expect(report.sent).toBe(0);
    expect(d.emailKeys).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. A dead delivery worker is reclaimed in minutes                   */
/* ------------------------------------------------------------------ */

describe("a claim from a worker that died does not hold the briefing", () => {
  it("claims scheduled deliveries under a short lease", async () => {
    const d = doubles();
    const { digest, flushDeliveries } = await load(d);
    const db = new FakeDb(tables());
    db.rpcs["claim_delivery"] = claimDelivery(db, () => AT_DEADLINE);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => AT_DEADLINE);

    await digest(db as never, { now: AT_DEADLINE, ...SEND_ENV, skipSend: true });
    applyDeliveryDefaults(db);
    await flushDeliveries(db as never, { now: AT_DEADLINE, ...SEND_ENV });

    const leases = db.rpcCalls
      .filter((c) => c.fn === "claim_delivery")
      .map((c) => c.args["p_lease_minutes"]);
    expect(leases.length).toBeGreaterThan(0);
    // Fifteen was the old value, and fifteen is how an on-time briefing was
    // delivered twenty minutes late.
    expect(new Set(leases)).toEqual(new Set([2]));
  });

  it("reclaims a stranded delivery three minutes later, not fifteen", async () => {
    const d = doubles();
    const { flushDeliveries } = await load(d);
    const db = new FakeDb({
      ...tables(),
      digests: [
        {
          digest_id: "digest-1",
          user_id: "reader-1",
          scheduled_for: TOKYO_0730,
          status: "ready",
          kind: "briefing",
          item_count: 1,
        },
      ],
      digest_items: [
        {
          digest_id: "digest-1",
          event_id: "event-1",
          position: 0,
          why_it_matters: "",
          events: {
            title: "A story the reader was matched to",
            what_happened: "It happened overnight.",
            before_state: null,
            after_state: null,
          },
        },
      ],
      deliveries: [
        {
          id: "stranded",
          digest_id: "digest-1",
          channel: "push",
          status: "queued",
          attempts: 0,
          next_attempt_at: null,
          // Claimed at the deadline by a worker that never came back. It died
          // before reaching the provider, which is why the attempt stamps are
          // still null: claiming is not attempting.
          processing_started_at: TOKYO_0730,
          claimed_at: TOKYO_0730,
          first_attempt_at: null,
          last_attempt_at: null,
        },
      ],
    });
    const threeLater = new Date(AT_DEADLINE.getTime() + 3 * 60_000);
    db.rpcs["claim_delivery"] = claimDelivery(db, () => threeLater);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => threeLater);

    const report = await flushDeliveries(db as never, { now: threeLater, ...SEND_ENV });

    expect(report.sent).toBe(1);
    expect(db.rows("deliveries")[0]?.["status"]).toBe("sent");
  });

  it("records the claim and the send as separate instants", async () => {
    const d = doubles();
    const { digest, flushDeliveries } = await load(d);
    const db = new FakeDb(tables());
    const claimAt = AT_DEADLINE;
    const sendAt = new Date(AT_DEADLINE.getTime() + 4_000);
    db.rpcs["claim_delivery"] = claimDelivery(db, () => claimAt);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => sendAt);

    await digest(db as never, { now: AT_DEADLINE, ...SEND_ENV, skipSend: true });
    applyDeliveryDefaults(db);
    await flushDeliveries(db as never, { now: AT_DEADLINE, ...SEND_ENV });

    const row = db.rows("deliveries")[0];
    // The whole point of the split: a worker that claims a briefing and dies on
    // the way to the provider leaves claimed_at set and first_attempt_at null.
    // If the claim stamped both, that worker would be indistinguishable from
    // one that actually called Resend and may have sent the briefing twice.
    expect(row?.["claimed_at"]).toBe(claimAt.toISOString());
    expect(row?.["first_attempt_at"]).toBe(sendAt.toISOString());
    expect(row?.["last_attempt_at"]).toBe(sendAt.toISOString());

    // And the claim survives the lease being released on completion, which is
    // what `processing_started_at` alone could not do.
    expect(row?.["processing_started_at"]).toBeNull();
    expect(row?.["status"]).toBe("sent");
  });
});

/* ------------------------------------------------------------------ */
/* 5b. A crashed generation recovers before the deadline               */
/* ------------------------------------------------------------------ */

describe("a generation claim from a worker that died is retaken before the deadline", () => {
  it("retakes a claim made five minutes ago and still delivers on time", async () => {
    const d = doubles();
    const { digest, flushDeliveries } = await load(d);
    // Claimed at T-10 by the early pass, then nothing. The reader is not owed
    // anything yet, and the whole point of the head start is that this is
    // recoverable rather than terminal.
    const db = new FakeDb(
      tables({
        digest: {
          status: "generating",
          generated_at: null,
          generation_started_at: iso(AT_DEADLINE, -10),
        },
      }),
    );
    db.rpcs["claim_delivery"] = claimDelivery(db, () => AT_DEADLINE);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => AT_DEADLINE);

    const report = await digest(db as never, { now: AT_DEADLINE, ...SEND_ENV, skipSend: true });

    expect(report.generated).toBe(1);
    expect(db.rows("digests")[0]?.["scheduled_for"]).toBe(TOKYO_0730);
    expect(db.rows("digest_items")).toHaveLength(1);

    // And it goes out on the deadline it was always owed on. (The send is
    // flushed explicitly rather than inline because FakeDb does not generate
    // the `id` and `attempts` defaults a freshly queued row gets in Postgres —
    // see `applyDeliveryDefaults`.)
    applyDeliveryDefaults(db);
    const delivery = await flushDeliveries(db as never, { now: AT_DEADLINE, ...SEND_ENV });
    expect(delivery.sent).toBe(2);
  });

  it("leaves a claim made moments ago alone", async () => {
    const d = doubles();
    const { digest } = await load(d);
    const db = new FakeDb(
      tables({
        digest: {
          status: "generating",
          generated_at: null,
          generation_started_at: iso(AT_DEADLINE, -1),
        },
      }),
    );

    const report = await digest(db as never, { now: AT_DEADLINE, skipSend: true });

    // A live worker is still holding it; two workers generating one briefing is
    // how a reader gets it twice.
    expect(report.generated).toBe(0);
    expect(db.rows("digest_items")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Retries are idempotent, and never move the deadline              */
/* ------------------------------------------------------------------ */

describe("retrying does not duplicate the send or move the promise", () => {
  it("retries a failed send under the same idempotency key", async () => {
    const d = doubles();
    d.failEmailSends = 1;
    const { digest, flushDeliveries } = await load(d);
    const db = new FakeDb(tables());
    db.rpcs["claim_delivery"] = claimDelivery(db, () => AT_DEADLINE);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => AT_DEADLINE);

    await digest(db as never, { now: AT_DEADLINE, ...SEND_ENV, skipSend: true });
    applyDeliveryDefaults(db);

    // First pass: the provider 503s, so the row is re-queued rather than lost.
    await flushDeliveries(db as never, { now: AT_DEADLINE, ...SEND_ENV });
    const email = () => db.rows("deliveries").find((r) => r["channel"] === "email");
    expect(email()?.["status"]).toBe("queued");
    expect(email()?.["attempts"]).toBe(1);

    // Second pass, once the backoff has elapsed.
    const later = new Date(AT_DEADLINE.getTime() + 90 * 60_000);
    db.rpcs["claim_delivery"] = claimDelivery(db, () => later);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => later);
    const report = await flushDeliveries(db as never, { now: later, ...SEND_ENV });

    expect(report.sent).toBe(1);
    expect(email()?.["status"]).toBe("sent");
    // Both attempts carried the key Resend dedupes on, so a first send whose
    // response was merely lost does not land in the inbox twice.
    expect(d.emailKeys).toEqual(["digest:digest-1:email", "digest:digest-1:email"]);
    // The deadline is untouched by any of it.
    expect(db.rows("digests")[0]?.["scheduled_for"]).toBe(TOKYO_0730);
  });

  it("refuses to send a digest that has already been delivered", async () => {
    const d = doubles();
    const { digest, flushDeliveries } = await load(d);
    const db = new FakeDb(tables());
    db.rpcs["claim_delivery"] = claimDelivery(db, () => AT_DEADLINE);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => AT_DEADLINE);

    await digest(db as never, { now: AT_DEADLINE, ...SEND_ENV, skipSend: true });
    applyDeliveryDefaults(db);
    await flushDeliveries(db as never, { now: AT_DEADLINE, ...SEND_ENV });
    expect(d.emailKeys).toHaveLength(1);
    expect(d.pushTags).toEqual(["digest-1"]);

    // Re-queue every row, as a worker that died after sending would leave them,
    // and sweep again. The digest is `sent`, so nothing goes out a second time.
    for (const row of db.rows("deliveries")) {
      row["status"] = "queued";
      row["processing_started_at"] = null;
      row["next_attempt_at"] = null;
    }
    const later = new Date(AT_DEADLINE.getTime() + 3 * 60_000);
    db.rpcs["claim_delivery"] = claimDelivery(db, () => later);
    db.rpcs["mark_delivery_attempt"] = markDeliveryAttempt(db, () => later);
    const report = await flushDeliveries(db as never, { now: later, ...SEND_ENV });

    expect(report.sent).toBe(0);
    expect(d.emailKeys).toHaveLength(1);
    expect(d.pushTags).toEqual(["digest-1"]);
  });

  it("keeps scheduled_for and retries on the next tick when generation genuinely fails", async () => {
    const d = doubles();
    const { digest } = await load(d);
    const db = new FakeDb(tables());
    // The one failure a briefing cannot degrade past: its items will not write.
    // PostgREST reports that as a resolved `{ error }`, not a throw.
    const original = db.from.bind(db);
    db.from = ((table: string) => {
      const q = original(table);
      if (table !== "digest_items") return q;
      // Only the write fails. `alreadyBriefed` reads this same table on the way
      // in, and failing that instead would prove something else entirely.
      const upsert = q.upsert.bind(q);
      q.upsert = ((...args: Parameters<typeof upsert>) => {
        upsert(...args);
        return Object.assign(
          Promise.resolve({ data: null, error: { message: "deadlock" }, count: null }),
          q,
        ) as unknown as ReturnType<typeof upsert>;
      }) as typeof q.upsert;
      return q;
    }) as typeof db.from;

    const report = await digest(db as never, { now: AT_DEADLINE, skipSend: true });

    const row = db.rows("digests")[0];
    expect(report.generated).toBe(0);
    // Back in the queue for the next five-minute tick — not deferred, and above
    // all not rescheduled.
    expect(row?.["status"]).toBe("scheduled");
    expect(row?.["scheduled_for"]).toBe(TOKYO_0730);
    expect(row?.["generation_attempts"]).toBe(1);
    expect(row?.["generation_deferred_until"]).toBeNull();
    expect(row?.["generated_at"]).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 7. A slot whose moment has passed is closed, not sent late          */
/* ------------------------------------------------------------------ */

describe("a briefing far past its slot is abandoned rather than delivered as a surprise", () => {
  it("closes the slot and leaves its stories for the next briefing", async () => {
    const d = doubles();
    const { digest } = await load(d);
    const db = new FakeDb(tables());
    const wayLate = new Date(AT_DEADLINE.getTime() + 4 * 60 * 60_000);

    const report = await digest(db as never, { now: wayLate, skipSend: true });

    const row = db.rows("digests").find((r) => r["digest_id"] === "digest-1");
    expect(report.expired).toBe(1);
    expect(row?.["status"]).toBe("failed");
    expect(row?.["scheduled_for"]).toBe(TOKYO_0730);
    expect(String(row?.["generation_failure_reason"])).toContain("missed slot");
    // Nothing was briefed, so the story is still owed to the reader.
    expect(db.rows("digest_items")).toHaveLength(0);
    expect(db.rows("user_events")[0]?.["briefed_at"]).toBeNull();
  });
});
