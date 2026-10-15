import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_FEEDBACK, type FeedbackState } from "@/lib/feedback-store";
import { admissibleReaderSentence } from "@/lib/reader-evidence";
import { STORIES } from "@/lib/sample-data";
import type { Story } from "@/lib/story";
import { cardSummaryRefused } from "@/lib/understand";
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

    /**
     * The arbiter's ruling of 2026-10-15, option 1. Measured on 679 live card
     * lines: 24 were printing text the shared sentence boundary refuses -- a
     * description truncated with an ellipsis, a commit record carrying its
     * author's email, a raw media payload, marketing copy, an unsupported
     * attribution, an unattributed quotation. Every one failed on its first
     * sentence, so none of it was an artefact of asking a sentence question of a
     * block. The card asks that boundary now, before rendering.
     */
    it("recovers instead of printing a line the shared sentence boundary refuses", () => {
      const COMMIT =
        "Ggml: simplify backend search path error handling (#28367) Signed-off-by: Adrien Gallouët angt@huggingface.co.";
      const MARKETING =
        "Learn how Google DeepMind and GovTech Singapore uses lightweight on-device Gemma models to intercept conversational scams in private chats with zero cloud data egress.";
      for (const stored of [COMMIT, MARKETING]) {
        expect(admissibleReaderSentence(stored)).toBe(false);
        const html = render(withSource(stored, OPENING));
        expect(html).toContain("Even projects that have been enrolled in OSS-Fuzz");
        expect(html).not.toContain(stored.slice(0, 30));
      }
    });

    it("recovers for a description a provider truncated, rather than printing it", () => {
      // Truncation is a refusal like the others, so it takes the same remedy:
      // the card prints the story's own opening sentence, never the sentence the
      // provider cut off mid-thought.
      const TRUNCATED =
        "FreeType 2.15 is now available for this widely-used font rendering library used across many different operating systems and software applications...";
      const html = render(withSource(TRUNCATED, OPENING));
      expect(html).not.toContain("software applications");
      expect(html).toContain("Even projects that have been enrolled in OSS-Fuzz");
    });

    it("keeps the furniture path withholding, and never composes for it", () => {
      // The one class that keeps its own behaviour: a stored line that is
      // provider furniture is withheld without composing anything, even though
      // the story has an opening sentence available.
      const html = render(withSource("Photograph: Alexandra Topping/The Guardian.", OPENING));
      expect(html).not.toContain("Photograph: Alexandra Topping");
      expect(html).not.toContain("OSS-Fuzz");
    });

    it("withholds the line when a refused summary has nothing valid to recover", () => {
      const RAW_MARKUP =
        '@avstorm via X" data-has-syndication-rights="1" src="https://platform.theverge.com/wp-content/uploads/sites/2/2026/10/apple-music-new-old-icon.jpeg? quality=90&strip=all" />.';
      expect(admissibleReaderSentence(RAW_MARKUP)).toBe(false);
      const html = render(withSource(RAW_MARKUP, ""));
      expect(html).not.toContain("data-has-syndication-rights");
      expect(html).toContain(base.title);
    });

    it("does not print a stored publisher byline, and recovers the story's opening", () => {
      // The byline gap the ruling refused to count as closed by assertion. The
      // card's own two classes do not refuse this string -- measured -- so the
      // shared furniture boundary is what closes the path, and this test fails
      // if that check is removed, because the fast path would print it.
      const BYLINE = "Sayem Ahmed is the Subscription Editor at Tom's Hardware.";
      expect(cardSummaryRefused(BYLINE)).toBe(false);
      expect(admissibleReaderSentence(BYLINE)).toBe(false);
      const html = render(withSource(BYLINE, OPENING));
      expect(html).not.toContain("Subscription Editor");
      expect(html).toContain("Even projects that have been enrolled in OSS-Fuzz");
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
