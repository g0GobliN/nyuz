/**
 * Story boundary enforcement: a story page must not carry another story's paragraph.
 *
 * N-02 blocker (audit v2, row N-02, capture 2026-10-23):
 * Story `st-4001e8a2` (Sudan / Abyei) opens on Sudan's war and then prints, as its
 * second block: "Finally, ten years after Cameroon's deadliest railway disaster,
 * families of the 79 victims are still fighting for justice, saying their pain
 * has yet to be acknowledged.[1]"
 *
 * That paragraph belongs to a different story on the same France 24 source page.
 * The composer published both under one headline with no frame separating them.
 *
 * Rule: a block whose evidence belongs to a different article/event than the
 * story's own must not compose. The rule must separate "which source page
 * carried this" from "which story this block is about" — not a string filter on
 * "Cameroon".
 *
 * Corpus: live briefing, current edition, card 16, story `st-4001e8a2` (measured
 * 2026-10-23). Run with `npm run test:coverage -- src/lib/editorial-story-boundary.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { composeArticleWithDiagnostics } from "./editorial";
import type { Story } from "./story";

/**
 * The published Cameroon paragraph, verbatim from the audit capture.
 * This is the exact text that must NOT appear in the Sudan story's output.
 */
const CAMEROON_PARAGRAPH =
  "Finally, ten years after Cameroon's deadliest railway disaster, families of the 79 victims are still fighting for justice, saying their pain has yet to be acknowledged.";

/**
 * A Sudan/Abyei story with two sources:
 * - Source 0 (primary): Sudan war coverage, articleId "sudan-war-article"
 * - Source 1 (foreign): Cameroon railway disaster from same France 24 page, articleId "cameroon-railway-article"
 *
 * The story's identity is tied to the primary source's articleId. The Cameroon
 * paragraph arrives via source 1 and must be rejected at the story boundary.
 */
const sudanStoryWithForeignSource: Story = {
  id: "st-4001e8a2",
  org: "France 24",
  title: "Sudan's war and the Abyei dispute",
  what: "Sudan's war enters a new phase as the Abyei area becomes contested",
  why: "The Abyei area sits on the border between Sudan and South Sudan, claimed by both",
  importance: "High",
  score: { relevance: 80, importance: 85, novelty: 70 },
  sources: 2,
  topics: ["Sudan", "Abyei", "conflict"],
  time: "",
  publishedAt: "2026-10-23T09:00:00Z",
  sourceList: [
    {
      name: "France 24",
      at: "",
      headline: "Sudan's war enters new phase as Abyei becomes flashpoint",
      excerpt:
        "Sudan's war has entered a dangerous new phase with the contested Abyei area becoming a flashpoint between the army and the Rapid Support Forces. The area, claimed by both Sudan and South Sudan, has seen heavy fighting in recent weeks.",
      articleId: "sudan-war-article",
      enrichedEvidence: [
        {
          kind: "fact",
          text: "Sudan's war has entered a dangerous new phase with the contested Abyei area becoming a flashpoint between the army and the Rapid Support Forces.",
          entities: ["Sudan", "Abyei", "Rapid Support Forces"],
          attribution: "France 24",
        },
        {
          kind: "fact",
          text: "The area, claimed by both Sudan and South Sudan, has seen heavy fighting in recent weeks.",
          entities: ["Sudan", "South Sudan"],
          attribution: "France 24",
        },
      ],
    },
    {
      name: "France 24",
      at: "",
      headline: "Cameroon railway disaster: families still fighting for justice ten years on",
      excerpt: CAMEROON_PARAGRAPH,
      articleId: "cameroon-railway-article",
      enrichedEvidence: [
        {
          kind: "fact",
          text: CAMEROON_PARAGRAPH,
          entities: ["Cameroon"],
          attribution: "France 24",
        },
      ],
    },
  ],
  before: "",
  after: "",
  timeline: [],
};

const composedText = (story: Story): string => {
  const { article } = composeArticleWithDiagnostics(story);
  return [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)].join(" ");
};

describe("story boundary: a story page must not carry another story's paragraph", () => {
  it("excludes the Cameroon paragraph from the Sudan story", () => {
    const text = composedText(sudanStoryWithForeignSource);
    // The Cameroon paragraph must not appear in the composed output
    expect(text).not.toContain(CAMEROON_PARAGRAPH);
  });

  it("keeps the Sudan story's own blocks", () => {
    const text = composedText(sudanStoryWithForeignSource);
    // The Sudan story's own content must still compose
    expect(text).toContain("Sudan");
    expect(text).toContain("Abyei");
    expect(text).toContain("Rapid Support Forces");
  });

  it("does not filter on country name — a Cameroon paragraph from the story's own source would publish", () => {
    // Control: if the Cameroon paragraph came from the story's OWN source,
    // it should publish. This proves the rule uses article identity, not
    // a string filter on "Cameroon".
    const storyWithCameroonAsPrimary: Story = {
      ...sudanStoryWithForeignSource,
      title: "Cameroon railway disaster: ten years on",
      what: "Families of the 79 victims still seek justice",
      sourceList: [
        {
          name: "France 24",
          at: "",
          headline: "Cameroon railway disaster: families still fighting for justice ten years on",
          excerpt: CAMEROON_PARAGRAPH,
          articleId: "cameroon-railway-article",
          enrichedEvidence: [
            {
              kind: "fact",
              text: CAMEROON_PARAGRAPH,
              entities: ["Cameroon"],
              attribution: "France 24",
            },
          ],
        },
      ],
    };
    const text = composedText(storyWithCameroonAsPrimary);
    expect(text).toContain("Cameroon");
    expect(text).toContain("railway disaster");
  });
});