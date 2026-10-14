import { describe, expect, it } from "vitest";
import { extractMainText, STRUCTURAL_BREAK } from "./html-text";

/**
 * A structural boundary is preserved, an inline one is a word space.
 *
 * The rule this pins, and the defect behind it (2026-10-10): the Guardian's
 * Marble Hill standfirst carries no full stop, and every tag used to become a
 * word space, so the standfirst and the sentence after it were stored as one
 * fact and reached the reader as two clauses run together with a mid-sentence
 * capital. The arbiter's ruling: separate the runs, never manufacture the
 * punctuation that would make them sentences.
 */
describe("extractMainText — structural versus inline boundaries", () => {
  const runs = (html: string) => extractMainText(html).split(STRUCTURAL_BREAK);

  it("separates the standfirst from the body it used to be welded to", () => {
    const html =
      "<p>Locals also express fear after man shot in the neck while his child was in the back of his car</p>" +
      "<p>Residents of Manhattan’s Marble Hill neighborhood were furious at federal Immigration and Customs Enforcement on Friday.</p>";
    expect(runs(html)).toEqual([
      "Locals also express fear after man shot in the neck while his child was in the back of his car",
      "Residents of Manhattan’s Marble Hill neighborhood were furious at federal Immigration and Customs Enforcement on Friday.",
    ]);
    // No punctuation was invented to create the separation.
    expect(extractMainText(html)).not.toContain("car. Residents");
  });

  it("keeps a `<br>` inside a paragraph as a run boundary, in every spelling", () => {
    for (const br of ["<br>", "<br/>", "<br />", "<BR>"]) {
      expect(
        runs(
          `<p>Prospect of contentious march led to a standoff${br}The secretary of state has banned the parade today.</p>`,
        ),
      ).toEqual([
        "Prospect of contentious march led to a standoff",
        "The secretary of state has banned the parade today.",
      ]);
    }
  });

  it("keeps inline and nested markup in one run, without spurious spaces", () => {
    const html =
      '<p>The <a href="/x">New York Times</a> reported that <strong><em>three</em></strong> people were <code>treated</code> on site.</p>';
    expect(runs(html)).toEqual([
      "The New York Times reported that three people were treated on site.",
    ]);
  });

  it("collapses repeated whitespace inside a run, and markup newlines are not boundaries", () => {
    // A paragraph written across three lines in the page's own source is one
    // run: the markup's formatting is whitespace, not a publisher boundary.
    const html =
      "<p>  First   run  with\n\n  spaces here.  </p>\n\n\n<p>\tSecond\trun with enough text to be a paragraph.\t</p>";
    expect(runs(html)).toEqual([
      "First run with spaces here.",
      "Second run with enough text to be a paragraph.",
    ]);
  });

  it("separates an incomplete line without pretending it is a sentence", () => {
    // The arbiter's qualification, pinned: a run boundary is structural, not
    // grammatical. A line break inside one sentence must not gain a full stop to
    // look finished -- the evidence pass refuses a fragment on its own merits.
    const cut = runs(
      "<p>The company said the deal would close</p><p>in the first quarter, pending approval.</p>",
    );
    expect(cut).toEqual([
      "The company said the deal would close",
      "in the first quarter, pending approval.",
    ]);
    // The boundary stayed structural: no full stop was inserted to make the
    // incomplete half look like a sentence.
    expect(cut[0]?.endsWith(".")).toBe(false);
  });
});

describe("extractMainText", () => {
  it("extracts paragraph text and drops script/style/nav/header/footer", () => {
    const html = `<html><head><style>.x{color:red}</style></head><body>
      <nav><a href="/">Home</a><a href="/about">About</a></nav>
      <header><h1>Site name</h1></header>
      <script>trackPageview();</script>
      <article>
        <p>Nvidia announced Monday it has agreed to acquire Hugging Face for $13 billion.</p>
        <p>The deal is expected to close in the first quarter, pending regulatory approval.</p>
      </article>
      <aside><p>Related: five other stories about chips</p></aside>
      <footer><p>Copyright 2026. All rights reserved.</p></footer>
    </body></html>`;

    const text = extractMainText(html);

    expect(text).toContain("Nvidia announced Monday");
    expect(text).toContain("first quarter, pending regulatory approval");
    expect(text).not.toContain("trackPageview");
    expect(text).not.toContain("Home");
    expect(text).not.toContain("Copyright 2026");
    expect(text).not.toContain("Related: five other stories");
  });

  it("decodes common HTML entities", () => {
    const html = "<p>The company&rsquo;s CEO said &quot;we&#39;re growing&quot; &amp; hiring.</p>";
    expect(extractMainText(html)).toBe('The company’s CEO said "we\'re growing" & hiring.');
  });

  it("drops short paragraph-tagged fragments like captions and single links", () => {
    const html =
      '<p>Photo</p><p><a href="/x">link</a></p><p>A real sentence with enough content to count as a paragraph.</p>';
    expect(extractMainText(html)).toBe(
      "A real sentence with enough content to count as a paragraph.",
    );
  });

  it("returns empty text for a page with no paragraph content", () => {
    const html = "<html><body><nav>menu</nav><div>some div text, no p tags</div></body></html>";
    expect(extractMainText(html)).toBe("");
  });

  it("does not throw on malformed or unclosed HTML", () => {
    const html = "<html><body><p>Unclosed paragraph and <script>window.x = '<p>fake</p>';";
    expect(() => extractMainText(html)).not.toThrow();
  });

  it("caps output length rather than growing unbounded on a huge page", () => {
    const bigParagraph = `<p>${"word ".repeat(2000)}real content here.</p>`;
    const html = bigParagraph.repeat(20);
    const text = extractMainText(html, 5_000);
    expect(text.length).toBeLessThanOrEqual(5_000);
  });
});

describe("extractMainText — exact heading boundary", () => {
  const runs = (html: string) => extractMainText(html).split(STRUCTURAL_BREAK);

  it("stops at the Guardian 'What else we're reading about' heading", () => {
    const html =
      "<article>" +
      "<p>Shock and anger spread through the city after the new policy was announced on Tuesday.</p>" +
      "<p>Officials said the measure would take effect within weeks and affect thousands of residents.</p>" +
      "<h2>What else we're reading about</h2>" +
      "<p>Visa policy changes have left hundreds of students uncertain about their status this autumn.</p>" +
      "<p>Water restrictions are expected to tighten across the region after a dry summer.</p>" +
      "</article>";
    const text = extractMainText(html);
    expect(text).toContain("Shock and anger spread");
    expect(text).toContain("Officials said the measure");
    expect(text).not.toContain("Visa policy changes");
    expect(text).not.toContain("Water restrictions");
    expect(text).not.toContain("What else");
  });

  it("stops at the heading with a curly apostrophe or trailing colon", () => {
    const html =
      "<p>The report was published on Monday.</p>" +
      "<h2>What else we’re reading about:</h2>" +
      "<p>Unrelated snippet from another story.</p>" +
      "<p>The report found no wrongdoing.</p>";
    const text = extractMainText(html);
    expect(text).toContain("The report was published");
    expect(text).not.toContain("Unrelated snippet");
    expect(text).not.toContain("The report found no wrongdoing");
  });

  it("does not stop at a heading that merely contains the phrase", () => {
    const html =
      "<p>The main finding stands.</p>" +
      "<h2>What else we're reading about today in Congress</h2>" +
      "<p>The provision passed by a narrow margin.</p>";
    const text = extractMainText(html);
    expect(text).toContain("The main finding stands");
    expect(text).toContain("The provision passed");
  });

  it("ignores the stop heading when it sits inside a stripped tag", () => {
    const html =
      "<aside><h2>What else we're reading about</h2><p>Sidebar content.</p></aside>" +
      "<article><p>The article body remains.</p></article>";
    const text = extractMainText(html);
    expect(text).toContain("The article body remains");
    expect(text).not.toContain("Sidebar content");
  });

  it("keeps ordinary article content and controls unchanged", () => {
    const html =
      "<p>First paragraph of the article.</p>" +
      "<h2>Analysis</h2>" +
      "<p>Second paragraph of the article.</p>" +
      "<h3>What officials said</h3>" +
      "<p>Third paragraph of the article.</p>";
    expect(runs(html)).toEqual([
      "First paragraph of the article.",
      "Second paragraph of the article.",
      "Third paragraph of the article.",
    ]);
  });
});
