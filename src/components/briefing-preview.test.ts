import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BRIEFING_READING, briefingSummaryCharactersPerLine } from "@/lib/briefing-measure";
import { STORIES } from "@/lib/sample-data";
import type { Story } from "@/lib/story";
import { BriefingPreview } from "./briefing-preview";

/**
 * `Link` needs a running router, and this file is about the URL a reader's
 * browser would be handed. The stand-in resolves `to` and `params` exactly as
 * the router does — `/dashboard/story/$id` with an `id` becomes
 * `/dashboard/story/<id>` — so an assertion here reads the href, not a fixture.
 */
vi.mock("@tanstack/react-router", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: (props: {
      to?: string;
      params?: Record<string, string>;
      className?: string;
      children?: unknown;
    }) => {
      let href = props.to ?? "#";
      for (const [key, value] of Object.entries(props.params ?? {})) {
        href = href.replace(`$${key}`, value);
      }
      return h("a", { href, className: props.className }, props.children as never);
    },
  };
});

/** Markup escaped by React, so the assertions read as text does. */
function render(stories: Story[], variant: "marketing" | "reader" = "marketing"): string {
  return renderToStaticMarkup(createElement(BriefingPreview, { stories, variant })).replace(
    /&#x27;/gu,
    "'",
  );
}

/** One entry per anchor in the markup, in document order (so, reading order). */
function anchors(html: string): string[] {
  return [...html.matchAll(/<a [^>]*/gu)].map((m) => m[0]);
}

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

/**
 * B1, measured on the deployed product on 2026-10-21: the briefing held **25
 * stories, 0 anchors, 0 tabbable elements, 0 pointer cursors**. A reader could
 * scroll 4,236 px of their own briefing and open nothing. This is the
 * assertion that fails if that returns: every story is a link to its own page,
 * in reading order, reachable by keyboard, with a pointer and a visible ring.
 */
describe("BriefingPreview — the reader's briefing is a way in", () => {
  /** The live shape: one story per line, 25 of them. */
  const delivered: Story[] = Array.from({ length: 25 }, (_, i) => ({
    ...STORIES[i % STORIES.length]!,
    id: `6f1c9a52-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  }));

  it("gives all 25 stories a link, in the order they are read", () => {
    const html = render(delivered, "reader");
    const hrefs = anchors(html).map((a) => /href="([^"]*)"/u.exec(a)?.[1] ?? "");
    expect(hrefs).toHaveLength(delivered.length);
    expect(hrefs).toEqual(delivered.map((s) => `/dashboard/story/${s.id}`));
  });

  it("keeps every link in the tab order, with a pointer and a visible focus ring", () => {
    const html = render(delivered, "reader");
    const links = anchors(html);
    expect(links).toHaveLength(delivered.length);
    for (const link of links) {
      // An anchor with an href is tabbable; a negative tabindex is the one
      // thing that would take it back out of the keyboard's path.
      expect(link).not.toContain("tabindex");
      expect(link).toContain("cursor-pointer");
      expect(link).toContain("focus-visible:ring-2");
      expect(link).toContain("focus-visible:ring-ring");
    }
  });

  it("leaves the marketing facsimile inert", () => {
    // The landing page's stories are fixtures, and a link there would send a
    // visitor into a dashboard they have no account for. The variant is opt-in
    // precisely so the two usages cannot be confused.
    expect(render(delivered)).not.toContain("<a ");
    expect(render(delivered, "reader")).toContain("<a ");
  });
});

/**
 * B2, measured on the deployed product on 2026-10-21: 13.5 px text over a
 * 911 px column inside a 969 px card — **144 characters per line**, against
 * 88–109 everywhere else in the product. The card had been sized for a 548 px
 * marketing column.
 *
 * The number this asserts is a measurement, not a taste: Manrope 400's mean
 * advance is 0.4525 em per character (measured 2026-10-21 in Chromium against
 * the app's own Google Fonts request, over the 25 delivered lines in
 * docs/live-read-2026-10-21.md §1). See `src/lib/briefing-measure.ts`.
 */
describe("BriefingPreview — the briefing sets a reading measure", () => {
  it("caps the reader's card, and only the reader's card", () => {
    expect(render(STORIES, "reader")).toContain("max-w-[32rem]");
    expect(render(STORIES)).not.toContain("max-w-[32rem]");
  });

  it("prints the summary at the size the measure was computed for", () => {
    expect(render(STORIES, "reader")).toContain(
      `text-[${BRIEFING_READING.summaryPx}px] leading-relaxed text-muted-foreground`,
    );
  });

  it("keeps the cap the characters-per-line check divides by the class it renders", () => {
    // Two numbers describe one card: the Tailwind candidate and the pixel value
    // the arithmetic uses. If only one of them moves, the check below would
    // pass while the page shipped something else.
    const rem = Number(/max-w-\[(\d+(?:\.\d+)?)rem\]/u.exec(BRIEFING_READING.cardClassName)?.[1]);
    expect(rem * 16).toBe(BRIEFING_READING.cardMaxPx);
  });

  it("fits 65–75 characters on a line at 1280 px", () => {
    // The audit's own range for the product (the feed card sits at 94, the
    // story deck at 88); the briefing was the outlier at 144.
    expect(briefingSummaryCharactersPerLine()).toBeGreaterThanOrEqual(65);
    expect(briefingSummaryCharactersPerLine()).toBeLessThanOrEqual(75);
  });
});
