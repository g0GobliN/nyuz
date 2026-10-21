import { describe, expect, it } from "vitest";
import type { ReaderArticle } from "./reader-article";
import { withoutOpening } from "./reader-article";
import { storyOpening } from "./reader-opening";
import type { Story } from "./story";

/**
 * One sentence, one surface: ruling #11 extended to the feed and the archive.
 *
 * Measured 2026-10-18 by `npm run audit:surfaces`, the contract held on **9 of
 * 57** feed cards and **7 of 14** archive cards: the card printed the event's
 * stored summary while the page opened on a composed sentence, so a reader met
 * the story twice and heard it said two different ways. The arbiter's contract
 * is one authoritative sentence at the point of delivery, and the surfaces now
 * resolve it through one function — the card, the story page, and the live
 * audit all call `storyOpening`.
 *
 * These tests pin that function and the body rule beside it. They do not prove
 * the pages agree; `story-opening-surfaces.test.ts` renders both components and
 * compares the sentences, which is the only test that can catch a component
 * that stops calling the shared rule.
 */

const ARTICLE_OPENS =
  "Even projects that have been enrolled in OSS-Fuzz for years can still hide critical bugs, and the reason is almost always the same: coverage drifts and nobody is watching it.";

const OPENING_PREFIX =
  "Even projects that have been enrolled in OSS-Fuzz for years can still hide critical bugs";

/** A stored line the card's deck predicate refuses (the live 2026-10-14 defect). */
const LIST_ITEM =
  "A set of taskflow YAMLs, one per stage, which are essentially the prompts that tell the LLM agent what to do at each step.";

const story = (what: string, excerpt: string, name = "GitHub"): Story => ({
  id: "reader-opening",
  org: name,
  title: "AI-powered fuzzing with the GitHub Security Lab Taskflow Agent",
  what,
  why: "",
  importance: "High",
  score: { relevance: 60, importance: 60, novelty: 60 },
  sources: 1,
  topics: ["AI"],
  time: "",
  publishedAt: "2026-09-25T03:26:00Z",
  sourceList: [{ name, at: "", headline: "Taskflow", excerpt }],
  before: "",
  after: "",
  timeline: [],
});

const article = (paragraphs: ReaderArticle["paragraphs"], deck = ""): ReaderArticle => ({
  deck: { text: deck, evidence: [1] },
  paragraphs,
});

describe("storyOpening — the sentence a story opens on", () => {
  it("prints a stored line the boundary admits, unchanged", () => {
    const complete =
      "Negotiators walked out after midnight, then returned to the table before morning briefings went out.";
    expect(storyOpening(story(complete, ARTICLE_OPENS))).toBe(complete);
  });

  it("prints a delivered artifact exactly as the briefing stored it", () => {
    // Ruling #11's sentence: attribution frame included, never stripped or
    // regenerated. It differs from the event's own line, and it still wins,
    // because the reader has already met it on the briefing card.
    const delivered =
      "In recent weeks, The Verge reports that Amazon says the change gives customers more control.";
    expect(storyOpening(story(delivered, ARTICLE_OPENS))).toBe(delivered);
  });

  it("recovers the published opening when the deck predicate refuses the stored line", () => {
    const out = storyOpening(story(LIST_ITEM, ARTICLE_OPENS));
    expect(out).toContain(OPENING_PREFIX);
    expect(out).toMatch(/according to GitHub\./);
    expect(out).not.toMatch(/taskflow YAMLs/);
  });

  it("withholds a furniture line rather than recovering around it", () => {
    expect(storyOpening(story("Photograph: Alexandra Topping/The Guardian.", ARTICLE_OPENS))).toBe(
      "",
    );
  });

  it("withholds entirely when the story publishes nothing usable", () => {
    // The page prints no opening either — the two surfaces are equal by the
    // same call, and the surface gate decides whether the card ships at all.
    expect(storyOpening(story(LIST_ITEM, ""))).toBe("");
  });

  it("recovers the page's opening when the delivered line never reached the card", () => {
    // The loader refused the stored line (it opens on a reference: "The authors
    // introduce…"), so the card receives nothing. The page still opens on its
    // composition, so the card must print that same sentence rather than stay
    // silent — 11 of the feed's 56 cards had exactly this shape on 2026-10-20.
    const out = storyOpening(story("", ARTICLE_OPENS));
    expect(out).toContain(OPENING_PREFIX);
    expect(out).toMatch(/according to GitHub\./);
  });
});

describe("withoutOpening — the body never repeats the opening", () => {
  it("lifts the opening sentence out of a paragraph that also carries the next fact", () => {
    const opening =
      "The results show that SETAREH can approximate the evaluated inner products using substantially fewer transformed coefficients.";
    const rest = "That cuts the memory a search index needs at query time.";
    const out = withoutOpening(
      article([{ text: `${opening} ${rest}`, evidence: [1] }], opening),
      opening,
    );
    expect(out.paragraphs).toHaveLength(1);
    expect(out.paragraphs[0]!.text).toBe(rest);
  });

  it("drops a paragraph that is exactly the opening", () => {
    const opening = "The council approved the plan on Tuesday.";
    const out = withoutOpening(
      article([
        { text: opening, evidence: [1] },
        { text: "The vote was unanimous.", evidence: [1] },
      ]),
      opening,
    );
    expect(out.paragraphs).toHaveLength(1);
    expect(out.paragraphs[0]!.text).toBe("The vote was unanimous.");
  });

  it("keeps a sentence that only resembles the opening", () => {
    const opening = "The council approved the plan on Tuesday.";
    const near = "The council approved a different plan on Wednesday.";
    const out = withoutOpening(article([{ text: near, evidence: [1] }]), opening);
    expect(out.paragraphs[0]!.text).toBe(near);
  });

  it("is a no-op when the opening is the composition's own deck", () => {
    const original = article([{ text: "A second fact follows the deck.", evidence: [1] }], "Deck.");
    expect(withoutOpening(original, "Deck.")).toEqual(original);
  });

  it("drops a glue pair only when one of its two sentences went with the opening", () => {
    const opening = "Officials confirmed the closure late on Monday.";
    const dependent = "They said it would last a week.";
    const predecessor = "The plant had been offline since March.";
    const out = withoutOpening(
      article([
        {
          text: `${opening} ${predecessor} ${dependent}`,
          evidence: [1],
          glue: [{ dependent, predecessor }],
        },
      ]),
      opening,
    );
    expect(out.paragraphs[0]!.text).toBe(`${predecessor} ${dependent}`);
    expect(out.paragraphs[0]!.glue).toEqual([{ dependent, predecessor }]);
  });
});
