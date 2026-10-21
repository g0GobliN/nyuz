import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Coverage } from "./coverage";

/**
 * The "What nyuz covers" section is load-bearing copy, so it is pinned here.
 *
 * Two things are being defended, and neither is cosmetic:
 *
 * 1. **Every area the section names is one the product actually watches.** The
 *    section exists to widen the product's stated scope beyond "news" — that is
 *    the whole reason it was added (owner-ruled 2026-10-21). If a later edit
 *    drops "research" or "music, film and culture" from the grid, the page goes
 *    back to reading as a news digest, which is the defect the section was built
 *    to fix. So the four titles are asserted as a set, in order.
 *
 * 2. **No numerals.** A number of sources or topics on a landing page is the one
 *    claim a stranger can check and find wanting, and the source count moves
 *    every week. The section deliberately trades a specific count for a true
 *    one. That constraint is easy to break with one helpful-looking edit, so it
 *    is asserted rather than trusted.
 *
 * The copy also has to stay out of the "sharing platform" reading: nyuz collects
 * and matches, readers do not post to each other. Nothing here may claim
 * otherwise.
 *
 * Rendered with `renderToStaticMarkup` in the node environment, which is how
 * every other component test in this repository works (`briefing-preview.test.ts`,
 * `topic-controls.test.ts`) — there is no jsdom, and adding one for this would be
 * a much larger change than the section it is testing.
 */
const render = (): string => renderToStaticMarkup(createElement(Coverage)).replace(/&#x27;/gu, "'");

/** The text of the markup with tags removed, so assertions read as a reader does. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();

describe("Coverage — the scope of what nyuz watches", () => {
  it("states the claim the section exists for", () => {
    const text = textOf(render());
    expect(text).toContain("Not just what's in the news.");
    expect(text).toContain("What matters in your world.");
  });

  it("names all four areas of coverage, in the order a reader meets them", () => {
    const text = textOf(render());
    const titles = [
      "News and world events",
      "Technology and projects",
      "Research and ideas",
      "Music, film and culture",
    ];

    for (const title of titles) expect(text).toContain(title);

    // Order matters: the sequence runs from what a reader expects a briefing to
    // carry, outwards to what they do not. Asserted by index rather than one
    // `toContain` at a time, so a reordering fails instead of passing.
    const positions = titles.map((title) => text.indexOf(title));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("carries no numerals, in the copy or the component's own body", () => {
    const text = textOf(render());
    // `\p{Nd}` is a decimal digit in any script, so a full-width or Devanagari
    // numeral would fail too — the constraint is "no countable claim", not
    // "no ASCII digits".
    expect(text).not.toMatch(/\p{Nd}/u);
  });

  it("does not describe nyuz as a place readers share information with each other", () => {
    const text = textOf(render()).toLowerCase();
    // The section widens the SCOPE of what is watched. It must not widen the
    // product into a social platform — that was explicitly ruled out of scope
    // when the positioning line was set.
    for (const wrong of ["share with", "post your", "community", "submit your"]) {
      expect(text).not.toContain(wrong);
    }
  });

  it("renders the four cells as one hairline grid, not as separate cards", () => {
    const html = render();
    // The grid's dividers are the container's own hairlines under a 1px gap —
    // the same construction as WhyDifferent. Two grids that draw their borders
    // differently is the visible inconsistency this guards against.
    expect(html).toContain("gap-px");
    expect(html).toContain("rounded-3xl");
    expect(html).toContain("bg-[var(--hairline)]");
    // Four cells, each with its own surface, so the dividers show through the
    // gaps rather than being drawn per cell.
    expect((html.match(/bg-surface/gu) ?? []).length).toBe(4);
  });

  it("renders one h2 and no deeper heading, so it does not disturb the page outline", () => {
    const html = render();
    expect((html.match(/<h2/gu) ?? []).length).toBe(1);
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<h3");
    // The cell titles are paragraphs, matching WhyDifferent's cells.
    expect((html.match(/<p /gu) ?? []).length).toBeGreaterThanOrEqual(9);
  });
});
