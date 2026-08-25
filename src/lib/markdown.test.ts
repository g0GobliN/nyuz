import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { Markdown } from "@/lib/markdown";
import { renderToStaticMarkup } from "react-dom/server";

describe("Markdown links", () => {
  it("does not turn protocol-relative URLs into hrefs", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { source: "[x](//evil.example/phish)" }),
    );
    expect(html).not.toMatch(/href=/i);
  });

  it("keeps https links", () => {
    const html = renderToStaticMarkup(
      createElement(Markdown, { source: "[x](https://nyuz.app/legal/privacy)" }),
    );
    expect(html).toContain('href="https://nyuz.app/legal/privacy"');
  });
});
