import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCandidates, type Candidate, type MatchOptions } from "./match";
import type { Database } from "@/lib/supabase/types";
import { asDb, FakeDb, type Row } from "@/lib/test-support/fake-db";
import { MAX_WEEKLY_AGE_HOURS } from "./freshness";

/**
 * The 0116 differential: the batched bundle against the implementation it
 * replaced, over the same tables.
 *
 * `loadCandidatesLegacy` below is the pre-bundle loader verbatim -- the two
 * lanes, the merge, the recency filter, the ordering, the cap, the per-chunk
 * link reads -- frozen as the oracle. It runs against `FakeDb`, which is
 * exactly where the old code ran in every lifecycle test. The SQL text itself
 * is proven separately: `schema-migrations.test.ts` executes
 * `match_candidate_bundle` on PGlite against the old lane predicates
 * transcribed in SQL.
 *
 * What this file therefore proves is the other half of the seam: that the
 * application maps one bundle row to the candidate the chunked reads used to
 * assemble. If the mapping drifts -- a dropped link rule, a reordered gate --
 * the two disagree here.
 *
 * One deliberate asymmetry, documented not hidden: link *order* inside a
 * candidate. The old chunk reads had no ORDER BY, so their order was whatever
 * the table scan produced; the RPC orders links deterministically by
 * slug/name. Every consumer is order-independent (`some`/`every`/`filter`,
 * evidence-building maps), so the emulator below preserves table order to
 * keep the comparison exact, and the PGlite test compares links as sets.
 */

const NOW = new Date("2026-09-26T09:00:00Z");
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const S1 = "33333333-3333-4333-8333-333333333333";
const S2 = "44444444-4444-4434-8444-444444444444";

const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function seedDb(): FakeDb {
  const event = (id: string, over: Row = {}): Row => ({
    id,
    title: `event ${id.slice(0, 4)}`,
    what_happened: `what happened ${id.slice(0, 4)}`,
    importance: 5,
    novelty: 3,
    tags: ["politics"],
    status: "complete",
    analysed_at: NOW.toISOString(),
    first_seen_at: hoursAgo(24),
    material_revision: 0,
    material_occurrence_at: null,
    last_material_change_at: null,
    ...over,
  });
  return new FakeDb({
    topics: [
      { id: T1, slug: "rust", label: "Rust", kind: "predefined", terms: [], match_spec: {} },
      { id: T2, slug: "zig", label: "Zig", kind: "custom", terms: ["zig"], match_spec: {} },
    ],
    sources: [
      { id: S1, name: "Gazette" },
      { id: S2, name: "Chronicle" },
    ],
    events: [
      // Lane A only, two articles from one source plus one from another.
      event("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { first_seen_at: hoursAgo(24) }),
      // Lane B only: first seen outside any plausible window, revised inside.
      event("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
        first_seen_at: hoursAgo(30 * 24),
        material_revision: 1,
        material_occurrence_at: hoursAgo(12),
      }),
      // Both lanes, source-less article, two topics.
      event("cccccccc-cccc-4ccc-8ccc-cccccccccccc", {
        first_seen_at: hoursAgo(1),
        material_revision: 2,
        material_occurrence_at: hoursAgo(0.5),
      }),
      // Neither lane: old and never revised.
      event("dddddddd-dddd-4ddd-8ddd-dddddddddddd", { first_seen_at: hoursAgo(30 * 24) }),
      // Wrong status, in window.
      event("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", { status: "pending" }),
      // Never analysed, in window.
      event("ffffffff-ffff-4fff-8fff-ffffffffffff", { analysed_at: null }),
      // Lane A but article-less: the bundle returns it, the caller gates it.
      event("99999999-9999-4999-8999-999999999999", { first_seen_at: hoursAgo(2) }),
    ],
    event_topics: [
      { event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", topic_id: T1 },
      { event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", topic_id: T1 },
      { event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", topic_id: T2 },
    ],
    articles: [
      { id: "a1", event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source_id: S1 },
      { id: "a2", event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source_id: S1 },
      { id: "a3", event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source_id: S2 },
      { id: "b1", event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", source_id: S2 },
      { id: "c1", event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", source_id: null },
    ],
  });
}

const TOPICS = new Map([
  [T1, { slug: "rust", label: "Rust" }],
  [T2, { slug: "zig", label: "Zig" }],
]);

/**
 * The pre-0116 loader, frozen. Any edit here is a change to the oracle, not
 * to the product, and must be justified as a correction to history.
 */
async function loadCandidatesLegacy(
  fake: FakeDb,
  options: MatchOptions,
  topics: Map<string, { slug: string; label: string }>,
): Promise<Candidate[]> {
  const db = asDb(fake) as unknown as SupabaseClient<Database>;
  const now = options.now ?? new Date();
  const limit = options.limit ?? 1000;
  const windowSince = new Date(now.getTime() - MAX_WEEKLY_AGE_HOURS * 3_600_000).toISOString();
  const fetchLimit = options.sinceHours === undefined ? limit : limit * 3;
  const base = () =>
    db.from("events").select("*").not("analysed_at", "is", null).eq("status", "complete");
  const [byFirstSeen, byOccurrence] = await Promise.all([
    base()
      .gte("first_seen_at", windowSince)
      .order("first_seen_at", { ascending: false })
      .limit(fetchLimit),
    base()
      .gt("material_revision", 0)
      .gte("material_occurrence_at", windowSince)
      .order("material_occurrence_at", { ascending: false })
      .limit(fetchLimit),
  ]);
  if (byFirstSeen.error) throw new Error(`reading events: ${byFirstSeen.error.message}`);
  if (byOccurrence.error) throw new Error(`reading revised events: ${byOccurrence.error.message}`);
  const merged = new Map<string, Row>();
  for (const event of (byFirstSeen.data ?? []) as Row[]) merged.set(event["id"] as string, event);
  for (const event of (byOccurrence.data ?? []) as Row[]) {
    if (!merged.has(event["id"] as string)) merged.set(event["id"] as string, event);
  }
  let rows = [...merged.values()];
  if (options.sinceHours !== undefined) {
    const since = now.getTime() - options.sinceHours * 3_600_000;
    rows = rows.filter((event) => {
      const at =
        (event["material_revision"] as number) > 0
          ? ((event["last_material_change_at"] ?? event["analysed_at"]) as string | null)
          : (event["analysed_at"] as string | null);
      const parsed = at === null ? Number.NaN : Date.parse(at);
      return Number.isFinite(parsed) && parsed >= since;
    });
  }
  const events = rows
    .sort(
      (a, b) =>
        effectiveAt(b) - effectiveAt(a) || (a["id"] as string).localeCompare(b["id"] as string),
    )
    .slice(0, limit);
  if (events.length === 0) return [];
  const eventIds = events.map((e) => e["id"] as string);
  const sources = new Map<string, string>(
    fake.rows("sources").map((s) => [s["id"] as string, s["name"] as string]),
  );
  const eventTopics = new Map<string, { id: string; slug: string; label: string }[]>();
  const eventSources = new Map<string, { id: string; name: string }[]>();
  const withArticles = new Set<string>();
  for (const chunk of chunked(eventIds, 100)) {
    const links = fake.rows("event_topics").filter((l) => chunk.includes(l["event_id"] as string));
    for (const link of links) {
      const topic = topics.get(link["topic_id"] as string);
      if (!topic) continue;
      const list = eventTopics.get(link["event_id"] as string) ?? [];
      list.push({ id: link["topic_id"] as string, slug: topic.slug, label: topic.label });
      eventTopics.set(link["event_id"] as string, list);
    }
    const arts = fake.rows("articles").filter((a) => chunk.includes(a["event_id"] as string));
    for (const article of arts) {
      if (article["event_id"] !== null) withArticles.add(article["event_id"] as string);
      if (article["event_id"] === null || article["source_id"] === null) continue;
      const source = sources.get(article["source_id"] as string);
      if (!source) continue;
      const list = eventSources.get(article["event_id"] as string) ?? [];
      if (!list.some((s) => s.id === article["source_id"])) {
        list.push({ id: article["source_id"] as string, name: source });
      }
      eventSources.set(article["event_id"] as string, list);
    }
  }
  return events
    .filter((event) => withArticles.has(event["id"] as string))
    .map((event) => ({
      eventId: event["id"] as string,
      title: event["title"] as string,
      whatHappened: event["what_happened"] as string,
      importance: event["importance"] as number,
      novelty: event["novelty"] as number,
      firstSeenAt: event["first_seen_at"] as string,
      materialRevision: (event["material_revision"] as number) ?? 0,
      materialOccurrenceAt: (event["material_occurrence_at"] as string | null) ?? null,
      tags: event["tags"] as string[],
      topics: eventTopics.get(event["id"] as string) ?? [],
      sources: eventSources.get(event["id"] as string) ?? [],
    }));
}

function effectiveAt(event: Row): number {
  const occurrence = (event["material_occurrence_at"] as string | null) ?? event["first_seen_at"];
  const parsed = Date.parse(occurrence as string);
  return Number.isFinite(parsed) ? parsed : 0;
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The test double for `match_candidate_bundle`: the RPC's rules evaluated
 * over `FakeDb` tables in table order, so the comparison with the legacy
 * loader is exact. The real SQL is proven on PGlite; this proves the mapping.
 */
function emulateBundle(fake: FakeDb): (args: Record<string, unknown>) => unknown {
  return (args) => {
    const windowSince = args["p_window_since"] as string;
    const fetchLimit = args["p_fetch_limit"] as number;
    const inWindow = (ts: unknown): boolean => typeof ts === "string" && ts >= windowSince;
    const laneA = fake
      .rows("events")
      .filter(
        (e) =>
          e["analysed_at"] != null && e["status"] === "complete" && inWindow(e["first_seen_at"]),
      )
      .sort((a, b) => String(b["first_seen_at"]).localeCompare(String(a["first_seen_at"])))
      .slice(0, fetchLimit);
    const laneB = fake
      .rows("events")
      .filter(
        (e) =>
          e["analysed_at"] != null &&
          e["status"] === "complete" &&
          (e["material_revision"] as number) > 0 &&
          inWindow(e["material_occurrence_at"]),
      )
      .sort((a, b) =>
        String(b["material_occurrence_at"]).localeCompare(String(a["material_occurrence_at"])),
      )
      .slice(0, fetchLimit);
    const merged = new Map<string, Row>();
    for (const e of [...laneA, ...laneB])
      if (!merged.has(e["id"] as string)) merged.set(e["id"] as string, e);
    const topicById = new Map(fake.rows("topics").map((t) => [t["id"] as string, t]));
    const sourceById = new Map(fake.rows("sources").map((s) => [s["id"] as string, s]));
    return [...merged.values()].map((e) => ({
      id: e["id"],
      title: e["title"],
      what_happened: e["what_happened"],
      importance: e["importance"],
      novelty: e["novelty"],
      tags: e["tags"],
      analysed_at: e["analysed_at"],
      first_seen_at: e["first_seen_at"],
      material_revision: e["material_revision"],
      material_occurrence_at: e["material_occurrence_at"],
      last_material_change_at: e["last_material_change_at"],
      topics: fake
        .rows("event_topics")
        .filter((l) => l["event_id"] === e["id"])
        .flatMap((l) => {
          const t = topicById.get(l["topic_id"] as string);
          return t ? [{ id: t["id"], slug: t["slug"], label: t["label"] }] : [];
        }),
      sources: (() => {
        const out: { id: unknown; name: unknown }[] = [];
        for (const a of fake.rows("articles").filter((x) => x["event_id"] === e["id"])) {
          if (a["source_id"] === null) continue;
          const s = sourceById.get(a["source_id"] as string);
          if (!s || out.some((o) => o.id === s["id"])) continue;
          out.push({ id: s["id"], name: s["name"] });
        }
        return out;
      })(),
      has_articles: fake.rows("articles").some((a) => a["event_id"] === e["id"]),
    }));
  };
}

const OPTS: MatchOptions[] = [
  { now: NOW },
  { now: NOW, limit: 2 },
  { now: NOW, limit: 1, sinceHours: 30 },
];

describe("the bundle returns what the chunked reads assembled", () => {
  for (const options of OPTS) {
    it(`matches the legacy loader for ${JSON.stringify({ limit: options.limit, sinceHours: options.sinceHours })}`, async () => {
      const fake = seedDb();
      fake.rpcs["match_candidate_bundle"] = emulateBundle(fake);
      const expected = await loadCandidatesLegacy(fake, options, TOPICS);
      const actual = await loadCandidates(asDb(fake), options);
      expect(actual).toEqual(expected);
    });
  }

  it("reaches the same three survivors: linked, revised-only, and source-less", async () => {
    const fake = seedDb();
    fake.rpcs["match_candidate_bundle"] = emulateBundle(fake);
    const actual = await loadCandidates(asDb(fake), { now: NOW });
    expect(actual.map((c) => c.eventId).sort()).toEqual(
      [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ].sort(),
    );
    const a = actual.find((c) => c.eventId.startsWith("aaaaaaaa"))!;
    expect(a.topics).toEqual([{ id: T1, slug: "rust", label: "Rust" }]);
    expect(a.sources).toEqual([
      { id: S1, name: "Gazette" },
      { id: S2, name: "Chronicle" },
    ]);
    const c = actual.find((c) => c.eventId.startsWith("cccccccc"))!;
    expect(c.topics).toEqual([
      { id: T1, slug: "rust", label: "Rust" },
      { id: T2, slug: "zig", label: "Zig" },
    ]);
    expect(c.sources).toEqual([]);
    const b = actual.find((c) => c.eventId.startsWith("bbbbbbbb"))!;
    expect(b.topics).toEqual([]);
    expect(b.sources).toEqual([{ id: S2, name: "Chronicle" }]);
  });

  it("spends exactly one call on candidates, with the window and the limit", async () => {
    const fake = seedDb();
    fake.rpcs["match_candidate_bundle"] = emulateBundle(fake);
    await loadCandidates(asDb(fake), { now: NOW, limit: 40 });
    const calls = fake.rpcCalls.filter((c) => c.fn === "match_candidate_bundle");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args["p_fetch_limit"]).toBe(40);
    expect(typeof calls[0]?.args["p_window_since"]).toBe("string");
  });

  it("a refused bundle fails loudly instead of matching nothing", async () => {
    const fake = seedDb();
    fake.rpcs["match_candidate_bundle"] = () => new Error("Too many subrequests");
    await expect(loadCandidates(asDb(fake), { now: NOW })).rejects.toThrow(
      "reading candidate bundle",
    );
  });
});
