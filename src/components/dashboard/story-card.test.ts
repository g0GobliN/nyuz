import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_FEEDBACK, type FeedbackState } from "@/lib/feedback-store";
import { STORIES } from "@/lib/sample-data";
import type { Story } from "@/lib/story";
import { StoryCard } from "./story-card";

/**
 * The card's links need a running router; this file is about the card's own
 * text, so the router stands in as a plain anchor.
 */
vi.mock("@tanstack/react-router", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: (props: { children?: unknown }) => h("a", { href: "#" }, props.children as never),
  };
});

/**
 * The arbiter's ruling of 2026-10-09: the follow line stays, but it must never
 * be mistaken for a significance statement. The card therefore prints the
 * briefing's fact about the story under "Why it matters" and the reader's own
 * follow graph under "Why you're seeing this" — and a card with no significance
 * line keeps the provenance note without the heading standing empty above it.
 */
describe("StoryCard — significance vs provenance", () => {
  const base = STORIES[0]!;
  const noop = () => undefined;

  /** Markup escaped by React, so the assertions read as text does. */
  const render = (
    story: Story,
    matched: string[] = [],
    feedback: FeedbackState = EMPTY_FEEDBACK,
    saveError?: string,
  ): string =>
    renderToStaticMarkup(
      createElement(StoryCard, {
        story,
        matched,
        index: 0,
        feedback,
        onVote: noop,
        onSave: noop,
        saveError,
        onDismiss: noop,
        onMute: noop,
      }),
    ).replace(/&#x27;/gu, "'");

  it("prints the significance line under its own heading, provenance separately", () => {
    const html = render({ ...base, why: "The story carries a $40 billion figure." }, [
      "AI",
      "NVIDIA",
    ]);
    expect(html).toContain("Why it matters");
    expect(html).toContain("The story carries a $40 billion figure.");
    expect(html).toContain("Why you're seeing this · ");
    expect(html).toContain("You follow AI and NVIDIA.");
  });

  it("keeps provenance alone when there is no significance line", () => {
    const html = render({ ...base, why: "" }, ["Cybersecurity"]);
    expect(html).not.toContain("Why it matters");
    expect(html).toContain("Why you're seeing this · ");
    expect(html).toContain("You follow Cybersecurity.");
  });

  it("prints no heading when there is neither claim to make", () => {
    const html = render({ ...base, why: "" });
    expect(html).not.toContain("Why it matters");
    expect(html).not.toContain("Why you're seeing this");
  });

  it("keeps the headings apart through the card's interactive states", () => {
    // Saved, voted, muted, unsaveable; a single source shedding its chip; and
    // a story whose feed summary was furniture, which prints its headline and
    // its sources instead of a credit. A silent significance slot stays silent
    // in every one of them.
    const saved = render(
      { ...base, what: "", sources: 1, why: "" },
      [],
      {
        ...EMPTY_FEEDBACK,
        saved: [base.id],
        votes: { [base.id]: "useful" },
        mutedTopics: [base.topics[0]!],
      },
      "We couldn't save that. Try again.",
    );
    expect(saved).toContain("Saved");
    expect(saved).toContain("Useful");
    expect(saved).toContain("We couldn't save that. Try again.");
    expect(saved).not.toContain("Why it matters");
    expect(saved).not.toContain("1 source → 1 event");

    const downvoted = render({ ...base, why: "", sources: 5, topics: [] }, [], {
      ...EMPTY_FEEDBACK,
      votes: { [base.id]: "not-useful" },
    });
    expect(downvoted).toContain("Not useful");
    expect(downvoted).toContain("1 event");
    expect(downvoted).not.toContain("Mute ");
  });

  /**
   * Two sources answer the same question and they are not equivalent. The
   * server's answer comes from the reader's real follow graph — the event
   * reached them through their own subscriptions — so it wins over the client's
   * guess from the topics attached to the card.
   */
  /**
   * The card must not have a weaker standard than the story page behind it.
   *
   * Read on the deployed origin (2026-10-14): the story page for 7af726e6 opened
   * on its real first sentence with the source's list item withheld from the
   * body, while this card printed that item as its summary line. The card reads
   * the stored event summary and never asked the deck predicate; the arbiter
   * ruled option 2 -- reuse the predicate here, recover the article's own opening
   * sentence when the stored line is refused, and withhold the line when there is
   * nothing valid to recover.
   */
  describe("StoryCard — a refused stored summary", () => {
    const LIST_ITEM =
      "A set of taskflow YAMLs, one per stage, which are essentially the prompts that tell the LLM agent what to do at each step.";
    const OPENING =
      "Even projects that have been enrolled in OSS-Fuzz for years can still hide critical bugs, and the reason is almost always the same: coverage drifts and nobody is watching it.";
    const withSource = (what: string, excerpt: string): Story => ({
      ...base,
      what,
      sourceList: [{ name: "GitHub", at: "18:26", headline: "Taskflow", excerpt }],
    });

    it("prints the story's own opening sentence instead of the refused line", () => {
      const html = render(withSource(LIST_ITEM, OPENING));
      expect(html).toContain("Even projects that have been enrolled in OSS-Fuzz");
      expect(html).not.toContain("taskflow YAMLs");
    });

    it("prints no summary line when there is nothing valid to recover", () => {
      // The card keeps its headline and its sources; it never invents a line and
      // it never prints the refused one.
      const html = render(withSource(LIST_ITEM, ""));
      expect(html).not.toContain("taskflow YAMLs");
      expect(html).toContain(base.title);
    });

    it("publishes an ordinary stored summary unchanged", () => {
      const ordinary =
        "Negotiators walked out after midnight, then returned to the table before morning briefings went out.";
      const html = render(withSource(ordinary, OPENING));
      expect(html).toContain("Negotiators walked out after midnight");
      expect(html).not.toContain("OSS-Fuzz");
    });
  });

  it("prefers the server's provenance over the client's guess from topics", () => {
    const follow = { heading: "Why you're seeing this", explanation: "You follow OpenAI." };

    const both = render(
      { ...base, why: "Analysts expect a pricing change.", personalization: follow },
      ["AI", "NVIDIA"],
    );
    expect(both).toContain("You follow OpenAI.");
    expect(both).not.toContain("You follow AI and NVIDIA.");
    expect(both).toContain("Why it matters");

    // Same answer with no client topics at all: the note still arrives, because
    // it never depended on them.
    const alone = render({ ...base, why: "", personalization: follow });
    expect(alone).toContain("Why you're seeing this · ");
    expect(alone).toContain("You follow OpenAI.");
    expect(alone).not.toContain("Why it matters");
  });
});
