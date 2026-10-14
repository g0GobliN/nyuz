import { describe, expect, it } from "vitest";
import { recoverCardSummary } from "./editorial";
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
});
