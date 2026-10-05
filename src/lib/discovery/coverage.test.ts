import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  COOLDOWN_HOURS,
  enqueueDiscoveryForTopics,
  followedCustomTopics,
  gapFor,
  MAX_TOPICS_PER_ENQUEUE,
  queueDiscoverySafely,
} from "./coverage";

/**
 * The interesting properties are all decisions, not data: "is there coverage",
 * "is a job already in flight", "is this the same subject two readers followed
 * a minute apart". The fake below therefore answers exactly the four reads the
 * module makes and records the one write, rather than emulating PostgREST.
 */

type Seed = {
  flag?: boolean;
  flagError?: boolean;
  links?: string[];
  jobs?: { topic_id: string; status: string; created_at: string }[];
  followed?: {
    topic_id: string;
    muted?: boolean;
    topics: { id: string; label: string; kind: string } | null;
  }[];
  insertError?: { code?: string; message: string };
};

type Inserted = { topic_id: string; status: string; next_attempt_at: string };

function fakeDb(seed: Seed): { db: SupabaseClient<Database>; inserts: Inserted[] } {
  const inserts: Inserted[] = [];
  const open = new Set(
    (seed.jobs ?? [])
      .filter((job) => job.status === "pending" || job.status === "running")
      .map((job) => job.topic_id),
  );

  const db = {
    from(table: string) {
      if (table === "feature_flags") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                seed.flagError
                  ? { data: null, error: { message: "unreadable" } }
                  : { data: seed.flag === undefined ? null : { enabled: seed.flag }, error: null },
            }),
          }),
        };
      }
      if (table === "source_topics") {
        return {
          select: () => ({
            in: async () => ({
              data: (seed.links ?? []).map((topic_id) => ({ topic_id })),
              error: null,
            }),
          }),
        };
      }
      if (table === "discovery_jobs") {
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({ data: seed.jobs ?? [], error: null }),
              }),
            }),
          }),
          insert: async (row: Inserted) => {
            if (seed.insertError) return { data: null, error: seed.insertError };
            // The partial unique index from 0096, modelled: one open job per
            // topic, whichever invocation gets there first.
            if (open.has(row.topic_id)) {
              return { data: null, error: { code: "23505", message: "duplicate key value" } };
            }
            open.add(row.topic_id);
            inserts.push(row);
            return { data: null, error: null };
          },
        };
      }
      if (table === "user_topics") {
        const read = () => ({
          order: () => ({
            limit: async () => ({ data: seed.followed ?? [], error: null }),
          }),
        });
        return {
          select: () => ({
            // The reader path used to filter on user_topics.muted; 0110 dropped
            // that column, so the real chain has no `eq` any more. Both shapes
            // are accepted here so this fake cannot be the thing that pins the
            // old column in place.
            eq: read,
            ...read(),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { db: db as unknown as SupabaseClient<Database>, inserts };
}

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-25T12:00:00Z");

describe("gapFor", () => {
  const base = { hasSourceLink: false, hasOpenJob: false, lastJobAtMs: null, nowMs: NOW.getTime() };

  it("queues when nothing is mapped and nothing is in flight", () => {
    expect(gapFor(base)).toEqual({ queue: true });
  });

  it("does not queue a covered topic", () => {
    expect(gapFor({ ...base, hasSourceLink: true })).toEqual({ queue: false, reason: "covered" });
  });

  it("does not queue while a job is open", () => {
    expect(gapFor({ ...base, hasOpenJob: true })).toEqual({ queue: false, reason: "in-flight" });
  });

  it("does not queue again inside the cooldown", () => {
    expect(gapFor({ ...base, lastJobAtMs: NOW.getTime() - HOUR })).toEqual({
      queue: false,
      reason: "cooling-down",
    });
  });

  it("queues again once the cooldown has passed", () => {
    const lastJobAtMs = NOW.getTime() - COOLDOWN_HOURS * HOUR;
    expect(gapFor({ ...base, lastJobAtMs })).toEqual({ queue: true });
  });
});

describe("enqueueDiscoveryForTopics", () => {
  const topic = { id: "t1", label: "Rust programming" };

  it("does nothing when the flag is off", async () => {
    const { db, inserts } = fakeDb({ flag: false });
    const result = await enqueueDiscoveryForTopics(db, [topic], { now: NOW });
    expect(result.reason).toBe("disabled");
    expect(inserts).toHaveLength(0);
  });

  it("does nothing when the flag cannot be read", async () => {
    const { db, inserts } = fakeDb({ flagError: true });
    const result = await enqueueDiscoveryForTopics(db, [topic], { now: NOW });
    expect(result.reason).toBe("disabled");
    expect(inserts).toHaveLength(0);
  });

  it("queues one job for an uncovered topic", async () => {
    const { db, inserts } = fakeDb({ flag: true });
    const result = await enqueueDiscoveryForTopics(db, [topic], { now: NOW });
    expect(result.queued).toBe(1);
    expect(inserts).toEqual([
      { topic_id: "t1", status: "pending", next_attempt_at: NOW.toISOString() },
    ]);
  });

  it("skips a topic that already has a mapped source", async () => {
    const { db, inserts } = fakeDb({ flag: true, links: ["t1"] });
    const result = await enqueueDiscoveryForTopics(db, [topic], { now: NOW });
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(inserts).toHaveLength(0);
  });

  it("skips a topic with an open job, and one attempted inside the cooldown", async () => {
    const open = fakeDb({
      flag: true,
      jobs: [{ topic_id: "t1", status: "running", created_at: NOW.toISOString() }],
    });
    expect((await enqueueDiscoveryForTopics(open.db, [topic], { now: NOW })).queued).toBe(0);

    const cooling = fakeDb({
      flag: true,
      jobs: [{ topic_id: "t1", status: "succeeded", created_at: NOW.toISOString() }],
    });
    expect((await enqueueDiscoveryForTopics(cooling.db, [topic], { now: NOW })).queued).toBe(0);

    const stale = fakeDb({
      flag: true,
      jobs: [
        {
          topic_id: "t1",
          status: "succeeded",
          created_at: new Date(NOW.getTime() - 2 * 24 * HOUR).toISOString(),
        },
      ],
    });
    expect((await enqueueDiscoveryForTopics(stale.db, [topic], { now: NOW })).queued).toBe(1);
  });

  it("collapses the same topic followed by two readers into one job", async () => {
    // The unique index is what makes this true under concurrency; here the same
    // topic simply appears twice in one pass, which is the cheap version of the
    // same question.
    const { db, inserts } = fakeDb({ flag: true });
    const result = await enqueueDiscoveryForTopics(
      db,
      [topic, { id: "t1", label: "rust programming" }],
      { now: NOW },
    );
    expect(result.queued).toBe(1);
    expect(result.skipped).toBe(1);
    expect(inserts).toHaveLength(1);
  });

  it("treats the unique-index refusal as in-flight, not as a failure", async () => {
    const { db } = fakeDb({ flag: true, insertError: { code: "23505", message: "duplicate" } });
    const result = await enqueueDiscoveryForTopics(db, [topic], { now: NOW });
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("bounds how many topics one pass can consider", async () => {
    const { db, inserts } = fakeDb({ flag: true });
    const many = Array.from({ length: MAX_TOPICS_PER_ENQUEUE + 3 }, (_, i) => ({
      id: `t${i}`,
      label: `subject ${i}`,
    }));
    const result = await enqueueDiscoveryForTopics(db, many, { now: NOW });
    expect(result.considered).toBe(MAX_TOPICS_PER_ENQUEUE);
    expect(inserts).toHaveLength(MAX_TOPICS_PER_ENQUEUE);
  });
});

describe("queueDiscoverySafely", () => {
  it("never throws, whatever the database does", async () => {
    const exploding = {
      from() {
        throw new Error("database on fire");
      },
    } as unknown as SupabaseClient<Database>;

    await expect(
      queueDiscoverySafely(exploding, [{ id: "t1", label: "Arsenal" }]),
    ).resolves.toBeNull();
  });

  it("is a no-op with nothing to queue", async () => {
    const { db } = fakeDb({ flag: true });
    expect(await queueDiscoverySafely(db, [])).toBeNull();
  });
});

describe("followedCustomTopics", () => {
  it("keeps only custom subjects, deduped, newest read first", async () => {
    const { db } = fakeDb({
      followed: [
        { topic_id: "t1", topics: { id: "t1", label: "Arsenal", kind: "custom" } },
        { topic_id: "t1", topics: { id: "t1", label: "Arsenal", kind: "custom" } },
        { topic_id: "t2", topics: { id: "t2", label: "Technology", kind: "predefined" } },
        { topic_id: "t3", topics: null },
      ],
    });

    expect(await followedCustomTopics(db)).toEqual([{ id: "t1", label: "Arsenal" }]);
  });

  it("propagates a read failure rather than pretending nothing is followed", async () => {
    const broken = {
      from: () => ({
        select: () => ({
          // No `eq` link any more: 0110 dropped user_topics.muted, so the real
          // chain runs select → order → limit.
          order: () => ({
            limit: async () => ({ data: null, error: { message: "nope" } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(followedCustomTopics(broken)).rejects.toThrow("nope");
  });

  it("does not log or expose reader identity", async () => {
    // A soft assertion that the module has no user id in its shape: the read
    // selects no user column, and the returned type carries topic ids only.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = fakeDb({
      followed: [{ topic_id: "t1", topics: { id: "t1", label: "Nepal", kind: "custom" } }],
    });
    const topics = await followedCustomTopics(db);
    expect(JSON.stringify(topics)).not.toMatch(/user/i);
    warn.mockRestore();
  });
});
