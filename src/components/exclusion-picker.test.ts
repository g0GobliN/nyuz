import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExclusionPicker } from "./exclusion-picker";

describe("ExclusionPicker", () => {
  it("shows saved exclusions when the page reloads", () => {
    const html = renderToStaticMarkup(
      createElement(ExclusionPicker, {
        selected: ["Football", "Elon Musk"],
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain("Excluded");
    expect(html).toContain("Football");
    expect(html).toContain("Elon Musk");
  });

  it("keeps suggestions separate from the saved global exclusions", () => {
    const html = renderToStaticMarkup(
      createElement(ExclusionPicker, {
        selected: ["Football"],
        suggestions: ["Crypto", "Opinion columns"],
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain("Suggestions");
    expect(html).toContain("Crypto");
    expect(html).toContain("Opinion columns");
    expect(html).not.toContain("hiring");
  });

  it("renders user text safely", () => {
    const html = renderToStaticMarkup(
      createElement(ExclusionPicker, {
        selected: ['<script>alert("x")</script>'],
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
  });
});
