import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveSpecFromTerms,
  evaluateSpec,
  specForTopic,
  specStatus,
  topicMatches,
  type MatchSpec,
} from "@/lib/match-spec";
import {
  MatchSpecError,
  acceptPromotions,
  newTopicRow,
  promotionEvidence,
  resetTopicMatchSpec,
  writeTopicMatchSpec,
} from "@/lib/match-spec-store";
import { normaliseText } from "@/lib/topics";
import { classify } from "@/lib/pipeline/classify";
import { analyse } from "@/lib/pipeline/analyse";
import { match } from "@/lib/pipeline/match";
import { asDb, FakeDb, type Row } from "@/lib/test-support/fake-db";
import { newsPipelineFixture, READER_ID, seedEvent } from "@/lib/test-support/news-pipeline";

/**
 * The match-spec lifecycle, from the write to the reader.
 *
 * `match-spec.test.ts` proves what a specification *means*. This file proves it
 * can actually get into production and that every stage then reads the same
 * thing: creation stores the derived spec, an operator can author an explicit
 * one (and cannot store a malformed one), promotion is earned from the topic's
 * own coverage, and classification, finalization and the reader join agree.
 */

const NOW = new Date("2026-09-26T09:00:00Z");
const TOPIC = "33333333-3333-4333-8333-333333333333";

function topicRow(overrides: Row = {}): Row {
  return {
    id: TOPIC,
    slug: "arsenal",
    label: "Arsenal",
    kind: "custom",
    terms: ["arsenal"],
    match_spec: {},
    match_spec_source: null,
    match_spec_updated_at: null,
    ...overrides,
  };
}

const ARSENAL: MatchSpec = {
  v: 1,
  require: [[{ text: "arsenal" }]],
  optional: [{ text: "gunners" }],
  exclude: [{ text: "women" }],
};

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

describe("a new custom topic is created with its derived specification", () => {
  it("stores the spec derived from its terms, marked derived and dated", () => {
    const row = newTopicRow(
      {
        slug: "nepal-floods",
        label: "Nepal floods",
        predefined: false,
        terms: ["nepal", "floods"],
      },
      READER_ID,
      NOW,
    );
    expect(row).toMatchObject({
      kind: "custom",
      terms: ["nepal", "floods"],
      match_spec: deriveSpecFromTerms(["nepal", "floods"]),
      match_spec_source: "derived",
      match_spec_updated_at: NOW.toISOString(),
    });
    // Identical to what an older row's `{}` derives, so creation changes nothing
    // anybody receives -- it only records it.
    expect(specForTopic(row)).toEqual(specForTopic({ terms: ["nepal", "floods"], match_spec: {} }));
  });

  it("leaves an editorial topic without terms or a spec", () => {
    const row = newTopicRow(
      { slug: "sports", label: "Sports", predefined: true, terms: ["sports"] },
      READER_ID,
      NOW,
    );
    expect(row).toEqual({
      slug: "sports",
      label: "Sports",
      kind: "predefined",
      terms: [],
      created_by: READER_ID,
    });
  });

  it("is the path the preferences save actually takes", () => {
    const source = readFileSync("src/lib/server/preferences.ts", "utf8");
    expect(source).toMatch(/creatable\.map\(\(topic\) => newTopicRow\(topic, userId, now\)\)/);
  });
});

/* -------------------------------------------------------------------------- */
/* Authoring                                                                   */
/* -------------------------------------------------------------------------- */

describe("an operator can store an explicit specification, and only a valid one", () => {
  it("persists the spec, its source and when it changed", async () => {
    const db = new FakeDb({ topics: [topicRow()] });
    await writeTopicMatchSpec(asDb(db), TOPIC, ARSENAL, NOW);
    const row = db.rows("topics")[0]!;
    expect(row["match_spec"]).toEqual(ARSENAL);
    expect(row["match_spec_source"]).toBe("enriched");
    expect(row["match_spec_updated_at"]).toBe(NOW.toISOString());
    expect(specStatus(row as never)).toBe("explicit");
  });

  it.each([
    ["an empty require", { v: 1, require: [] }],
    ["a wrong version", { v: 2, require: [[{ text: "arsenal" }]] }],
    ["an unknown key", { v: 1, require: [[{ text: "arsenal" }]], anything: true }],
    [
      "an exclusion that normalises to nothing",
      { v: 1, require: [[{ text: "a" }]], exclude: [{ text: "!!!" }] },
    ],
    [
      "an alias of a missing group",
      { v: 1, require: [[{ text: "a" }]], optional: [{ text: "b", aliasOf: 3 }] },
    ],
    ["a non-string term", { v: 1, require: [[{ text: 7 }]] }],
  ])("refuses %s and leaves the row alone", async (_label, spec) => {
    const db = new FakeDb({ topics: [topicRow()] });
    await expect(writeTopicMatchSpec(asDb(db), TOPIC, spec, NOW)).rejects.toBeInstanceOf(
      MatchSpecError,
    );
    expect(db.rows("topics")[0]?.["match_spec"]).toEqual({});
    expect(db.rows("topics")[0]?.["match_spec_updated_at"]).toBeNull();
  });

  it("refuses a spec on an editorial topic", async () => {
    const db = new FakeDb({ topics: [topicRow({ kind: "predefined", terms: [] })] });
    await expect(writeTopicMatchSpec(asDb(db), TOPIC, ARSENAL, NOW)).rejects.toThrow(
      /reader-created/,
    );
  });

  it("refuses to overwrite a spec that changed underneath the editor", async () => {
    const db = new FakeDb({ topics: [topicRow()] });
    await writeTopicMatchSpec(asDb(db), TOPIC, ARSENAL, NOW);
    // A second writer holding the pre-edit timestamp.
    db.hooks.afterSelect = (table, rows) => {
      if (table === "topics") for (const row of rows) row["match_spec_updated_at"] = null;
    };
    await expect(
      writeTopicMatchSpec(asDb(db), TOPIC, deriveSpecFromTerms(["arsenal"]), NOW),
    ).rejects.toThrow(/changed while you were editing/);
  });

  it("resets to deriving from terms", async () => {
    const db = new FakeDb({ topics: [topicRow()] });
    await writeTopicMatchSpec(asDb(db), TOPIC, ARSENAL, NOW);
    await resetTopicMatchSpec(asDb(db), TOPIC, new Date(NOW.getTime() + 1000));
    const row = db.rows("topics")[0]!;
    expect(row["match_spec"]).toEqual({});
    expect(row["match_spec_source"]).toBeNull();
    expect(specStatus(row as never)).toBe("derived");
  });
});

describe("a malformed stored value fails closed", () => {
  it("selects nothing rather than falling back to something broader", () => {
    // Written behind the application's back: an exclusion plus a stray key. The
    // derived fallback would be `arsenal` with no exclusion -- broader than what
    // was written -- so the reader gets nothing from this topic instead, and the
    // console can see why.
    const malformed = {
      terms: ["arsenal"],
      match_spec: { v: 1, require: [[{ text: "arsenal" }]], exclude: [{ text: "women" }], x: 1 },
    };
    expect(specStatus(malformed)).toBe("malformed");
    expect(topicMatches(malformed, normaliseText("Arsenal women win the league"))).toBe(false);
    expect(topicMatches(malformed, normaliseText("Arsenal beat Spurs"))).toBe(false);
  });

  it("fails closed on malformed JSON primitives without throwing in status checks", () => {
    for (const match_spec of ["broken", 12, true]) {
      const malformed = { terms: ["arsenal"], match_spec };
      expect(specStatus(malformed)).toBe("malformed");
      expect(topicMatches(malformed, normaliseText("Arsenal beat Spurs"))).toBe(false);
    }
  });

  it("parses a stored spec once per stored object, not once per evaluation", () => {
    // The reader join evaluates a topic per (reader, candidate); the stored
    // value is one object for the whole run, so it is validated once.
    const stored = { v: 1, require: [[{ text: "arsenal" }]] };
    const topic = { terms: ["arsenal"], match_spec: stored };
    expect(specForTopic(topic)).toBe(specForTopic(topic));
    const derived = { terms: ["arsenal"], match_spec: {} };
    expect(specForTopic(derived)).toBe(specForTopic(derived));
  });

  it("still derives from terms when nothing is stored", () => {
    expect(topicMatches({ terms: ["arsenal"], match_spec: {} }, normaliseText("Arsenal win"))).toBe(
      true,
    );
    expect(topicMatches({ terms: ["arsenal"] }, normaliseText("Gunners win"))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Promotion                                                                   */
/* -------------------------------------------------------------------------- */

/** A topic whose `event_topics` history is `events`, and whose follower engaged with some. */
function promotionDb(
  events: { id: string; title: string }[],
  engaged: string[] = [],
  by = READER_ID,
) {
  return new FakeDb({
    topics: [
      topicRow({
        match_spec: ARSENAL,
        match_spec_source: "enriched",
        match_spec_updated_at: NOW.toISOString(),
      }),
    ],
    event_topics: events.map((event) => ({ event_id: event.id, topic_id: TOPIC })),
    events: events.map((event) => ({ ...event, what_happened: "", tags: [] })),
    user_topics: [{ user_id: READER_ID, topic_id: TOPIC }],
    user_events: engaged.map((eventId) => ({
      user_id: by,
      event_id: eventId,
      engaged_at: NOW.toISOString(),
    })),
  });
}

const cooccurring = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    title: `Arsenal and the Gunners, story ${i}`,
  }));

describe("optional terms boost, and are promoted only on evidence", () => {
  it("never admits on an optional term alone", () => {
    expect(evaluateSpec(ARSENAL, normaliseText("The Gunners sign a midfielder")).matched).toBe(
      false,
    );
  });

  it("is not a candidate below the evidence threshold", async () => {
    const report = await promotionEvidence(asDb(promotionDb(cooccurring(2))), TOPIC);
    expect(report.evidence["gunners"]).toEqual({ matchedEvents: 2, engaged: false });
    expect(report.candidates).toEqual([]);
  });

  it("does not count events the spec itself would not select", async () => {
    // "Gunners" with no "Arsenal" is the term's own match, not independent
    // evidence -- and "women" is vetoed by the topic's exclusion.
    const events = [
      ...cooccurring(2),
      { id: "x1", title: "The Gunners are back" },
      { id: "x2", title: "Arsenal Women and the Gunners fans" },
    ];
    const report = await promotionEvidence(asDb(promotionDb(events)), TOPIC);
    expect(report.evidence["gunners"]?.matchedEvents).toBe(2);
    expect(report.candidates).toEqual([]);
  });

  it("becomes a candidate at three independent matches", async () => {
    const report = await promotionEvidence(asDb(promotionDb(cooccurring(3))), TOPIC);
    expect(report.candidates.map((term) => term.text)).toEqual(["gunners"]);
  });

  it("becomes a candidate when a follower engaged, and not when a stranger did", async () => {
    const followed = await promotionEvidence(asDb(promotionDb(cooccurring(1), ["e0"])), TOPIC);
    expect(followed.candidates.map((term) => term.text)).toEqual(["gunners"]);
    const stranger = await promotionEvidence(
      asDb(promotionDb(cooccurring(1), ["e0"], "99999999-9999-4999-8999-999999999999")),
      TOPIC,
    );
    expect(stranger.candidates).toEqual([]);
  });

  it("persists an accepted promotion as an alternative name, still under the veto", async () => {
    const db = promotionDb(cooccurring(3));
    const later = new Date(NOW.getTime() + 60_000);
    const result = await acceptPromotions(asDb(db), TOPIC, ["Gunners"], later);
    expect(result.promoted.map((term) => term.text)).toEqual(["gunners"]);

    const row = db.rows("topics")[0]!;
    expect(row["match_spec"]).toEqual({
      v: 1,
      require: [[{ text: "arsenal" }, { text: "gunners" }]],
      optional: [],
      exclude: [{ text: "women" }],
    });
    expect(row["match_spec_source"]).toBe("enriched");
    expect(row["match_spec_updated_at"]).toBe(later.toISOString());

    // The promoted name now admits on its own ...
    expect(topicMatches(row as never, normaliseText("The Gunners sign a midfielder"))).toBe(true);
    // ... and is exactly as subject to the exclusion as the name it joined.
    expect(topicMatches(row as never, normaliseText("The Gunners women win the cup"))).toBe(false);
  });

  it("refuses to promote a term that has not earned it", async () => {
    const db = promotionDb(cooccurring(2));
    await expect(acceptPromotions(asDb(db), TOPIC, ["gunners"], NOW)).rejects.toThrow(
      /earned promotion/,
    );
    expect(db.rows("topics")[0]?.["match_spec"]).toEqual(ARSENAL);
  });
});

/* -------------------------------------------------------------------------- */
/* One evaluator, every stage                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The pipeline, from a stored spec to a reader, against the fake database.
 *
 * The explicit spec here differs from the legacy term rule on purpose: the topic's
 * `terms` are `["arsenal"]`, and the coverage says "Gunners". Under `matchesTerms`
 * nothing would reach anybody; under the spec, every stage selects the story --
 * and every stage refuses the one the spec excludes.
 */
async function pipeline(spec: unknown) {
  const clock = { now: NOW };
  const db = newsPipelineFixture(NOW, clock);
  db.tables["topics"] = [topicRow({ match_spec: spec })];
  db.tables["user_topics"] = [
    {
      user_id: READER_ID,
      topic_id: TOPIC,
      muted: false,
      importance: "everything",
      weight: 1,
      keywords: [],
      exclude_keywords: [],
      created_at: NOW.toISOString(),
    },
  ];
  seedEvent(
    db,
    { id: "gunners", title: "Gunners sign a midfielder" },
    [
      {
        title: "Gunners sign a midfielder",
        excerpt: "The Gunners completed the signing on Friday.",
      },
    ],
    clock,
  );
  seedEvent(
    db,
    { id: "women", title: "Gunners women win the cup" },
    [
      {
        title: "Gunners women win the cup",
        excerpt: "The Gunners women's side lifted the trophy.",
      },
    ],
    clock,
  );
  seedEvent(
    db,
    { id: "rail", title: "Rail strike announced" },
    [{ title: "Rail strike announced", excerpt: "Unions announced a rail strike for next week." }],
    clock,
  );

  await classify(asDb(db), { now: NOW });
  const candidates = db.rows("event_topic_candidates").map((r) => r["event_id"]);
  await analyse(asDb(db), { now: NOW });
  const linked = db
    .rows("event_topics")
    .filter((r) => r["topic_id"] === TOPIC)
    .map((r) => r["event_id"]);
  await match(asDb(db), { now: NOW, skipAlerts: true, subjectSignificance: false });
  const delivered = db.rows("user_events").map((r) => r["event_id"]);
  return { db, candidates, linked, delivered };
}

describe("classification, finalization and the reader join use one evaluator", () => {
  const explicit: MatchSpec = {
    v: 1,
    require: [[{ text: "arsenal" }, { text: "gunners" }]],
    exclude: [{ text: "women" }],
  };

  it("carries an explicit spec from classification to the reader", async () => {
    const { candidates, linked, delivered } = await pipeline(explicit);
    expect(candidates).toEqual(["gunners"]);
    expect(linked).toEqual(["gunners"]);
    expect(delivered).toEqual(["gunners"]);
  });

  it("keeps the legacy rule exactly when nothing is stored", async () => {
    // `terms = ["arsenal"]` and no spec: none of this coverage says Arsenal, so
    // no stage selects anything -- the behaviour before 0100, unchanged.
    const { candidates, linked, delivered } = await pipeline({});
    expect(candidates).toEqual([]);
    expect(linked).toEqual([]);
    expect(delivered).toEqual([]);
  });

  it("does not let a candidate written before an exclusion outlive it", async () => {
    // Classified under a spec with no exclusion, so both Gunners stories become
    // candidates. The operator then excludes "women". Finalization re-reads the
    // spec and drops the stale candidate, and the reader join vetoes it too.
    const clock = { now: NOW };
    const db = newsPipelineFixture(NOW, clock);
    db.tables["topics"] = [topicRow({ match_spec: { v: 1, require: explicit.require } })];
    db.tables["user_topics"] = [
      {
        user_id: READER_ID,
        topic_id: TOPIC,
        muted: false,
        importance: "everything",
        weight: 1,
        keywords: [],
        exclude_keywords: [],
        created_at: NOW.toISOString(),
      },
    ];
    seedEvent(
      db,
      { id: "women", title: "Gunners women win the cup" },
      [
        {
          title: "Gunners women win the cup",
          excerpt: "The Gunners women's side lifted the trophy.",
        },
      ],
      clock,
    );
    await classify(asDb(db), { now: NOW });
    expect(db.rows("event_topic_candidates").map((r) => r["event_id"])).toEqual(["women"]);

    db.rows("topics")[0]!["match_spec_updated_at"] = null;
    await writeTopicMatchSpec(asDb(db), TOPIC, explicit, NOW);

    await analyse(asDb(db), { now: NOW });
    expect(db.rows("event_topics").filter((r) => r["topic_id"] === TOPIC)).toEqual([]);
    await match(asDb(db), { now: NOW, skipAlerts: true, subjectSignificance: false });
    expect(db.rows("user_events")).toEqual([]);
  });

  it("vetoes an existing event_topics link once the topic excludes it", async () => {
    // The strongest route into a topic -- the exact join -- still answers to the
    // topic's exclusions.
    const { db } = await pipeline({ v: 1, require: explicit.require });
    expect(
      db
        .rows("user_events")
        .map((r) => r["event_id"])
        .sort(),
    ).toEqual(["gunners", "women"]);

    db.tables["user_events"] = [];
    db.rows("topics")[0]!["match_spec"] = explicit;
    await match(asDb(db), { now: NOW, skipAlerts: true, subjectSignificance: false });
    expect(db.rows("user_events").map((r) => r["event_id"])).toEqual(["gunners"]);

    // And a spec that cannot be read selects nothing on the join either: failing
    // closed on one route and open on another would not be failing closed.
    db.tables["user_events"] = [];
    db.rows("topics")[0]!["match_spec"] = { ...explicit, unexpected: true };
    await match(asDb(db), { now: NOW, skipAlerts: true, subjectSignificance: false });
    expect(db.rows("user_events")).toEqual([]);
  });

  it("rechecks an existing event_topics link against changed require groups", async () => {
    const { db } = await pipeline({ v: 1, require: explicit.require });
    expect(db.rows("event_topics").some((row) => row["topic_id"] === TOPIC)).toBe(true);

    db.tables["user_events"] = [];
    db.rows("topics")[0]!["match_spec"] = { v: 1, require: [[{ text: "arsenal" }]] };
    await match(asDb(db), { now: NOW, skipAlerts: true, subjectSignificance: false });

    // The persisted link was written under the old spec. It may not grant a
    // match when the current requirements no longer fit the event signal.
    expect(db.rows("user_events")).toEqual([]);
  });
});

describe("no stage keeps a private matching rule", () => {
  it.each([
    "src/lib/pipeline/classify.ts",
    "src/lib/pipeline/analyse.ts",
    "src/lib/pipeline/match.ts",
    "src/lib/pipeline/backfill.ts",
    "src/lib/pipeline/topic-assign.ts",
  ])("%s does not call matchesTerms", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/\bmatchesTerms\s*\(/);
  });
});
