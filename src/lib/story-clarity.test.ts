import { describe, expect, it } from "vitest";
import { composeArticleWithDiagnostics } from "./editorial";
import { prevalenceStatistic } from "./reader-evidence";
import type { Story } from "./story";

/**
 * The reader-clarity audit findings this card owns (2026-10-22): blocker 4
 * (I-12, card 09 closes on a clause no reader can parse) and the story-page
 * should-fixes I-13 (a prevalence statistic opening the story) and I-03 (an
 * abbreviation the composer left unexpanded when its sentence-picker dropped
 * the source's own gloss off the page).
 *
 * Every fixture below reproduces a delivered page: the audited quotes are
 * verbatim from `https://nyuz.grgvishal-gurung17.workers.dev/dashboard/story/...`
 * as the audit records them, and the expected copy is what the composer emits
 * on this tree (measured 2026-10-23, and shown red on the pre-fix tree for the
 * two findings the audit scored). No assertion here paraphrases the copy -- a
 * fixed sentence is asserted as a whole, because that is what the reader reads.
 *
 * The card-06 chronology blockers (I-09, I-10, I-11) are owned by the sibling
 * card t_4675d592 (audit 1-3) and are deliberately not fixed or tested here.
 */

const oneSource = (excerpt: string, name = "The Register", title = "A story"): Story => ({
  id: "story-clarity",
  org: name,
  title,
  what: "",
  why: "",
  importance: "Medium",
  score: { relevance: 50, importance: 50, novelty: 50 },
  sources: 1,
  topics: [],
  time: "",
  publishedAt: "2026-09-18T09:00:00Z",
  sourceList: [{ name, at: "", headline: "A story", excerpt }],
  before: "",
  after: "",
  timeline: [],
});

const page = (story: Story): { deck: string; body: string } => {
  const { article } = composeArticleWithDiagnostics(story);
  const paras = article.paragraphs.map((paragraph) => paragraph.text);
  return { deck: article.deck.text, body: paras.join(" ") };
};

describe("a list item that names nothing is dropped; a quotation is never touched (I-12)", () => {
  /** The audited closing sentence of card 09, verbatim. */
  const AUDITED =
    "Two bugs found with AI are behind major issues on 21 October 2026 for 4chan, DeviantArt, Wikipedia, and the blog where the bar around the corner posts pictures of people's dogs.";

  /** The copy the rule publishes instead: the unresolvable example gone, the list rejoined. */
  const REPAIRED =
    "Two bugs found with AI are behind major issues on 21 October 2026 for 4chan, DeviantArt and Wikipedia.";

  it("drops the clause and writes the repaired copy exactly", () => {
    const story = oneSource(
      `${AUDITED} The vulnerabilities let attackers run code on a server without a password. W3Techs, a survey service, says that the PHP programming language is used by “69.3 percent of all the websites whose server-side programming language we know,” including popular sites like Wikipedia and WordPress.`,
    );
    const { deck, body } = page(story);
    expect([deck, body].join(" ")).toContain(REPAIRED);
    expect(deck).not.toContain("bar around the corner");
    expect(body).not.toContain("bar around the corner");
    const { diagnostics } = composeArticleWithDiagnostics(story);
    expect(diagnostics.qualityGate.unresolvableListItems.count).toBe(1);
    // A deletion needs witnesses: the sample carries the before and after text.
    expect(diagnostics.qualityGate.unresolvableListItems.samples[0]).toContain(
      AUDITED.slice(0, 40),
    );
    expect(diagnostics.qualityGate.unresolvableListItems.samples[0]).toContain(
      REPAIRED.slice(0, 40),
    );
  });

  it("leaves the example inside a quotation whole (ruling #6)", () => {
    // Measured 2026-10-23: the first guard compared the openers before the item
    // to the closers after it, and a sentence quoted whole -- whose closing mark
    // sits after the item -- balanced to zero and got rewritten anyway. The joke
    // in somebody's quote is somebody's joke.
    const { deck, body } = page(
      oneSource(
        "The PHP project shipped patched releases on Tuesday after two researchers reported the flaws. " +
          `The engineer wrote: “${AUDITED}”`,
      ),
    );
    expect([deck, body].join(" ")).toContain(
      "the blog where the bar around the corner posts pictures",
    );
    expect([deck, body].join(" ")).not.toContain(REPAIRED);
  });

  it("keeps a named outlet, because a name is resolvable", () => {
    const { deck } = page(
      oneSource(
        "Two bugs found with AI are behind major issues on 21 October 2026 for 4chan, DeviantArt, Wikipedia, and the blog where Pluralistic posts pictures of people's dogs. The PHP project shipped patched releases the next day.",
      ),
    );
    expect(deck).toContain("Pluralistic");
  });

  it("keeps a two-item list, because dropping one leaves a sentence this rule did not write", () => {
    const { deck } = page(
      oneSource(
        "Two bugs found with AI are behind major issues on 21 October 2026 for Wikipedia and the blog where the bar around the corner posts pictures of people's dogs. The PHP project shipped patched releases the next day.",
      ),
    );
    expect(deck).toContain("bar around the corner");
  });
});

describe("what opens the story is the event, not a statistic about its scale (I-13)", () => {
  /** The audited opener of card 09, verbatim. */
  const STATISTIC =
    "W3Techs, a survey service, says that the PHP programming language is used by “69.3 percent of all the websites whose server-side programming language we know,” including popular sites like Wikipedia and WordPress.";

  it("classes an installed-base measure and not a money figure", () => {
    expect(prevalenceStatistic(STATISTIC)).toBe(true);
    // Money is not an installed base.
    expect(prevalenceStatistic("A tie-up worth more than $3 trillion was announced.")).toBe(false);
    // A share with no installed-base domain is an event with a number in it.
    expect(prevalenceStatistic("The bill passed with 60 percent of votes on Tuesday.")).toBe(false);
  });

  it("demotes the statistic to the body when an event can open", () => {
    const { deck, body } = page(
      oneSource(
        `${STATISTIC} Two critical flaws in PHP let attackers run code on servers without a password, the PHP project said on Tuesday.`,
      ),
    );
    expect(deck).toBe(
      "Two critical flaws in PHP let attackers run code on servers without a password, the PHP project said on Tuesday.",
    );
    // Demoted, never deleted: it is good supporting evidence.
    expect(body).toContain("W3Techs");
  });

  it("still lets the statistic open when it is the only thing the page has", () => {
    // The tier demotes among candidates; it never withholds a story.
    const { deck } = page(oneSource(STATISTIC));
    expect(deck).toContain("W3Techs");
  });
});

describe("an abbreviation is expanded with the source's own words (I-03)", () => {
  it("puts the source's adjacency gloss back in front of the bare acronym", () => {
    // The defect (the audit's I-03): the source wrote "operational technology
    // (OT) security experts", the composer's sentence-picker dropped that
    // sentence off the page, and the reader met "perform OT system
    // reconnaissance" with the expansion nowhere on the page. The glossed
    // sentence below carries a raw URL, so the page refuses it and keeps only
    // the bare use -- exactly the delivered shape.
    const pad =
      "the twelve-page briefing described the testing, the vendor response, the disclosure schedule, the mitigation steps, the remaining unknowns, and the follow-up audit https://briefing.example/ten-page-review-and-appendix-that-closed-the-engagement-without-changing-any-findings";
    const story = oneSource(
      "Hackers can gain access to utilities and manufacturing plants and perform OT system reconnaissance far faster than defenders expect. " +
        `Before the patch shipped, ${pad}, and the advice came from operational technology (OT) security experts.`,
    );
    const { deck } = page(story);
    expect(deck).toContain("perform operational technology (OT) system reconnaissance");
    const { diagnostics } = composeArticleWithDiagnostics(story);
    expect(diagnostics.qualityGate.acronymExpansions.count).toBe(1);
  });

  it("never expands the words the reader already owns", () => {
    // AI is not jargon: expanding it writes "artificial intelligence (AI)" into
    // sentences about a subject the reader came to for. The stop-list exists so
    // the rule is not widened later by convenience.
    const story = oneSource(
      "The lab now performs AI target profiling far faster than defenders expect. " +
        "The change came from artificial intelligence (AI) security experts. " +
        "The PHP project shipped patched releases the next day.",
    );
    const { deck, body } = page(story);
    expect([deck, body].join(" ")).toContain("performs AI target profiling");
    const { diagnostics } = composeArticleWithDiagnostics(story);
    expect(diagnostics.qualityGate.acronymExpansions.count).toBe(0);
  });

  it("writes no second gloss when the page already carries the expansion", () => {
    const { deck } = page(
      oneSource(
        "According to operational technology (OT) security experts, hackers can perform OT reconnaissance faster than defenders expect. The PHP project shipped patched releases the next day.",
      ),
    );
    expect(deck).toContain("perform OT reconnaissance");
    expect(deck).not.toContain("operational technology (OT) system");
  });
});
