import { describe, expect, it } from "vitest";
import { recoverCardSummary } from "./editorial";
import {
  admissibleReaderSentence,
  publisherFurniture,
  unitTextRejection,
  unresolvedContextOpening,
} from "./reader-evidence";
import type { Story } from "./story";
import { briefingText, cardSummaryRefused } from "./understand";

/**
 * The card surface must not have a weaker standard than the story page.
 *
 * Read on the deployed origin (2026-10-14): the story page for 7af726e6 opened
 * on its real first sentence with the list item gone from the body, while the
 * dashboard card for the same story printed that item as its summary line. The
 * card reads the stored event summary (`story.what`, written from a feed
 * description) through `briefingText`, which never asked the deck predicate.
 *
 * The arbiter ruled (2026-10-14) option 2: reuse `noMainClause` at the card
 * boundary, lazily compose the story when the stored line is refused, print the
 * opening sentence the article actually published, and withhold the line when
 * nothing valid can be recovered. The classification stays separate from
 * `sourceFurnitureHead` and the predicate is not widened for this surface.
 */

/** The stored summary of the live story, verbatim. */
const LIST_ITEM =
  "A set of taskflow YAMLs, one per stage, which are essentially the prompts that tell the LLM agent what to do at each step.";

/** The first published block of the same story, verbatim from the live page. */
const ARTICLE_OPENS =
  "Even projects that have been enrolled in OSS-Fuzz for years can still hide critical bugs, and the reason is almost always the same: coverage drifts and nobody is watching it.";

/** The part of that block the composer publishes unchanged; it adds the attribution after it. */
const OPENING_PREFIX =
  "Even projects that have been enrolled in OSS-Fuzz for years can still hide critical bugs";

const story = (what: string, excerpt: string, name = "GitHub"): Story => ({
  id: "card-summary",
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

describe("the card asks the predicate the story page already asks", () => {
  it("refuses the live stored summary, which the card was publishing", () => {
    // The defect, exactly: the predicate refuses it and the card's fast path
    // printed it anyway. Both halves are pinned so neither can regress alone.
    expect(cardSummaryRefused(LIST_ITEM)).toBe(true);
    expect(briefingText(LIST_ITEM)).toBe(LIST_ITEM);
  });

  it("leaves a complete stored summary to the fast path", () => {
    const complete =
      "Negotiators walked out after midnight, then returned to the table before morning briefings went out.";
    expect(cardSummaryRefused(complete)).toBe(false);
    expect(briefingText(complete)).toBe(complete);
  });

  it("leaves the furniture path alone, because it already has its own behaviour", () => {
    // A feed description that was furniture is withheld by `normalizeSummary`
    // before this predicate is reached, and the card already prints no summary
    // for it. Reporting it here as well would reclassify a refusal that is
    // already counted, which is what the ruling's "no new reason string" means.
    // The fixture `understand.test.ts` already pins as provider furniture.
    const furniture = "Photograph: Alexandra Topping/The Guardian.";
    expect(cardSummaryRefused(furniture)).toBe(false);
    expect(briefingText(furniture)).toBe("");
  });

  it("records the TCP/IP line as a false positive of the predicate, not as its catch", () => {
    // The arbiter ruled that this stored line "has one [main clause]" and that
    // `noMainClause` should not be widened to catch it. Measured, the shipped
    // predicate does refuse it -- the comma-set relative clause is read as the
    // only predicate, because the main clause's verb is the contraction "There's".
    // The line is still a defective card: "that" has no antecedent on the card.
    // So it is pinned here as an observed false positive of the predicate, and
    // the real defect (an unresolved reference in standalone card prose) stays a
    // separate, open class rather than being counted as solved by this slice.
    const tcpip =
      "There's not much of that and not much by way of standards, which is why a young programmer is rather excited by an emerging contender called TCP/IP.";
    expect(cardSummaryRefused(tcpip)).toBe(true);
    // Recovery contains it: the card prints the article's opening instead of a
    // line the reader cannot resolve. That is containment, not a fix.
    const out = recoverCardSummary(story(tcpip, ARTICLE_OPENS));
    expect(out).toContain(OPENING_PREFIX);
    expect(out).not.toContain("not much of that");
  });
});

describe("recovery prints the sentence the article actually published", () => {
  it("recovers the opening published block and never the refused text", () => {
    // The published block arrives with the attribution the composer adds
    // ("…, according to GitHub."), which is the point: this is the story page's
    // own sentence, not the stored summary reworded.
    const out = recoverCardSummary(story(LIST_ITEM, ARTICLE_OPENS));
    expect(out).toContain(OPENING_PREFIX);
    expect(out).toMatch(/according to GitHub\./);
    expect(out).not.toMatch(/taskflow YAMLs/);
  });

  it("withholds when the story publishes nothing usable", () => {
    // No source text at all, and a stored line the predicate refuses: the card
    // prints its headline and sources and no summary. It never composes twice,
    // and it never falls back to prose chosen because it reads well.
    expect(recoverCardSummary(story(LIST_ITEM, ""))).toBe("");
  });

  it("never returns a block the deck predicate itself refuses", () => {
    // A story whose only published block would be a fragment again: the card
    // withholds rather than printing the same class of text it just refused.
    const out = recoverCardSummary(story(LIST_ITEM, LIST_ITEM));
    expect(out === "" || !cardSummaryRefused(out)).toBe(true);
  });

  it("refuses to recover a line the shared sentence boundary refuses", () => {
    // The arbiter's hold on the card-context slice (2026-10-14): recovery "must
    // participate in the shared validation boundary", because without it a
    // refused card line recovered straight into a byline. Measured on the live
    // window before the furniture rule learned the copular shape: recovery for
    // the "While the figure on its surface sounds significant …" card returned
    // the masthead line below, verbatim, as the card's summary.
    const BYLINE = "Sayem Ahmed is the Subscription Editor at Tom's Hardware.";
    expect(publisherFurniture(BYLINE)).toBe(true);
    expect(unitTextRejection(BYLINE, false)).toBe("editorial_noise");
    expect(admissibleReaderSentence(BYLINE)).toBe(false);
    // The gap this closes is real and still measured: the byline is *not*
    // refused by the card's own two classes, so `briefingText` would print it
    // unchanged if it ever arrived as a stored summary, and only the shared
    // boundary in `recoverCardSummary` stands between the two.
    expect(briefingText(BYLINE)).toBe(BYLINE);
    expect(cardSummaryRefused(BYLINE)).toBe(false);
    // A story whose published opening is the byline recovers nothing at all.
    expect(recoverCardSummary(story(BYLINE, BYLINE))).toBe("");
  });
});

describe("the card refuses a reference the reader cannot resolve on the card", () => {
  /** Live stored summaries, verbatim, from the 2026-10-15 window. */
  const PAPER_ABSTRACT =
    "These results establish credal geometry as a principled framework for quantifying conformal uncertainty and understanding its limitations.";
  const PAPER_OPENS = "Prediction-set size offers a coarse summary of conformal uncertainty.";
  const FRONTED =
    "While the figure on its surface sounds significant, the estimated lease price is around 43% less than an Nvidia H100 leased at $2.80 per hour on a one-year contract.";
  /** Live, and resolvable — but only by the headline above it. */
  const HEADLINE_RESOLVED =
    "Neither Egypt nor Sudan has commented on the alleged strikes on an artisanal mining camp on Saturday.";

  it("refuses the shared context predicate, and it does not replace the deck test", () => {
    // One definition, already exported: `contextDependent && !recoverableContext`.
    // The card reads a line on its own, so a demonstrative or a fronted clause
    // whose antecedent is not on the card is refused here -- while the article
    // body keeps allowing references the paragraph above establishes.
    expect(unresolvedContextOpening(PAPER_ABSTRACT)).toBe(true);
    expect(unresolvedContextOpening(FRONTED)).toBe(true);
    expect(cardSummaryRefused(PAPER_ABSTRACT)).toBe(true);
    expect(cardSummaryRefused(FRONTED)).toBe(true);
    // The deck class is unchanged and still fires on its own fixture.
    expect(cardSummaryRefused(LIST_ITEM)).toBe(true);
    // And a line whose referent is on it stays on the fast path.
    const complete =
      "Negotiators walked out after midnight, then returned to the table before morning briefings went out.";
    expect(cardSummaryRefused(complete)).toBe(false);
  });

  it("recovers the paper's own opening rather than the abstract's self-reference", () => {
    const out = recoverCardSummary(story(PAPER_ABSTRACT, PAPER_OPENS));
    expect(out).toContain("Prediction-set size offers a coarse summary of conformal uncertainty");
    expect(out).not.toMatch(/^These results/);
  });

  it("drops a description a provider truncated, before any boundary has to", () => {
    // The arbiter's ruling of 2026-10-15 extended `isCutSentence` for exactly
    // this: ten of the 24 measured card lines were a feed description truncated
    // with an ellipsis, and the card's own cut test read the ellipsis as a full
    // stop. The required outcome is that they "no longer reach readers through
    // the card summary", and the card holds nothing back by dropping them --
    // the stored line is not the story, and the next test recovers one.
    const truncated = [
      "FreeType 2.15 is now available for this widely-used font rendering library used across many different operating systems and software applications...",
      "With Firefox 158 released, Firefox 159 is now in beta ahead of its official release in two weeks...",
    ];
    for (const line of truncated) {
      expect(briefingText(line), line).toBe("");
      expect(admissibleReaderSentence(line), line).toBe(false);
    }
    // A complete multi-sentence block that merely ends its last sentence in an
    // ellipsis keeps everything before it: the cut sentence goes, the block does
    // not.
    const mixed =
      "The council approved the plan on Tuesday. Members then adjourned ahead of the budget vote...";
    expect(briefingText(mixed)).toBe("The council approved the plan on Tuesday.");
  });

  it("refuses every other shape of the measured set, recovery intact", () => {
    // One per shape, verbatim from the live window. These are the lines the
    // shared sentence boundary refuses while the card's own two classes do not,
    // so this is the class the 2026-10-15 option-1 ruling is about.
    const shapes = [
      // A commit record carrying its author's email, on a card whose own
      // headline was often the commit sha.
      "Ggml: simplify backend search path error handling (#28367) Signed-off-by: Adrien Gallouët angt@huggingface.co.",
      // A raw media payload.
      '@avstorm via X" data-has-syndication-rights="1" src="https://platform.theverge.com/wp-content/uploads/sites/2/2026/10/apple-music.jpeg" />.',
      // Marketing copy addressed to the reader.
      "Learn how Google DeepMind and GovTech Singapore uses lightweight on-device Gemma models to intercept conversational scams in private chats with zero cloud data egress.",
      // A claim resting on an unnamed collective.
      "Experts say there is no evidence that Russian trolls have been affected by Ukraine's Yandex attacks.",
      // A quotation whose speaker is not named.
      '"Not a single drop has come through our taps for the last three months," a local tells the BBC.',
    ];
    for (const shape of shapes) {
      expect(briefingText(shape), shape).not.toBe("");
      expect(admissibleReaderSentence(shape), shape).toBe(false);
      // The remedy is the existing one: recover, or withhold. Never the refused
      // text, and never a line that is itself refused.
      const recovered = recoverCardSummary(story(shape, PAPER_OPENS));
      expect(recovered === "" || !cardSummaryRefused(recovered), shape).toBe(true);
      expect(recovered, shape).not.toContain(shape.slice(0, 30));
    }
  });

  it("records the headline-resolved line as a false positive of the predicate", () => {
    // The line *is* resolvable -- by the headline above it -- and
    // `recoverableContext` reads the line alone, so it does not recognise that.
    // The verdict stands (the ruling rejected a headline-resolution check as
    // "another unvalidated rule") and recovery contains it. Containment is not
    // proof that the classification was correct, so it is pinned as a false
    // positive rather than counted as a catch.
    expect(cardSummaryRefused(HEADLINE_RESOLVED)).toBe(true);
    const out = recoverCardSummary(
      story(HEADLINE_RESOLVED, "At least 72 civilians have been killed."),
    );
    expect(out).not.toContain("Neither Egypt nor Sudan");
  });
});
