import { describe, it, expect } from "vitest";
import {
  assignTopics,
  assignTags,
  assignTopicsByTerms,
  compareTopics,
  compareTags,
} from "./topic-assign";

/**
 * The contamination the strong/weak vocabulary exists to stop.
 *
 * Every string here is real copy from live events on 2026-09-08, and every
 * assertion is a label that was actually written to `event_topic_candidates`
 * and would have reached `event_topics`. They are phrased as "this text must
 * not be labelled X" rather than "this text is labelled Y" on purpose: the
 * failure being pinned is a topic arriving with no evidence, which is a
 * property of the absence, and a test that only asserted the right labels would
 * still pass with Music attached beside them.
 */
describe("assignTopics: topics need evidence", () => {
  it("does not read Music or Next.js into a German election story", () => {
    // "populist" contains "pop"; "what happens next" contains "next".
    const topics = assignTopics(
      "Germany's far-right achieves an electoral breakthrough in key state election. " +
        "Germany's populist, far-right Alternative for Germany party has declared victory " +
        "in the state of Saxony-Anhalt after more than doubling its share of the vote. " +
        "Tuesday briefing: what happens next after Germany's far-right breakthrough.",
    );
    expect(topics).toContain("Politics");
    expect(topics).not.toContain("Music");
    expect(topics).not.toContain("Next.js");
  });

  it("does not read Music into a story about tourism", () => {
    // "tourist" contains "tour"; the photo credit contains "World".
    const topics = assignTopics(
      "Tokyo tourist hotspot bans short-term rentals amid surge in complaints. " +
        "Photograph: World Discovery/Alamy",
    );
    expect(topics).not.toContain("Music");
    expect(topics).not.toContain("World");
  });

  it("does not read Developer tools into 'identify' or Consumer tech into one 'device'", () => {
    const topics = assignTopics(
      "Germany poised to identify suspect in Leipzig drone attack on Ukrainian plane. " +
        "A drone carrying an explosive device was discovered at the airport.",
    );
    expect(topics).not.toContain("Developer tools");
    expect(topics).not.toContain("Consumer tech");
    // One ambiguous word is not a category, even a plausible one.
    expect(topics).not.toContain("Robotics");
  });

  it("does not read Chips into 'intelligence' or AI into 'aid'", () => {
    const topics = assignTopics(
      "Intelligence services brief lawmakers as foreign aid budgets are cut again.",
    );
    expect(topics).not.toContain("Chips");
    expect(topics).not.toContain("AI");
  });

  it("does not label every Hacker News item Cybersecurity", () => {
    const topics = assignTopics("Hacker News thread discusses the Bayeux tapestry's mysteries");
    expect(topics).not.toContain("Cybersecurity");
  });

  it("does not read Sports into machine-learning copy", () => {
    const topics = assignTopics(
      "Advantage Weighted Matching: aligning RL with pretraining in diffusion models. " +
        "Reinforcement learning has emerged as a central paradigm for advancing large " +
        "language models, where the score function is matched across stages.",
    );
    expect(topics).toContain("AI");
    expect(topics).not.toContain("Sports");
  });

  it("refuses a topic on one weak term and allows it on two", () => {
    // "tour" alone is not Music; "tour" with "album" is.
    expect(assignTopics("The tour bus broke down outside town.")).not.toContain("Music");
    expect(assignTopics("The band announced a tour to promote the new album.")).toContain("Music");
  });

  it("still assigns a topic on a single unambiguous term", () => {
    expect(assignTopics("TSMC opens a new fabrication plant.")).toContain("Chips");
    expect(assignTopics("Parliament passed the measure on Tuesday.")).toContain("Politics");
    expect(assignTopics("A ransomware crew hit the hospital's billing system.")).toContain(
      "Cybersecurity",
    );
  });

  it("matches regular inflections but never a longer unrelated word", () => {
    expect(assignTopics("Flooding swept the valley as emissions targets slipped.")).toContain(
      "Climate",
    );
    // "tourist", "populist", "identify", "apple", "climate" all start with a
    // keyword and must not match one.
    const nothing = assignTopics(
      "The tourist populist bought an apple and asked staff to identify the climate of the room.",
    );
    expect(nothing).not.toContain("Music");
    expect(nothing).not.toContain("Consumer tech");
    expect(nothing).not.toContain("Developer tools");
  });

  it("matches a keyword whose written form contains punctuation", () => {
    // "next.js" normalises to "next js"; before this it could never match, so
    // the label rested entirely on the bare word "next".
    expect(assignTopics("Next.js 16 ships a new app router cache.")).toContain("Next.js");
    expect(assignTopics("Docker and CI/CD pipelines were rebuilt around the compiler.")).toContain(
      "Developer tools",
    );
  });
});

describe("assignTopics", () => {
  it("assigns AI topic for AI-related text", () => {
    const topics = assignTopics(
      "Artificial intelligence and machine learning are transforming the industry.",
    );
    expect(topics).toContain("AI");
  });

  it("assigns Cybersecurity topic for security-related text", () => {
    const topics = assignTopics("A new vulnerability was discovered in the system.");
    expect(topics).toContain("Cybersecurity");
  });

  it("assigns Economy topic for economic text", () => {
    const topics = assignTopics("The stock market rose after the quarterly earnings report.");
    expect(topics).toContain("Economy");
  });

  it("returns nothing for text about nothing followed", () => {
    // "weather" is a weak Climate term and stands alone, so it is not a label.
    expect(assignTopics("The weather is nice today.")).toEqual([]);
  });

  it("assigns multiple topics when relevant", () => {
    const topics = assignTopics("OpenAI raised $13 billion in funding for AI research.");
    expect(topics).toContain("AI");
    expect(topics).toContain("Funding");
    expect(topics).toContain("OpenAI");
  });

  it("limits to 5 topics", () => {
    const text =
      "OpenAI raised funding for AI research in the United States. The stock market rose. Cybersecurity is important.";
    const topics = assignTopics(text);
    expect(topics.length).toBeLessThanOrEqual(5);
  });
});

/**
 * Four real production headlines that reached `status = 'complete'` with no
 * `event_topics` row. The AI-agent case is fixed by this file's "ai agent"
 * phrases; Rail, EV chargers and Army are fixed by the taxonomy expansion
 * (Transport/Automotive/Military/Crime) below -- none of them are forced into
 * a loosely-related existing topic via a generic word.
 */
describe("assignTopics: real complete-events-with-no-topics production cases", () => {
  it("does not read AI into the bare headline alone", () => {
    // No article text beyond the headline itself gives no phrase to match --
    // an honest limit of title-only matching, not something this file can fix.
    expect(assignTopics("Your Agent Aced the Task. Will It Do It Again?")).not.toContain("AI");
  });

  it("reads AI once the aggregated coverage names the phrase", () => {
    // classify.ts's haystack is title + every article's excerpt, not the
    // headline alone -- this is what a real excerpt for this story looks like.
    const text =
      "Your Agent Aced the Task. Will It Do It Again? " +
      "Benchmarks for AI agents rarely test whether an agentic AI system can " +
      "repeat a win, only whether it can win once.";
    expect(assignTopics(text)).toContain("AI");
  });

  it("reads Transport out of the rail passenger-rights story", () => {
    expect(
      assignTopics(
        "Rail passengers get automatic right to switch operators for free when trains are cancelled",
      ),
    ).toEqual(["Transport"]);
  });

  it("reads Automotive out of the EV charger supply/demand report", () => {
    expect(
      assignTopics("Demand for EV chargers is outstripping supply, says ChargePoint report"),
    ).toEqual(["Automotive"]);
  });

  it("reads both Military and Crime out of the court-martial story", () => {
    const topics = assignTopics(
      "Army officers 'let down' soldier over sexual assault claim before she killed herself, court martial told",
    );
    expect(topics).toContain("Military");
    expect(topics).toContain("Crime");
  });
});

/**
 * Negative fixtures for the 7 new topics, straight from the ambiguous-word
 * hazards named when this taxonomy was expanded -- each is a plausible
 * headline that must NOT get the new label, because it only contains the
 * kind of generic bare word the strong/weak split exists to keep out.
 */
describe("assignTopics: new topics do not read into ambiguous common words", () => {
  it("does not read Transport into 'track' or 'route'", () => {
    expect(assignTopics("The company is on track to beat earnings")).not.toContain("Transport");
    expect(assignTopics("Training route for developers")).not.toContain("Transport");
  });

  it("does not read Automotive into 'drive' or 'engineer'", () => {
    expect(assignTopics("Drive business growth")).not.toContain("Automotive");
    expect(assignTopics("Engineer productivity")).not.toContain("Automotive");
  });

  it("does not read Energy into bare 'power' or 'energy'", () => {
    expect(assignTopics("Political power")).not.toContain("Energy");
    expect(assignTopics("High-energy performance")).not.toContain("Energy");
  });

  it("does not read Crime into a book review", () => {
    expect(assignTopics("Crime novel wins literary award")).not.toContain("Crime");
  });

  it("does not read Military into the idiom 'army of volunteers'", () => {
    expect(assignTopics("An army of volunteers cleaned up the park")).not.toContain("Military");
  });

  it("does not read Education into 'machine learning training'", () => {
    expect(assignTopics("Machine learning training improves model accuracy")).not.toContain(
      "Education",
    );
  });

  it("does not read Travel into the verb 'travel'", () => {
    expect(assignTopics("Data packets travel across the network")).not.toContain("Travel");
  });
});

describe("assignTags", () => {
  it("assigns funding tag", () => {
    const tags = assignTags("The company raised $50 million in a Series B round.");
    expect(tags).toContain("funding");
  });

  it("assigns cybersecurity tag", () => {
    const tags = assignTags("A major security breach exposed user data.");
    expect(tags).toContain("cybersecurity");
  });

  it("assigns layoff tag", () => {
    const tags = assignTags("100 jobs will be cut as part of a workforce reduction.");
    expect(tags).toContain("layoffs");
  });

  it("returns empty array for unrelated text", () => {
    const tags = assignTags("The weather is nice today.");
    expect(tags).toEqual([]);
  });

  it("limits to 8 tags", () => {
    const text =
      "Funding was raised. A security breach occurred. Layoffs happened. A partnership was announced. A product launched. An acquisition closed. Research was published. Controversy emerged.";
    const tags = assignTags(text);
    expect(tags.length).toBeLessThanOrEqual(8);
  });
});

describe("assignTopicsByTerms", () => {
  it("assigns topics using term matching", () => {
    const topics = assignTopicsByTerms("The ai model was trained on data.");
    expect(topics).toContain("AI");
  });

  it("returns empty for unrelated text", () => {
    const topics = assignTopicsByTerms("The weather is nice today.");
    expect(topics).toEqual([]);
  });
});

describe("compareTopics", () => {
  it("returns perfect agreement for matching topics", () => {
    const result = compareTopics(["AI", "Funding"], ["AI", "Funding"]);
    expect(result.agreementRate).toBe(1.0);
    expect(result.exactMatches).toBe(2);
  });

  it("returns zero agreement for completely different topics", () => {
    const result = compareTopics(["AI"], ["Sports"]);
    expect(result.agreementRate).toBe(0);
    expect(result.falsePositives).toBe(1);
    expect(result.falseNegatives).toBe(1);
  });

  it("handles empty sets", () => {
    const result = compareTopics([], []);
    expect(result.agreementRate).toBe(1.0);
  });
});

describe("compareTags", () => {
  it("returns perfect agreement for matching tags", () => {
    const result = compareTags(["funding", "cybersecurity"], ["funding", "cybersecurity"]);
    expect(result.agreementRate).toBe(1.0);
  });

  it("returns partial agreement for overlapping tags", () => {
    const result = compareTags(["funding"], ["funding", "cybersecurity"]);
    expect(result.agreementRate).toBe(0.5);
  });
});
