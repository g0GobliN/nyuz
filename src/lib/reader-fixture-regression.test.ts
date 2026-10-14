import { describe, expect, it } from "vitest";
import { composeArticle, composeArticleWithDiagnostics } from "./editorial";
import { selectEvidenceUnits } from "./pipeline/evidence-extract";
import { extractMainText } from "./pipeline/html-text";
import { decodeEntities, hasSourceMetadata, hasVisibleEntity } from "./pipeline/source-text";
import {
  selectReaderEvidence,
  unresolvedContextOpening,
  validDeterministicParagraph,
} from "./reader-evidence";
import type { Story } from "./story";

/**
 * The production story, published as reordered source excerpts.
 *
 * The headline is The Register's, and the body was built from one article in one
 * source, which is exactly the case that used to go wrong: the composer ranked
 * the article's sentences by relevance, so the reader met the survey, then an
 * agent escape, then a German website, then the mechanism, then a customer quote,
 * and had to reconstruct the piece themselves. Each fragment below is the text
 * that reached readers, and each assertion is either about one of them or about
 * the structure that produced it.
 *
 * Deliberately not a snapshot of prose. The assertions are:
 *
 *  - the fragments that shipped are gone, because each is a specific defect with
 *    a named cause (entity leak, headline fragment, ungrammatical attribution,
 *    source colour, unresolvable pronoun, source-name double space);
 *  - the facts are still there, and in the order the article itself put them in;
 *  - every published block is traceable, and nothing is published that the
 *    source did not supply.
 */

const HEADLINE = "Who signed off on that AI agent? Nobody? Thought so.";

/**
 * The article as the feed and the page supplied it -- including the defects, at
 * the boundary where they entered: a standfirst, a media-clean sentence with an
 * entity escaped twice, a `goblin mode` aside, a fronted clause with a pronoun
 * subject, a survey, and quotes.
 */
const EXCERPT = [
  // The standfirst, as the ingest boundary now supplies it: `htmlToText` closes a
  // heading element, so a heading and the sentence after it arrive as two units
  // and the heading is refused as its own unit. The seam is not the composer's
  // to find -- a rule that looked for one in plain text cut a real subject out of
  // a real sentence ("MariaDB with PostgreSQL for the same task, however, it had
  // plenty to say.") and had no instance in the frozen corpus where it helped.
  "Why identity built for humans breaks at agent speed.",
  "Perhaps predictably for a company that built its success on automated verification, DigiCert doesn't see agent management as a manual problem.",
  // An entity escaped twice: `&amp;#x20;` decodes once to `&#x20;`, which is not
  // whitespace and therefore survived every collapse downstream.
  "DigiCert&amp;#x20;published its AI Trust Pulse survey this month.",
  // The incident, as a neutral sentence -- no colour in it, so it is published.
  "In July, an autonomous swarm of OpenAI agents running in a sandbox broke out of it and used exposed Hugging Face credentials to reach a code-execution service.",
  // The same incident with the source's own joke in it, which is dropped rather
  // than repaired: no deterministic rewrite lifts the fact out of the metaphor.
  "Once they were out in the wild, they went into full goblin mode, finding exposed JFrog Artifactory credentials.",
  // A fronted clause whose main clause subject is a pronoun pointing outside the
  // sentence.
  "Tasked with solving some challenges on an internal security benchmark, they worked out how to communicate with each other.",
  // Source colour again, in the flavour a security desk likes.
  "The same pattern turned up in a series of SNAFUs at a German hosting provider.",
  // The survey, with its owner, sample and population intact.
  "Three quarters of the 1,001 IT and cybersecurity decision-makers in DigiCert's 2026 AI Trust Pulse survey said they had deployed at least four AI-powered systems in the previous six months.",
  "Only half could trace AI decisions back to the models and data that produced them.",
  // A quotation with a speaker, which is worth keeping.
  '"We haven\'t even started to attack the governance problem," Chauhan said.',
  // A quotation with no speaker, which is not.
  '"But visibility into how many agents I have? How many models do I have?"',
  // The governance implication, stated plainly.
  "There must still be a human in the loop for the decisions that carry real consequences.",
].join(" ");

const story = (): Story => ({
  id: "register-ai-agent-governance",
  // The stored source name, with the double space that The Register's own RSS
  // produces by escaping its space -- and which used to reach the page inside
  // every attribution built from this source.
  org: "The Register",
  title: HEADLINE,
  what: "",
  why: "",
  importance: "High",
  score: { relevance: 80, importance: 80, novelty: 60 },
  sources: 1,
  topics: ["AI", "Cybersecurity"],
  time: "",
  publishedAt: "2026-09-18T09:00:00Z",
  sourceList: [
    { name: "The  Register", at: "", url: "https://www.theregister.com/", excerpt: EXCERPT },
  ],
  before: "",
  after: "",
  timeline: [],
});

const composed = () => {
  const { article, diagnostics } = composeArticleWithDiagnostics(story());
  return {
    article,
    diagnostics,
    blocks: [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)].filter(
      (block) => block !== "",
    ),
    text: [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)].join(" "),
  };
};

/** The text as it reaches the reader, whitespace collapsed as the page collapses it. */
const rendered = () => composeArticle(story());

/**
 * The references themselves, one test each, because the production leak was a
 * *hex* reference inside a description field that had been escaped twice: the
 * decoders had handled decimal and the named set, and nothing handled `&#x20;`
 * after the second escaping pass. Every case the user listed is here.
 */
describe("one plain-text decoder, used before anything reads the text", () => {
  it.each([
    ["&#x20;", " "],
    ["&#X20;", " "],
    ["&#32;", " "],
    ["&nbsp;", " "],
    ["&amp;", "&"],
    ["&#39;", "'"],
    ["&apos;", "'"],
    ["&quot;", '"'],
    ["&#x2019;", "’"],
    ["&#8212;", "—"],
  ])("decodes %s", (input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });

  it("decodes a reference that was escaped twice", () => {
    expect(decodeEntities("DigiCert&amp;#x20;published")).toBe("DigiCert&#x20;published");
  });

  it("leaves text that only looks like a reference", () => {
    expect(decodeEntities("AT&T and R&D; and a<b>")).toBe("AT&T and R&D; and a<b>");
  });

  it("leaves no reference visible for a reader to find", () => {
    for (const text of ["&#x20;", "&nbsp;", "&amp;", "&#39;", "&quot;", "&#32;", "&#x2019;"]) {
      expect(hasVisibleEntity(decodeEntities(text))).toBe(false);
    }
    expect(hasVisibleEntity("&#x20;")).toBe(true);
  });

  it("turns the entity into a space the text can collapse", () => {
    // The order that matters: decode, then collapse. Collapsing first leaves
    // `&#x20;` in place -- it is not whitespace to `\s` -- and the reader sees
    // the characters instead of the space.
    const text = "DigiCert&#x20;said" + "&#x20;so";
    expect(decodeEntities(text).replace(/\s+/g, " ")).toBe("DigiCert said so");
  });
});

describe("the production story: what must never be published again", () => {
  it("publishes no HTML reference of any kind", () => {
    const { text, blocks } = composed();
    expect(text).not.toContain("&#x20;");
    expect(text).not.toMatch(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,9});/i);
    for (const block of blocks) expect(hasVisibleEntity(block)).toBe(false);
  });

  it("does not open with the source's standfirst", () => {
    const { text } = composed();
    expect(text).not.toContain("According to The Register, Why identity built for humans");
    expect(text).not.toContain("Why identity built for humans breaks at agent speed Perhaps");
    // The thesis itself is a real sentence and survives without its wrapper.
    expect(text).toContain("DigiCert doesn't see agent management as a manual problem");
  });

  it("opens on the fact, not on the source's comment about it", () => {
    const { article, diagnostics } = composed();
    // "Perhaps predictably" is the adverbial and "for a company that built its
    // success on automated verification" is the frame under it; both are the
    // publication talking about its own point. The deck is what is left.
    expect(article.deck.text).not.toMatch(/for a company that built its success/i);
    expect(article.deck.text).not.toMatch(/Perhaps predictably/i);
    expect(article.deck.text).toBe("DigiCert doesn't see agent management as a manual problem.");
    expect(diagnostics.sourceNormalization.strippedFrames).toBeGreaterThanOrEqual(1);
    // Counted rewrites carry a before/after example, so a reviewer can check the
    // rule rather than trust the number.
    expect(diagnostics.sourceNormalization.samples.frames.length).toBeGreaterThanOrEqual(1);
  });

  it("leaves no date that only meant something on the day it was written", () => {
    const { text, diagnostics } = composed();
    // The story is dated 2026-09-18: "this month" is September 2026, and a
    // sentence with a week in it -- which cannot be anchored -- is refused.
    expect(text).not.toMatch(/\bthis month\b/i);
    expect(text).toContain("in September 2026");
    expect(diagnostics.sourceNormalization.relativeTimesAnchored).toBeGreaterThanOrEqual(1);
  });

  it("never glues an attribution to a clause it cannot introduce", () => {
    const { text } = composed();
    expect(text).not.toContain("The Register reports that Once");
    expect(text).not.toContain("The Register reports that Only");
    expect(text).not.toMatch(/\breports? that\s*[A-Z][a-z]+\b/);
    expect(text).not.toMatch(/\breports? that\s*["“]/);
    // The statements themselves are kept, lower-cased into the reported clause:
    // "reports that only half could trace..." is a sentence with a subject.
    expect(text).not.toMatch(/reports that [A-Z]/);
    // And the publication is not the claimant of a number it did not measure.
    expect(text).not.toMatch(/The Register reports that only half/i);
  });

  it("attributes a statistic to the survey that made it", () => {
    const { text, diagnostics } = composed();
    // "Only half could trace AI decisions..." names nobody. DiGiCert ran the
    // survey, so DiGiCert's survey is the claimant -- crediting The Register
    // would hand a magazine the result of 1,001 interviews it never ran.
    expect(text).toMatch(/According to DigiCert's 2026 AI Trust Pulse survey, only half/);
    expect(diagnostics.attribution["according_to_survey"]).toBeGreaterThanOrEqual(1);
  });

  it("drops source colour rather than paraphrasing it", () => {
    const { text } = composed();
    expect(text).not.toMatch(/goblin mode/i);
    expect(text).not.toMatch(/SNAFUs?/i);
    expect(text).not.toMatch(/Perhaps predictably/i);
    expect(text).not.toMatch(/while everyone else was on vacation/i);
  });

  it("refuses a sentence whose subject is not in it", () => {
    const { text } = composed();
    expect(text).not.toContain("Both saw agents");
    expect(text).not.toContain("Tasked with solving some challenges");
    for (const block of composed().blocks) expect(unresolvedContextOpening(block)).toBe(false);
  });

  it("does not repeat the story's own source name in the prose", () => {
    const { text } = composed();
    // The rule is about the *malformed* name, not the name: The Register's own RSS
    // escapes its space, so the stored string is `The  Register` (two spaces).
    // The citation already identifies the source, so neither spelling belongs
    // in the prose as a redundant attribution.
    expect(text).not.toContain("The  Register");
    expect(text).not.toMatch(/The\s+Register&#/);
    expect(text).not.toContain("According to The Register");
  });

  it("leaves no spacing seam and no stray reference behind", () => {
    const { text } = composed();
    expect(text).not.toMatch(/ {2}/);
    expect(text).not.toMatch(/\s+[.,]/);
  });
});

describe("the production story: what a reader must still be able to find", () => {
  it("states the governance thesis", () => {
    const { text } = composed();
    expect(text).toMatch(/agent management as a manual problem|identity built for humans/i);
  });

  it("keeps the survey, its owner, its sample and its population", () => {
    const { text } = composed();
    expect(text).toMatch(/DigiCert/);
    expect(text).toMatch(/AI Trust Pulse survey/);
    expect(text).toContain("1,001 IT and cybersecurity decision-makers");
    expect(text).toMatch(/Three quarters|three quarters/);
  });

  it("keeps a concrete agent incident, with the numbers that make it concrete", () => {
    const { text } = composed();
    expect(text).toContain("Hugging Face");
    expect(text).toMatch(/autonomous swarm of OpenAI agents|OpenAI agents/);
  });

  it("does not present a survey result as universal truth", () => {
    const { text } = composed();
    // The measured population is in the same sentence as the number, or the
    // sentence carries its own attribution -- never a bare "Three quarters ...".
    const sentence = text.split(/(?<=[.!?])\s+/).find((part) => /three quarters/i.test(part)) ?? "";
    expect(sentence).toMatch(/survey|DigiCert|decision-makers/i);
  });

  it("keeps the human-oversight conclusion", () => {
    const { text } = composed();
    expect(text).toMatch(/human in the loop/i);
  });

  it("keeps the quote with its speaker and drops the one without", () => {
    const { text } = composed();
    expect(text).toMatch(/governance problem/);
    expect(text).toMatch(/Chauhan said|said Chauhan/);
    // The floor for what "meets the bar" here is not style: a reader must be able
    // to attribute every sentence to somebody.
    expect(text).not.toMatch(/^["“]|^\s*["“]/m);
  });
});

describe("the production story: structure the reader depends on", () => {
  it("reads the article in the order the article was written", () => {
    const { text, diagnostics } = composed();
    expect(diagnostics.ordering).toBe("narrative");
    // The article's own order: the thesis, then the incident, then the survey
    // that measures it, then the governance conclusion. Anchor on the survey's
    // *result* rather than its name, because the article mentions the survey
    // before the incident as well.
    const positions = [
      "DigiCert doesn't see agent management",
      "Hugging Face",
      "survey said they had deployed",
      "human in the loop",
    ].map((needle) => text.indexOf(needle));
    for (const [index, position] of positions.entries()) {
      expect(position, `anchor ${index} is published`).toBeGreaterThanOrEqual(0);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("publishes paragraphs, not a pile of ranked sentences", () => {
    const { article } = composed();
    expect(article.paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of article.paragraphs) {
      expect(validDeterministicParagraph(paragraph.text)).toBe(true);
    }
    expect(hasSourceMetadata(article.deck.text)).toBe(false);
  });

  it("keeps provenance on every block and cites one source once", () => {
    const { article } = composed();
    expect(article.deck.evidence).toEqual([1]);
    for (const paragraph of article.paragraphs) {
      expect(paragraph.evidence).toEqual([1]);
      expect(new Set(paragraph.evidence).size).toBe(paragraph.evidence.length);
    }
  });

  it("accounts for every fact it selected", () => {
    const { diagnostics } = composed();
    expect(diagnostics.facts.selected).toBeGreaterThan(3);
    // Published, or refused with a reason. `lost` is the counter reserved for
    // "selected, valid, and published nowhere", so it has to read zero.
    expect(diagnostics.facts.selected).toBe(diagnostics.facts.rendered + diagnostics.facts.refused);
    expect(diagnostics.facts.lost).toBe(0);
  });

  it("counts what it dropped instead of dropping it silently", () => {
    const { diagnostics } = composed();
    // Both `goblin mode` sentences, the fronted-clause fragment and the SNAFUs
    // aside were refused upstream; the counts say so.
    expect(diagnostics.sourceNormalization.sourceColourRejections).toBeGreaterThanOrEqual(2);
    // The standfirst is refused as furniture -- a unit that is nothing but a
    // heading, caught before the lead is chosen out of it -- not cut out of the
    // sentence that follows it, and the refusal is counted where a cut was. The
    // clause-shape test is what keeps this a refusal: the wh-word list that used
    // to sit here also refused 16 real sentences in the frozen corpus, and when
    // it was deleted this string published as the deck.
    expect(diagnostics.facts.selected).toBeGreaterThan(0);
    expect(
      selectReaderEvidence(story().title, story().sourceList).rejectionReasons.headline_fragment,
    ).toBe(1);
    expect(diagnostics.sourceNormalization.sourceVoiceStripped).toBeGreaterThanOrEqual(1);
    expect(diagnostics.sourceNormalization.strippedFrames).toBeGreaterThanOrEqual(1);
    expect(diagnostics.attribution["according_to_survey"]).toBeGreaterThanOrEqual(1);
  });

  it("refuses the defects rather than repairing them into prose", () => {
    const { diagnostics } = composed();
    // Source colour and danglers are counted refusals, not silent omissions.
    expect(diagnostics.qualityGate.entityLeakWarnings).toBe(0);
    expect(diagnostics.qualityGate.malformedAttributionWarnings).toBe(0);
    expect(diagnostics.qualityGate.headingUnitWarnings).toBe(0);
    expect(diagnostics.fallbackLevel).toBe(1);
  });

  it("never falls back to the raw source text", () => {
    const { text, article } = composed();
    expect(text).not.toContain(EXCERPT.slice(0, 60));
    expect(article.paragraphs.every((paragraph) => paragraph.text.trim() !== "")).toBe(true);
    expect(rendered().deck.text).not.toContain("Why identity built for humans");
  });
});

/**
 * GOB-6 — Guardian newsletter sidebar entering story evidence.
 *
 * The Guardian story "Shock, anger…" carried a "What else we're reading about"
 * section with unrelated visa-policy and water-restriction snippets inside the
 * same article column. Before the exact heading boundary, those snippets were
 * extracted as ordinary paragraphs, selected as evidence, and composed into the
 * reader's article. The fix is structural: extraction stops at the heading.
 */
describe("GOB-6 — Guardian sidebar boundary", () => {
  const HEADLINE = "Shock, anger and protests after city announces new residency policy";

  const GUARDIAN_HTML =
    "<article>" +
    "<h1>Shock, anger and protests after city announces new residency policy</h1>" +
    "<p>Residents reacted with shock and anger on Tuesday after officials unveiled a new residency policy they said would reshape who can live and work in the city.</p>" +
    "<p>The mayor's office said the measure, which takes effect next month, was designed to address a severe housing shortage and would be reviewed after six months.</p>" +
    "<p>Civil rights groups promised legal challenges, arguing the policy unfairly targets low-income families and recent arrivals.</p>" +
    "<h2>What else we're reading about</h2>" +
    "<p>Visa changes for international students have left hundreds uncertain about their autumn plans, universities said.</p>" +
    "<p>Water restrictions are expected to tighten across the southern region after the driest summer on record.</p>" +
    "</article>";

  const mainText = extractMainText(GUARDIAN_HTML);

  const units = selectEvidenceUnits(mainText, undefined, HEADLINE);

  const story = (): Story => ({
    id: "guardian-sidebar-boundary",
    org: "The Guardian",
    title: HEADLINE,
    what: "",
    why: "",
    importance: "High",
    score: { relevance: 80, importance: 80, novelty: 60 },
    sources: 1,
    topics: ["Policy", "Housing"],
    time: "",
    publishedAt: "2026-10-13T09:00:00Z",
    sourceList: [
      {
        name: "The Guardian",
        at: "",
        url: "https://www.theguardian.com/",
        excerpt: mainText,
        enrichedEvidence: units.map((unit) => {
          if (unit.kind === "quote") {
            return unit.attribution
              ? { kind: "quote", text: unit.text, attribution: unit.attribution }
              : { kind: "quote", text: unit.text };
          }
          return unit.entities
            ? { kind: unit.kind, text: unit.text, entities: unit.entities }
            : { kind: unit.kind, text: unit.text };
        }),
      },
    ],
    before: "",
    after: "",
    timeline: [],
  });

  const composed = () => composeArticleWithDiagnostics(story());

  it("keeps the article's own reporting in the extracted text", () => {
    expect(mainText).toContain("Residents reacted with shock and anger");
    expect(mainText).toContain("mayor's office said the measure");
    expect(mainText).toContain("Civil rights groups promised legal challenges");
  });

  it("does not extract the sidebar heading or the snippets after it", () => {
    expect(mainText).not.toContain("What else");
    expect(mainText).not.toContain("Visa changes");
    expect(mainText).not.toContain("Water restrictions");
  });

  it("selects only the article's facts as evidence", () => {
    expect(units.length).toBeGreaterThan(0);
    const text = units.map((u) => u.text).join(" ");
    expect(text).toMatch(/shock and anger|residency policy|housing shortage/i);
    expect(text).not.toContain("Visa changes");
    expect(text).not.toContain("Water restrictions");
  });

  it("fail-before: without the heading boundary the sidebar snippets become evidence", () => {
    // Removing the heading collapses the sidebar into the article body, so the
    // same sentences that are now excluded would be selected as evidence. This
    // is the shape of the original defect: the heading existed but extraction
    // did not honour it.
    const withoutHeading = GUARDIAN_HTML.replace("<h2>What else we're reading about</h2>", "");
    const unbounded = selectEvidenceUnits(extractMainText(withoutHeading), undefined, HEADLINE);
    const text = unbounded.map((u) => u.text).join(" ");
    expect(text).toContain("Visa changes");
    expect(text).toContain("Water restrictions");
  });

  it("does not compose the sidebar snippets into the reader's article", () => {
    const { article, diagnostics } = composed();
    const text = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(text).not.toContain("Visa changes");
    expect(text).not.toContain("Water restrictions");
    expect(text).not.toContain("What else");
    expect(diagnostics.facts.lost).toBe(0);
  });

  it("still publishes the article's own reporting", () => {
    const { article } = composed();
    const text = [article.deck.text, ...article.paragraphs.map((p) => p.text)].join(" ");
    expect(text).toMatch(/residency policy|housing shortage|legal challenges/i);
  });
});
