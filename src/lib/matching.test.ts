import { describe, expect, it } from "vitest";
import { becauseYouFollow, matchStories } from "@/lib/matching";
import { DEFAULT_PREFS, type Prefs } from "@/lib/prefs-store";
import type { Story } from "@/lib/story";

/**
 * Regression tests for a bug that shipped: the dashboard showed all six sample
 * stories to everyone, captioned with a hard-coded claim about what the reader
 * followed. Someone who onboarded asking for singing was told "You follow chips
 * and AI infrastructure" above an NVIDIA story.
 *
 * The rule these lock in — topics select, exclusions veto — is the same one
 * `0001_init.sql` specifies for the real pipeline. When ingestion replaces this
 * module with a database query, these cases are what the query has to satisfy.
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

function prefs(topics: string[], exclusions: string[] = []): Prefs {
  return { ...DEFAULT_PREFS, topics, exclusions };
}

describe("matchStories", () => {
  it("returns nothing when the reader has stated no interests", () => {
    // The bug in its purest form: no topics must not mean "show everything".
    expect(matchStories(FIXTURES, prefs([]))).toEqual([]);
  });

  it("returns nothing when no topic relates to any story", () => {
    const result = matchStories(FIXTURES, prefs(["Singing", "Cooking", "Football"]));
    expect(result).toEqual([]);
  });

  it("returns only the stories a topic actually relates to", () => {
    const result = matchStories(FIXTURES, prefs(["React"]));
    expect(result.map((m) => m.story.id)).toEqual(["react"]);
  });

  it("reports which of the reader's own topics caused the match", () => {
    const result = matchStories(FIXTURES, prefs(["React", "Singing"]));
    // "Singing" matched nothing, so it must not appear in the explanation.
    expect(result[0]?.matched).toEqual(["React"]);
  });

  it("lets an exclusion veto a story its topic would otherwise select", () => {
    const both = matchStories(FIXTURES, prefs(["AI"]));
    expect(both.map((m) => m.story.id)).toContain("nvidia");

    const vetoed = matchStories(FIXTURES, prefs(["AI"], ["NVIDIA"]));
    expect(vetoed.map((m) => m.story.id)).not.toContain("nvidia");
    // The other AI story survives: an exclusion removes a story, not a topic.
    expect(vetoed.map((m) => m.story.id)).toContain("openai");
  });

  it("matches case- and punctuation-insensitively", () => {
    const result = matchStories(FIXTURES, prefs(["developer tools"]));
    expect(result.map((m) => m.story.id).sort()).toEqual(["openai", "react"]);
  });

  it("does not let a very short topic match everything", () => {
    // Guards the length floor in `related`. Without it, a stray one- or
    // two-character topic reintroduces "show all" through the back door.
    const result = matchStories(FIXTURES, prefs(["a"]));
    expect(result).toEqual([]);
  });

  it("never returns the same story twice", () => {
    const result = matchStories(FIXTURES, prefs(["AI", "Chips", "Developer Tools"]));
    const ids = result.map((m) => m.story.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("becauseYouFollow", () => {
  it("says nothing when nothing matched", () => {
    expect(becauseYouFollow([])).toBe("");
  });

  it("reads as a sentence for one, two and three topics", () => {
    expect(becauseYouFollow(["AI"])).toBe("You follow AI.");
    expect(becauseYouFollow(["AI", "React"])).toBe("You follow AI and React.");
    expect(becauseYouFollow(["AI", "React", "Chips"])).toBe("You follow AI, React and Chips.");
  });

  it("caps the list rather than listing every topic", () => {
    const text = becauseYouFollow(["AI", "React", "Chips", "Startups", "Robotics"]);
    expect(text).toBe("You follow AI, React and Chips.");
    expect(text).not.toContain("Robotics");
  });
});
