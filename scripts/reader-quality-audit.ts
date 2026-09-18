import fixtures from "../src/lib/test-support/reader-production.json";
import { composeArticle } from "../src/lib/editorial";
import { selectReaderEvidence } from "../src/lib/reader-evidence";
import { scoreRelatedEvent } from "../src/lib/related-events";
import { rankEventTopics } from "../src/lib/pipeline/topic-assign";
import { readerQuality } from "../src/lib/understand";
import type { Story } from "../src/lib/story";

const prior = [
  [
    {
      title: "llama.cpp merged OpenVINO 2026.3.1 backend update",
      publishedAt: "2026-08-28T13:53:31Z",
    },
    {
      title: "a16z launches $1.1B Machine Age fund for AI hardware",
      publishedAt: "2026-08-28T13:24:43Z",
    },
  ],
  [
    {
      title: "Epstein survivors urge billionaire Leon Black to cooperate with House panel",
      publishedAt: "2026-09-02T22:03:25Z",
    },
    {
      title: "Australia sends drones to Nepal; Chalmers flags housing softness",
      publishedAt: "2026-09-02T22:00:26Z",
    },
  ],
];

for (const [index, fixture] of fixtures.entries()) {
  const story: Story = {
    id: fixture.id,
    title: fixture.title,
    what: fixture.what_happened,
    why: "",
    publishedAt: fixture.first_seen_at,
    sourceList: fixture.sources.map((s) => ({ ...s, at: "" })),
    org: "The Register",
    sources: 1,
    topics: [],
    time: "",
    before: "",
    after: "",
    timeline: [],
    importance: "Medium",
    score: { relevance: 50, importance: 50, novelty: 50 },
  };
  const selection = selectReaderEvidence(story.title, story.sourceList);
  const article = composeArticle(story);
  const text = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
  console.log(
    JSON.stringify(
      {
        id: story.id,
        rawEvidence: selection.rawCount,
        rejectedEvidence: selection.rejectedCount,
        duplicates: selection.duplicateCount,
        uniqueEvidence: selection.facts.length,
        words: text.split(/\s+/).length,
        quality: readerQuality(
          {
            newDevelopments: selection.facts.map((f) => ({ ...f, kind: "reported" })),
            context: [],
          },
          1,
        ),
        primaryCategory: rankEventTopics(
          story.title,
          article.deck.text,
          index === 0
            ? ["AI", "Cybersecurity"]
            : ["Politics", "Linux", "AI", "Anthropic", "Open source"],
        )[0],
        entities: selection.entities.filter(
          (e) => e.role === "PRIMARY" || e.role === "REPORTING_SOURCE",
        ),
        related: prior[index]!.map((candidate) => ({
          title: candidate.title,
          ...scoreRelatedEvent(story, candidate, 1),
        })),
        selected: selection.facts,
        article,
      },
      null,
      2,
    ),
  );
}
