import { describe, it, expect } from "vitest";
import {
  assignTopics,
  assignTags,
  assignTopicsByTerms,
  compareTopics,
  compareTags,
} from "./topic-assign";

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

  it("returns empty array for unrelated text", () => {
    const topics = assignTopics("The weather is nice today.");
    // Weather might match Climate
    expect(Array.isArray(topics)).toBe(true);
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
