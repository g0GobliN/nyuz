import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STORIES } from "@/lib/sample-data";
import { BriefingPreview } from "./briefing-preview";

/**
 * Significance and provenance print under different headings — the arbiter's
 * ruling of 2026-10-09. `why` is the briefing's fact about the story and shows
 * under "Why it matters"; `personalization` is the reader's own follow graph
 * and keeps its own heading. Neither is allowed to stand in for the other, and
 * neither leaves an empty heading behind.
 */
describe("BriefingPreview — significance vs provenance", () => {
  const base = STORIES[0]!;
  const heading = "Why you're seeing this";

  /** Markup escaped by React, so the assertions read as text does. */
  const render = (stories: Parameters<typeof BriefingPreview>[0]["stories"]): string =>
    renderToStaticMarkup(createElement(BriefingPreview, { stories })).replace(/&#x27;/gu, "'");

  it("separates the significance line from the follow line", () => {
    const html = render([
      {
        ...base,
        why: "The story carries a $40 billion figure.",
        personalization: { heading, explanation: "You follow AI and NVIDIA." },
      },
    ]);
    expect(html).toContain("Why it matters · ");
    expect(html).toContain("The story carries a $40 billion figure.");
    expect(html).toContain("Why you're seeing this · ");
    expect(html).toContain("You follow AI and NVIDIA.");
  });

  it("keeps provenance alone when there is no significance line", () => {
    const html = render([
      {
        ...base,
        why: "",
        personalization: { heading, explanation: "You follow Cybersecurity." },
      },
    ]);
    expect(html).not.toContain("Why it matters");
    expect(html).toContain("Why you're seeing this · ");
    expect(html).toContain("You follow Cybersecurity.");
  });

  it("prints no heading for what is not there", () => {
    const html = render([{ ...base, why: "" }]);
    expect(html).not.toContain("Why it matters");
    expect(html).not.toContain("Why you're seeing this");
  });
});
