import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The archive's day card is one target, and its labels are one heading level
 * below the page's.
 *
 * Both are asserted in source, like `load-state-screens.test.ts` and
 * `offline-wiring.test.ts`, because the failure modes are structural and
 * invisible in a screenshot: an `<a>` inside an `<a>` is still *rendered* by the
 * browser (it silently splits into two anchors, and the inner one becomes a
 * second keyboard stop inside a card that is already a link), and a heading
 * level that skips H2 reads fine and outlines wrong. `history.tsx` owns the day
 * card inline — it is a route, not a component — so there is nothing to render
 * in isolation here; the archive's rendered geometry is measured in the
 * acceptance capture instead.
 *
 * S3, `docs/design-spec-2026-10-21.md`.
 */
const HISTORY = readFileSync("src/routes/dashboard/history.tsx", "utf8");

/** The archive's day list, from the first day to the end of the component. */
const days = () => {
  const start = HISTORY.indexOf("function Days(");
  expect(start).toBeGreaterThan(-1);
  return HISTORY.slice(start, HISTORY.indexOf("/**\n * Shown only while a downgrade"));
};

describe("the archive's day card", () => {
  it("is the anchor, and the label inside it is not", () => {
    const source = days();
    // One anchor per day with stories — the card — so there is no `a a` on the
    // page and one tab stop per day.
    expect(source.split("<Link").length - 1).toBe(1);
    expect(source).toContain('to="/dashboard/briefing"');
    expect(source).toContain("search={{ digest: d.digestId }}");
    // The affordance stays visible, as a span inside that anchor.
    expect(source).toMatch(/<span[^>]*>\s*Open briefing\s*<\/span>/);
  });

  it("warms its border on hover, the way an alert card does", () => {
    // The alert card's own vocabulary (`alerts/index.tsx`), which is also P2:
    // 26 px radius, matching the cards it now behaves like.
    expect(days()).toContain("rounded-3xl");
    expect(days()).toContain("hover:border-foreground/20");
    expect(days()).toContain("group-hover:text-foreground");
  });

  it("leaves the skipped day inert, and dashed", () => {
    const source = days();
    const skipped = source.slice(source.indexOf("d.skipped ?"), source.indexOf(") : ("));
    expect(skipped).toContain("<div");
    expect(skipped).toContain("border-dashed");
    expect(skipped).not.toContain("<Link");
  });

  it("labels each day one level under the page's h1", () => {
    // `days()` is the only place in the archive that prints a date heading, and
    // an H1 -> H3 skip is the same defect S2 names on the briefing.
    expect(days()).toContain("<h2");
    expect(HISTORY).not.toContain("<h3");
  });
});
