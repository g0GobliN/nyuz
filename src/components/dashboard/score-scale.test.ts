import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IMPORTANT_FLOOR } from "@/lib/pipeline/alert-floor";
import { formatScore } from "@/lib/score-format";
import { asPercent, type Story } from "@/lib/story";
import { StoryArticle } from "./story-article";

/**
 * One number, on both surfaces.
 *
 * S9 of the design audit (`docs/design-spec-2026-10-21.md`) found the product
 * printing the same stored score two ways: the story page's Scoring card said
 * **Importance 50%** while `/dashboard/alerts` said **"Only events scoring 6 or
 * higher interrupt you"**. Both were the 0–10 value (`asPercent` is `score * 10`,
 * `src/lib/story.ts`), so a reader had to divide by ten to see that the 6 that
 * interrupts them is the 5.0 (or 6.0) on the page they were reading.
 *
 * The ruling is option A: one scale, 0–10. One decimal follows only when the
 * score has one — a stored 6 printed `6.0 / 10`, which claims a tenth the
 * number does not carry, so whole scores now print bare (`formatScore`,
 * `src/lib/score-format.ts`). This test is the one that can prove the two
 * surfaces agree, because it renders the real component and reads the alert
 * sentence from the route that prints it — a test over either surface alone
 * would have passed while the defect stood.
 *
 * The router stands in as an anchor for `EvidenceRefs`, as in
 * `story-opening-surfaces.test.ts`.
 */
vi.mock("@tanstack/react-router", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: (props: { children?: unknown }) => h("a", { href: "#" }, props.children as never),
  };
});

/** The card chrome and label the rail has used since the Understand page shipped. */
const CARD = 'class="rounded-2xl border border-hairline bg-surface p-5"';
const CARD_LABEL = 'class="text-[11px] uppercase tracking-[0.16em] text-muted-foreground"';

/**
 * A story whose three scores are 0–100, which is what `Story.score` carries:
 * `asPercent(event.importance)` and friends, already clamped and rounded.
 */
const story = (score: { relevance: number; importance: number; novelty: number }): Story => ({
  id: "6f1c9a52-0000-4000-8000-000000000001",
  org: "GitHub",
  title: "AI-powered fuzzing with the GitHub Security Lab Taskflow Agent",
  what: "The team rebuilt its fuzzing harness around a taskflow agent.",
  why: "",
  importance: "High",
  score,
  sources: 1,
  topics: ["AI"],
  time: "",
  publishedAt: "2026-09-25T03:26:00Z",
  sourceList: [{ name: "GitHub", at: "", headline: "Taskflow", excerpt: "" }],
  before: "",
  after: "",
  timeline: [],
});

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
  );

/** The Scoring card alone, so no later card's text can satisfy an assertion. */
function scoringCard(html: string): string {
  const card = html.split(CARD).find((segment) => segment.includes(">Scoring</p>"));
  if (!card) throw new Error("the Scoring card did not render");
  return card;
}

/** The value spans of the three rows, in Relevance, Importance, Novelty order. */
const valuesIn = (card: string): string[] =>
  [...card.matchAll(/<span class="tabular-nums">([^<]*)<\/span>/gu)].map((match) => match[1] ?? "");

/** The card's visible text, with the markup — and therefore the bar widths — gone. */
const textOf = (card: string): string =>
  card
    .replace(/<[^>]+>/gu, "")
    .replace(/&#x27;/gu, "'")
    .trim();

describe("the story page's Scoring card prints one 0–10 scale", () => {
  const card = scoringCard(renderArticle(story({ relevance: 60, importance: 50, novelty: 70 })));

  it("prints all three scores as N / 10 or N.N / 10, and no percent sign at all", () => {
    const values = valuesIn(card);
    expect(values).toHaveLength(3);
    for (const value of values) expect(value).toMatch(/^\d{1,2}(\.\d)? \/ 10$/u);
    expect(values).toEqual(["6 / 10", "5 / 10", "7 / 10"]);
    // The defect: this string used to read "Importance50%". A percent sign in the
    // card's text is the second scale coming back.
    expect(textOf(card)).not.toContain("%");
  });

  it("reads a stored importance of 5.0 as 5 / 10, not 50%", () => {
    // The live capture in the audit (`story-sidebar-1280.png`) showed 50% here.
    expect(card).toContain(
      '<span class="text-muted-foreground">Importance</span><span class="tabular-nums">5 / 10</span>',
    );
  });

  it("drops the trailing zero at the top of the scale too", () => {
    // Relevance is `asPercent(user_events.relevance)` and clamps at 100, so 100
    // is the widest a row can get: it reads 10 / 10, not 10.0 / 10.
    const top = scoringCard(renderArticle(story({ relevance: 100, importance: 100, novelty: 0 })));
    expect(valuesIn(top)).toEqual(["10 / 10", "10 / 10", "0 / 10"]);
  });

  it("keeps the decimal where the score actually has one", () => {
    const fractional = scoringCard(
      renderArticle(story({ relevance: 59, importance: 96, novelty: 34 })),
    );
    expect(valuesIn(fractional)).toEqual(["5.9 / 10", "9.6 / 10", "3.4 / 10"]);
  });

  it("keeps the bars, their 1 px height and their widths", () => {
    // The bar is the glance the spec keeps; its width still comes from the
    // 0–100 value, so the printed number moved to 0–10 and the geometry did not.
    expect(card).toContain('<div class="mt-1.5 h-1 rounded-full bg-muted">');
    expect(card).toContain('class="h-1 rounded-full bg-signal transition-[width] duration-1000"');
    expect([...card.matchAll(/style="width:([^"]+)"/gu)].map((match) => match[1])).toEqual([
      "60%",
      "50%",
      "70%",
    ]);
  });

  it("keeps the card chrome, the label size and the 11 px uppercase label", () => {
    const html = renderArticle(story({ relevance: 60, importance: 50, novelty: 70 }));
    expect(html).toContain(CARD);
    expect(html).toContain(CARD_LABEL);
    expect(html).toContain(
      `<p class="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Scoring</p>`,
    );
    expect(card).toContain('<div class="flex justify-between text-[12.5px]">');
  });
});

describe("the alert rule names the same number as the rail", () => {
  const ALERTS_ROUTE = join("src", "routes", "dashboard", "alerts", "index.tsx");
  const source = readFileSync(join(process.cwd(), ALERTS_ROUTE), "utf8");

  it("reads its threshold from the alert stage's own constant", () => {
    expect(source).toContain('import { IMPORTANT_FLOOR } from "@/lib/pipeline/alert-floor";');
    expect(source).toContain(
      "Only events scoring ${formatScore(IMPORTANT_FLOOR)} or higher out of 10 interrupt you",
    );
    // A literal floor is how the two scales drifted apart the first time.
    expect(source).not.toContain("scoring 6 or higher");
  });

  it("keeps the daily allowance it already told the reader about", () => {
    // S9 is a scale change, not a deletion: the sentence that follows still
    // carries the plan's cap, so a quiet day's promise is not lost with it.
    expect(source).toContain("never more than ${limits.alertDailyCap} in a day");
  });

  it("prints, for an alerted story, the number the rail prints", () => {
    // The smallest importance that can interrupt is the floor itself, and the
    // rail is where a reader sees it: render that story and compare the two
    // numbers rather than the two literals.
    const floorStory = scoringCard(
      renderArticle(story({ relevance: 60, importance: asPercent(IMPORTANT_FLOOR), novelty: 70 })),
    );
    const importance = valuesIn(floorStory)[1];
    expect(importance).toBe(`${formatScore(IMPORTANT_FLOOR)} / 10`);
    // One decimal of resolution below the floor is a different number, so the
    // sentence's threshold is the first value that qualifies, not a rounded one.
    const belowFloor = valuesIn(
      scoringCard(
        renderArticle(
          story({ relevance: 60, importance: asPercent(IMPORTANT_FLOOR - 0.1), novelty: 70 }),
        ),
      ),
    )[1];
    expect(belowFloor).toBe("5.9 / 10");
  });
});
