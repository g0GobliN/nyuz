import { describe, expect, it } from "vitest";
import {
  pageHeadings,
  separateWeldedHeading,
  splitWeldedHeading,
} from "@/lib/pipeline/welded-heading";

/**
 * The live defect these lock down, and its four preserve cases.
 *
 * Card 01 of the delivered 2026-10-18 briefing printed the publisher's `<h3>`
 * subhead welded to the sentence after it, because The Register's feed carries
 * the article as plain text and the seam is a single space. The arbiter's ruling
 * (#10, option 4) is to split only where the article's own page confirms the
 * heading, and to leave the line alone everywhere else — so both halves of that
 * rule are tested here, with the page's markup and without it.
 */

/** The delivered line, verbatim (`events.what_happened` on 2026-10-18). */
const DELIVERED =
  "Ransomware with physical consequences Building automation systems - BAS - are the critical systems that control and monitor facilities’ HVAC, lighting, energy usage, and water consumption.";

/** The same article's page, which marks the subhead up as a heading. */
const PAGE = `<p>... the report said.</p><h3>Ransomware with physical consequences</h3><p>Building automation systems - BAS - are the critical systems that control and monitor facilities’ HVAC, lighting, energy usage, and water consumption. They also oversee badge readers.</p>`;

describe("pageHeadings", () => {
  it("reads the page's own headings, decoded and deduplicated", () => {
    const headings = pageHeadings(
      `<h1>Main</h1><h2>Chips &amp; AI</h2><div><h3>Ransomware with physical consequences</h3></div><h3>Ransomware with physical consequences</h3>`,
    );
    expect(headings).toContain("Ransomware with physical consequences");
    expect(headings).toContain("Chips & AI");
    expect(
      headings.filter((heading) => heading === "Ransomware with physical consequences"),
    ).toHaveLength(1);
  });

  it("ignores a label short enough to occur in ordinary prose", () => {
    // "Review" and "Analysis" are headings on real pages and also ordinary
    // words; removing one from a sentence would delete its subject.
    expect(pageHeadings("<h3>Review</h3><h3>AI</h3>")).toEqual([]);
  });

  it("puts the longest heading first, so a shared prefix cannot pick the wrong seam", () => {
    const headings = pageHeadings(
      "<h3>Ransomware with physical consequences</h3><h3>Ransomware with physical</h3>",
    );
    expect(headings[0]).toBe("Ransomware with physical consequences");
  });
});

describe("splitWeldedHeading", () => {
  it("separates the heading the page confirms, keeping the sentence", () => {
    const repair = splitWeldedHeading(DELIVERED, pageHeadings(PAGE));
    expect(repair?.text).toBe(
      "Building automation systems - BAS - are the critical systems that control and monitor facilities’ HVAC, lighting, energy usage, and water consumption.",
    );
    expect(repair?.headings).toEqual(["Ransomware with physical consequences"]);
  });

  it("separates a heading welded after a full stop, keeping both sentences", () => {
    const repair = splitWeldedHeading(
      "The report said the trend is growing. Ransomware with physical consequences Building automation systems are now the target.",
      ["Ransomware with physical consequences"],
    );
    expect(repair?.text).toBe(
      "The report said the trend is growing. Building automation systems are now the target.",
    );
  });

  it("preserves the line when the page cannot be read", () => {
    // A failed or unavailable fetch passes no headings, and the ruling is that
    // missing evidence is recorded, never replaced.
    expect(splitWeldedHeading(DELIVERED, [])).toBeNull();
  });

  it("preserves the line when the page does not carry that heading", () => {
    expect(
      splitWeldedHeading(DELIVERED, pageHeadings("<h3>Something else entirely</h3>")),
    ).toBeNull();
  });

  it("preserves a heading that already stands as its own sentence", () => {
    // The re-extracted form: the publisher's page, read through `extractMainText`
    // today, closes the heading. There is nothing to repair and nothing to cut.
    const separated = DELIVERED.replace("consequences Building", "consequences. Building");
    expect(splitWeldedHeading(separated, pageHeadings(PAGE))).toBeNull();
  });

  it("preserves an ordinary sentence that happens to contain the heading's words", () => {
    const ordinary =
      "Analysts said ransomware with physical consequences Building automation systems were a growing risk.";
    expect(splitWeldedHeading(ordinary, ["Ransomware with physical consequences"])).toBeNull();
  });

  it("never repairs a line down to nothing", () => {
    // The guard is length and a closing stop: a heading that is most of the line
    // leaves no sentence to publish, so the repair is refused and the line kept.
    expect(
      splitWeldedHeading("Ransomware with physical consequences Building systems.", [
        "Ransomware with physical consequences",
      ]),
    ).toBeNull();
  });
});

describe("separateWeldedHeading", () => {
  it("closes the boundary in the document the composer reads", () => {
    // `articles.excerpt` is the string the composer selects its deck from, so a
    // repair of the event line alone leaves the story page still opening on the
    // weld. This is the same confirmation, applied as the page's own extraction
    // reads it: the heading keeps its words and the sentence after it starts.
    const excerpt = `... the report said. ${DELIVERED} They also oversee badge readers.`;
    const repair = separateWeldedHeading(excerpt, pageHeadings(PAGE));
    expect(repair?.text).toBe(
      "... the report said. Ransomware with physical consequences. Building automation systems - BAS - are the critical systems that control and monitor facilities’ HVAC, lighting, energy usage, and water consumption. They also oversee badge readers.",
    );
    expect(repair?.headings).toEqual(["Ransomware with physical consequences"]);
  });

  it("preserves a document with no confirmed heading", () => {
    expect(separateWeldedHeading(DELIVERED, [])).toBeNull();
    expect(
      separateWeldedHeading(DELIVERED, pageHeadings("<h3>Unrelated heading here</h3>")),
    ).toBeNull();
  });

  it("preserves a document where the heading already ends a sentence", () => {
    expect(
      separateWeldedHeading(DELIVERED.replace("consequences Building", "consequences. Building"), [
        "Ransomware with physical consequences",
      ]),
    ).toBeNull();
  });
});
