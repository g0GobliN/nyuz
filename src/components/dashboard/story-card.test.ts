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
