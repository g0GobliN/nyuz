import { describe, expect, it } from "vitest";
import { extractMainText } from "./html-text";

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
