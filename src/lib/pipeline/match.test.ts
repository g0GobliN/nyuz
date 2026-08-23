import { describe, expect, it } from "vitest";
import { floorFor, levelFor, thresholdFor } from "@/lib/density";
import { matchStories } from "@/lib/matching";
import { type Candidate, decide, type Reader, type ReaderTopic } from "@/lib/pipeline/match";
import { DEFAULT_PREFS, type Prefs } from "@/lib/prefs-store";
import type { Story } from "@/lib/sample-data";

/**
 * Stage 5's specification is `src/lib/matching.test.ts`, and the plan's last box
 * for this stage is that the rules in it still hold once a query replaces the
 * fixture module.
 *
 * The first block below does not restate those rules. It runs the same scenarios
 * through both implementations and asserts they reach the same answer, so the two
 * cannot drift apart without a failure here. `related` is shared between them for
 * the same reason: a second copy of the predicate would pass its own tests.
 *
 * Every replayed scenario uses density 100. `matchStories` has no importance
 * threshold at all — it predates the scored corpus — so admitting everything is
 * the only setting under which the two are comparable. The threshold is what the
 * second block tests.
 */

function story(id: string, org: string, topics: string[]): Story {
  return {
    id,
    org,
    title: `${org} did something`,
    what: "",
    why: "",
    importance: "Notable",
    score: { relevance: 0, importance: 0, novelty: 0 },
    sources: 1,
    topics,
    time: "06:00",
    publishedAt: "2026-08-23T06:00:00.000Z",
    sourceList: [],
    before: "",
    after: "",
    timeline: [],
  };
}

const FIXTURES: Story[] = [
  story("openai", "OpenAI", ["AI", "Developer Tools"]),
  story("react", "React", ["React", "Developer Tools"]),
  story("nvidia", "NVIDIA", ["Chips", "AI"]),
];

function slugOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** A fixture story as the shape stage 5 actually decides on. */
function asCandidate(s: Story, importance = 0, novelty = 0): Candidate {
  return {
    eventId: s.id,
    title: s.title,
    importance,
    novelty,
    topics: s.topics.map((label) => ({ id: `topic:${label}`, slug: slugOf(label), label })),
    sources: [{ id: `source:${s.org}`, name: s.org }],
  };
}

/**
 * A reader whose interests are free text, as onboarding collects them.
 *
 * The synthetic topic ids deliberately do not match the candidates' ids, so
 * selection here runs entirely through the keyword channel — the one place text
 * comparison happens, and so the only channel where these rules are observable.
 */
function asReader(p: Prefs, density = 100): Reader {
  return {
    userId: "reader",
    density,
    topics: p.topics
      .filter((t) => t.trim())
      .map((term) => ({
        topicId: `reader:${term}`,
        slug: slugOf(term),
        label: term,
        importance: "notable",
        weight: 1,
        keywords: [term],
        excludeKeywords: [],
      })),
    exclusions: p.exclusions.filter((t) => t.trim()),
    sourcePrefs: new Map(),
  };
}

function prefs(topics: string[], exclusions: string[] = []): Prefs {
  return { ...DEFAULT_PREFS, topics, exclusions };
}

/** The ids stage 5 would write to `user_events`, in fixture terms. */
function matchedIds(p: Prefs): string[] {
  const reader = asReader(p);
  return FIXTURES.filter((s) => decide(asCandidate(s), reader).matched)
    .map((s) => s.id)
    .sort();
}

/** The ids the fixture module returns for the same reader. */
function fixtureIds(p: Prefs): string[] {
  return matchStories(FIXTURES, p)
    .map((m) => m.story.id)
    .sort();
}

describe("the rules in matching.test.ts hold against stage 5", () => {
  const SCENARIOS: { name: string; prefs: Prefs }[] = [
    { name: "the reader has stated no interests", prefs: prefs([]) },
    { name: "no topic relates to any story", prefs: prefs(["Singing", "Cooking", "Football"]) },
    { name: "one topic relates to one story", prefs: prefs(["React"]) },
    { name: "one topic matches and one does not", prefs: prefs(["React", "Singing"]) },
    { name: "a topic selects two stories", prefs: prefs(["AI"]) },
    { name: "an exclusion vetoes one of them", prefs: prefs(["AI"], ["NVIDIA"]) },
    { name: "case and punctuation differ", prefs: prefs(["developer tools"]) },
    { name: "the topic is one character", prefs: prefs(["a"]) },
    { name: "three overlapping topics", prefs: prefs(["AI", "Chips", "Developer Tools"]) },
  ];

  for (const scenario of SCENARIOS) {
    it(`agrees with the fixture matcher when ${scenario.name}`, () => {
      expect(matchedIds(scenario.prefs)).toEqual(fixtureIds(scenario.prefs));
    });
  }

  // The same assertions the fixture tests make, stated once more against stage 5
  // directly, so a change that broke both implementations equally still fails.
  it("returns nothing when the reader has stated no interests", () => {
    expect(matchedIds(prefs([]))).toEqual([]);
    expect(decide(asCandidate(FIXTURES[0] as Story), asReader(prefs([])))).toEqual({
      matched: false,
      reason: "no-topics",
    });
  });

  it("returns only the stories a topic actually relates to", () => {
    expect(matchedIds(prefs(["React"]))).toEqual(["react"]);
  });

  it("reports which of the reader's own topics caused the match", () => {
    const verdict = decide(
      asCandidate(FIXTURES[1] as Story),
      asReader(prefs(["React", "Singing"])),
    );
    expect(verdict.matched && verdict.topics).toEqual(["React"]);
  });

  it("lets an exclusion veto a story its topic would otherwise select", () => {
    expect(matchedIds(prefs(["AI"]))).toContain("nvidia");

    const vetoed = matchedIds(prefs(["AI"], ["NVIDIA"]));
    expect(vetoed).not.toContain("nvidia");
    // An exclusion removes a story, not a topic.
    expect(vetoed).toContain("openai");
  });

  it("does not let a very short topic match everything", () => {
    expect(matchedIds(prefs(["a"]))).toEqual([]);
  });

  it("never matches the same event twice", () => {
    const ids = matchedIds(prefs(["AI", "Chips", "Developer Tools"]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* -------------------------------------------------------------------------- */

const TOPIC: ReaderTopic = {
  topicId: "t-ai",
  slug: "ai",
  label: "AI",
  importance: "notable",
  weight: 1,
  keywords: [],
  excludeKeywords: [],
};

function reader(overrides: Partial<Reader> = {}): Reader {
  return {
    userId: "reader",
    density: 100,
    topics: [TOPIC],
    exclusions: [],
    sourcePrefs: new Map(),
    ...overrides,
  };
}

function event(importance: number, overrides: Partial<Candidate> = {}): Candidate {
  return {
    eventId: "e1",
    title: "Something happened",
    importance,
    novelty: 0,
    topics: [{ id: "t-ai", slug: "ai", label: "AI" }],
    sources: [{ id: "s1", name: "TechCrunch" }],
    ...overrides,
  };
}

describe("the topic join", () => {
  it("matches on topic id, with no text in common anywhere", () => {
    // The event's title, slug, label and source share no substring with the
    // reader's topic. Only `event_topics` against `user_topics` can reach it.
    const opaque = event(5, {
      title: "Zzz quux frobnicate",
      topics: [{ id: "t-ai", slug: "qqq", label: "Qqq" }],
      sources: [{ id: "s1", name: "Wwww" }],
    });

    const verdict = decide(opaque, reader());
    expect(verdict.matched).toBe(true);
  });

  it("does not match an event whose topics the reader does not follow", () => {
    const other = event(5, { topics: [{ id: "t-gaming", slug: "gaming", label: "Gaming" }] });
    expect(decide(other, reader())).toEqual({ matched: false, reason: "no-topic-match" });
  });

  it("matches on a keyword the reader added to a topic", () => {
    const followed: ReaderTopic = { ...TOPIC, topicId: "t-none", keywords: ["Frobnicate"] };
    const untopiced = event(5, { title: "Acme will frobnicate the widget", topics: [] });

    expect(decide(untopiced, reader({ topics: [followed] })).matched).toBe(true);
  });

  it("cannot reach an event with no topics and no keyword to match", () => {
    // Sixteen of the analysed events are in exactly this position: correctly
    // scored, no row in `event_topics`, permanently unmatchable.
    expect(decide(event(9, { topics: [] }), reader())).toEqual({
      matched: false,
      reason: "no-topic-match",
    });
  });
});

describe("density as an importance threshold", () => {
  it("maps each band to the anchor its own wording describes", () => {
    expect(thresholdFor(0)).toBe(6); // Minimal: would regret missing
    expect(thresholdFor(35)).toBe(3); // Focused: the column default
    expect(thresholdFor(50)).toBe(1); // Broad
    expect(thresholdFor(100)).toBe(0); // Deep: everything
  });

  it("does not change the bar inside a band the reader sees one label for", () => {
    expect(thresholdFor(20)).toBe(thresholdFor(44));
    expect(levelFor(20).label).toBe(levelFor(44).label);
  });

  it("never raises the bar as the reader asks for more", () => {
    for (let d = 1; d <= 100; d += 1) {
      expect(thresholdFor(d)).toBeLessThanOrEqual(thresholdFor(d - 1));
    }
  });

  it("holds at the boundaries of every band", () => {
    expect([19, 20, 44, 45, 69, 70].map(thresholdFor)).toEqual([6, 3, 3, 1, 1, 0]);
  });

  it("keeps a routine event from a reader who asked for less", () => {
    expect(decide(event(2), reader({ density: 35 }))).toEqual({
      matched: false,
      reason: "below-threshold",
    });
    expect(decide(event(2), reader({ density: 100 })).matched).toBe(true);
  });

  it("admits a major event at every setting", () => {
    for (const density of [0, 35, 50, 100]) {
      expect(decide(event(7), reader({ density })).matched).toBe(true);
    }
  });

  it("lets a per-topic setting override the dial in both directions", () => {
    const everything: ReaderTopic = { ...TOPIC, importance: "everything" };
    const onlyMajor: ReaderTopic = { ...TOPIC, importance: "only_major" };

    // Minimal would refuse a routine event; "everything" on this topic takes it.
    expect(decide(event(0), reader({ density: 0, topics: [everything] })).matched).toBe(true);
    // Deep would take anything; "only_major" on this topic still refuses.
    expect(decide(event(3), reader({ density: 100, topics: [onlyMajor] }))).toEqual({
      matched: false,
      reason: "below-threshold",
    });
  });

  it("defers to the dial for the default per-topic setting", () => {
    expect(floorFor("notable", 3)).toBe(3);
    expect(floorFor("notable", 0)).toBe(0);
    expect(floorFor("everything", 6)).toBe(0);
    expect(floorFor("only_major", 0)).toBe(6);
  });

  it("admits an event that clears the bar for any one followed topic", () => {
    const strict: ReaderTopic = { ...TOPIC, topicId: "t-x", label: "X", importance: "only_major" };
    const loose: ReaderTopic = { ...TOPIC, topicId: "t-ai", importance: "everything" };
    const both = event(1, {
      topics: [
        { id: "t-x", slug: "x", label: "X" },
        { id: "t-ai", slug: "ai", label: "AI" },
      ],
    });

    const verdict = decide(both, reader({ topics: [strict, loose] }));
    expect(verdict.matched).toBe(true);
    // Only the topic that admitted it is named, so the explanation cannot claim
    // an interest that did not select this story.
    expect(verdict.matched && verdict.topics).toEqual(["AI"]);
  });
});

describe("exclusions, which are applied last and win", () => {
  it("beats a topic the reader follows by id", () => {
    expect(decide(event(9), reader({ exclusions: ["AI"] }))).toEqual({
      matched: false,
      reason: "excluded",
    });
  });

  it("matches the title, the topic label and the source name", () => {
    expect(decide(event(9), reader({ exclusions: ["Something happened"] })).matched).toBe(false);
    expect(decide(event(9), reader({ exclusions: ["TechCrunch"] })).matched).toBe(false);
    expect(decide(event(9), reader({ exclusions: ["ai"] })).matched).toBe(false);
  });

  it("does not veto on a term that appears nowhere", () => {
    expect(decide(event(9), reader({ exclusions: ["Crypto"] })).matched).toBe(true);
  });

  it("honours a term the reader attached to one topic", () => {
    const narrowed: ReaderTopic = { ...TOPIC, excludeKeywords: ["TechCrunch"] };
    expect(decide(event(9), reader({ topics: [narrowed] }))).toEqual({
      matched: false,
      reason: "excluded",
    });
  });

  it("applies a topic's exclusions even when that topic did not clear the bar", () => {
    // The veto is the point. A topic strict enough to reject the event still gets
    // to reject it, rather than quietly handing the decision to another topic.
    const strict: ReaderTopic = {
      ...TOPIC,
      importance: "only_major",
      excludeKeywords: ["TechCrunch"],
    };
    const loose: ReaderTopic = { ...TOPIC, topicId: "t-two", importance: "everything" };
    const both = event(1, {
      topics: [
        { id: "t-ai", slug: "ai", label: "AI" },
        { id: "t-two", slug: "two", label: "Two" },
      ],
    });

    expect(decide(both, reader({ topics: [strict, loose] }))).toEqual({
      matched: false,
      reason: "excluded",
    });
  });

  it("is not fooled by case or punctuation", () => {
    const cased = event(9, { title: "The A.I. Act passed" });
    expect(decide(cased, reader({ exclusions: ["a i act"] })).matched).toBe(false);
  });
});

describe("source preferences", () => {
  const twoSources = event(9, {
    sources: [
      { id: "s1", name: "TechCrunch" },
      { id: "s2", name: "The Verge" },
    ],
  });

  it("still delivers an event when only some of its sources are muted", () => {
    const muted = new Map<string, "normal" | "priority" | "muted">([["s1", "muted"]]);
    expect(decide(twoSources, reader({ sourcePrefs: muted })).matched).toBe(true);
  });

  it("drops an event only when every source reporting it is muted", () => {
    const muted = new Map<string, "normal" | "priority" | "muted">([
      ["s1", "muted"],
      ["s2", "muted"],
    ]);
    expect(decide(twoSources, reader({ sourcePrefs: muted }))).toEqual({
      matched: false,
      reason: "all-sources-muted",
    });
  });

  it("does not drop an event that has no sources attached", () => {
    const muted = new Map<string, "normal" | "priority" | "muted">([["s1", "muted"]]);
    expect(decide(event(9, { sources: [] }), reader({ sourcePrefs: muted })).matched).toBe(true);
  });

  it("raises relevance for a source the reader marked priority", () => {
    const plain = decide(event(5), reader());
    const priority = decide(event(5), reader({ sourcePrefs: new Map([["s1", "priority"]]) }));

    expect(plain.matched && priority.matched && priority.relevance).toBeGreaterThan(
      plain.matched ? plain.relevance : 0,
    );
  });

  it("does not let priority smuggle an event past the threshold", () => {
    // Priority orders a briefing; it does not decide what is in one.
    expect(
      decide(event(0), reader({ density: 0, sourcePrefs: new Map([["s1", "priority"]]) })),
    ).toEqual({ matched: false, reason: "below-threshold" });
  });
});

describe("relevance", () => {
  function relevanceOf(verdict: ReturnType<typeof decide>): number {
    return verdict.matched ? verdict.relevance : -1;
  }

  it("leads with importance", () => {
    expect(relevanceOf(decide(event(7), reader()))).toBeGreaterThan(
      relevanceOf(decide(event(3), reader())),
    );
  });

  it("counts novelty at half weight", () => {
    expect(relevanceOf(decide(event(4, { novelty: 8 }), reader()))).toBe(8);
    expect(relevanceOf(decide(event(4, { novelty: 0 }), reader()))).toBe(4);
  });

  it("lets a personal term outrank a step of importance, on purpose", () => {
    // Five points of novelty is deliberately enough to reach an importance-9
    // event, and this exact tie is what "relevance is not a second copy of
    // importance" costs. A strictly importance-led order would put the
    // field-wide story a reader barely cares about above the one in three of
    // their interests.
    expect(relevanceOf(decide(event(4, { novelty: 10 }), reader()))).toBe(
      relevanceOf(decide(event(9, { novelty: 0 }), reader())),
    );

    const second: ReaderTopic = { ...TOPIC, topicId: "t-chips", slug: "chips", label: "Chips" };
    const twoInterests = event(4, {
      topics: [
        { id: "t-ai", slug: "ai", label: "AI" },
        { id: "t-chips", slug: "chips", label: "Chips" },
      ],
    });

    expect(relevanceOf(decide(twoInterests, reader({ topics: [TOPIC, second] })))).toBeGreaterThan(
      relevanceOf(decide(event(4), reader())),
    );
  });

  it("rewards an event that sits in more than one of the reader's interests", () => {
    const second: ReaderTopic = { ...TOPIC, topicId: "t-chips", slug: "chips", label: "Chips" };
    const both = event(5, {
      topics: [
        { id: "t-ai", slug: "ai", label: "AI" },
        { id: "t-chips", slug: "chips", label: "Chips" },
      ],
    });

    expect(relevanceOf(decide(both, reader({ topics: [TOPIC, second] })))).toBe(6);
    expect(relevanceOf(decide(both, reader({ topics: [TOPIC] })))).toBe(5);
  });

  it("scales by the weight of the topic that matched", () => {
    const heavy: ReaderTopic = { ...TOPIC, weight: 2 };
    expect(relevanceOf(decide(event(5), reader({ topics: [heavy] })))).toBe(10);
  });

  it("is stable enough to assert against", () => {
    expect(relevanceOf(decide(event(3, { novelty: 3 }), reader()))).toBe(4.5);
  });
});
