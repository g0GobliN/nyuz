import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_FEEDBACK } from "@/lib/feedback-store";
import type { Story } from "@/lib/story";
import { StoryArticle } from "./story-article";
import { StoryCard } from "./story-card";

/**
 * The card and the story page print the same opening sentence.
 *
 * This is the only test that can catch the defect the ruling is about, because
 * it renders both components and reads what a reader would read. The two
 * surfaces used to resolve their own line — the card printed the event's stored
 * summary (`briefingText` and its recovery), the page printed the deck its
 * composition chose — and on the live corpus they agreed **9 times in 57**
 * (measured by `npm run audit:surfaces`, 2026-10-18).
 *
 * The router stands in as an anchor: the card's links need a running router and
 * this file is about the card's prose.
 */
vi.mock("@tanstack/react-router", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: (props: { children?: unknown }) => h("a", { href: "#" }, props.children as never),
  };
});

const OPENING = "The team rebuilt its fuzzing harness around a taskflow agent.";

/** A source whose composed deck is a *different* sentence from the stored line. */
const EXCERPT =
  "Even projects that have been enrolled in OSS-Fuzz for years can still hide critical bugs, and the reason is almost always the same: coverage drifts and nobody is watching it.";

const story = (what: string): Story => ({
  id: "6f1c9a52-0000-4000-8000-000000000001",
  org: "GitHub",
  title: "AI-powered fuzzing with the GitHub Security Lab Taskflow Agent",
  what,
  why: "",
  importance: "High",
  score: { relevance: 60, importance: 60, novelty: 60 },
  sources: 1,
  topics: ["AI"],
  time: "",
  publishedAt: "2026-09-25T03:26:00Z",
  sourceList: [{ name: "GitHub", at: "", headline: "Taskflow", excerpt: EXCERPT }],
  before: "",
  after: "",
  timeline: [],
});

/** The card's summary paragraph, as text. */
function cardLine(html: string): string {
  const match = html.match(/<p class="mt-3 text-\[14px\][^"]*">(.*?)<\/p>/u);
  return (match?.[1] ?? "").replace(/<[^>]+>/gu, "").trim();
}

/** The page's opening paragraph, as text.
 *
 * Matched on the two classes that identify it — `mt-6` and the 14.5 px body
 * size — rather than on their order, because the reading measure
 * (`max-w-[34rem]`, design spec S6) sits in front of both and a helper that
 * pins the order reports the opening missing the day a class string is
 * rewritten.
 */
function pageOpening(html: string): string {
  const match = html.match(
    /<p class="(?=[^"]*\bmt-6\b)(?=[^"]*text-\[14\.5px\])[^"]*">([\s\S]*?)<\/p>/u,
  );
  return (match?.[1] ?? "").replace(/<[^>]+>/gu, "").trim();
}

const renderCard = (value: Story): string =>
  renderToStaticMarkup(
    createElement(StoryCard, {
      story: value,
      matched: [],
      index: 0,
      feedback: EMPTY_FEEDBACK,
      onVote: () => undefined,
      onSave: () => undefined,
      onDismiss: () => undefined,
      onMute: () => undefined,
    }),
  ).replace(/&#x27;/gu, "'");

const renderArticle = (value: Story): string =>
  renderToStaticMarkup(
    createElement(StoryArticle, {
      story: value,
      saved: false,
      current: undefined,
      onVote: () => undefined,
      onToggleSaved: () => undefined,
      onReachEnd: () => undefined,
    }),
  ).replace(/&#x27;/gu, "'");

describe("the card's line is the page's opening", () => {
  it("prints the delivered line on both surfaces, not the composer's deck", () => {
    const value = story(OPENING);
    const card = cardLine(renderCard(value));
    const page = pageOpening(renderArticle(value));
    expect(card).toBe(OPENING);
    expect(page).toBe(OPENING);
  });

  it("does not print the same sentence twice on the page", () => {
    // The stored line is also a sentence of the story's own coverage, which is
    // the shape measured on 19 of the feed's 56 cards: without `withoutOpening`
    // the reader would meet it as the opening and again in the first paragraph.
    const value = story(EXCERPT.split(". ")[0]! + ".");
    const html = renderArticle(value);
    expect(pageOpening(html)).toBe(value.what);
    const occurrences = html.split(value.what).length - 1;
    expect(occurrences).toBe(1);
  });

  it("opens on the composer's deck when the card has no sentence at all", () => {
    // The card is furniture-only and there is no coverage to recover from, so it
    // prints nothing; the page still opens on its composition's deck, with the
    // deck's own evidence refs (`opening === article.deck.text`).
    const value: Story = {
      ...story("Photograph: Alexandra Topping/The Guardian."),
    };
    const html = renderArticle(value);
    expect(pageOpening(html)).toContain("Even projects that have been enrolled in OSS-Fuzz");
    expect(html).toContain('id="source-');
  });

  it("renders the article's own chrome states without disturbing the opening", () => {
    // Covers the component's button and error branches: a saved story, an
    // existing vote and a failed save must all render with the same opening.
    const value = story(OPENING);
    const html = renderToStaticMarkup(
      createElement(StoryArticle, {
        story: value,
        saved: true,
        current: "useful" as const,
        onVote: () => undefined,
        onToggleSaved: () => undefined,
        saveError: "Saving is unavailable right now.",
        onReachEnd: () => undefined,
      }),
    );
    expect(pageOpening(html)).toBe(OPENING);
    expect(html).toContain("Saved");
    expect(html).toContain("Saving is unavailable right now.");
  });

  it("prints no opening on either surface when the boundary refuses the line", () => {
    // A furniture line the card withholds, and a source with nothing to
    // recover: both surfaces print the headline and nothing else, so they still
    // agree — the card cannot show a sentence the page does not open on.
    const value: Story = {
      ...story("Photograph: Alexandra Topping/The Guardian."),
      sourceList: [],
    };
    expect(cardLine(renderCard(value))).toBe("");
    expect(pageOpening(renderArticle(value))).toBe("");
  });
});
