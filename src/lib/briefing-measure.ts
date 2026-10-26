/**
 * The briefing's reading measure, as numbers, so the surface and the test that
 * guards it cannot drift apart.
 *
 * The audit that produced this (`docs/design-audit-2026-10-21.md`, B2) measured
 * the delivered briefing setting **144 characters on a line**: 13.5 px text over
 * a 911 px column inside the 969 px card the product's content area gives it.
 *
 * Two attempts have followed, and the second one is the owner's call, not a
 * designer's:
 *
 *  1. A 32 rem cap set a textbook line (69 characters) and made a desktop page
 *     render as a phone-width strip floating in a 1024 px content area. The
 *     owner rejected it on sight: "same mobile UI on PC".
 *  2. A full-width card split into two columns kept every measurement and still
 *     was not the product they know: "my old one never had 2 row it always one".
 *     The briefing has been one column since it existed, and one column is what
 *     ships. **The card is the dashboard's own content column width and the
 *     list is a single column at every viewport.**
 *
 * So the summary sets **966 px of text at 14.5 px — about 147 characters on a
 * line**, and that is a recorded exception to the product's 65–75 typographic
 * range rather than an accident. It is written down here so the next person
 * does not silently narrow the card again: the width is the owner's decision,
 * and the person who wants it changed asks first. What the shipped card does
 * keep from the audit is the thing the owner never objected to — type sizes
 * that step instead of run level (16 px headline, 14.5 px summary, 13 px
 * "Why it matters", 12 px provenance), and the summary lifted off 13.5 px so
 * it is not set at the same size as the line beneath it.
 *
 * The cap is a card width rather than a `max-w-[65ch]` on the prose on purpose.
 * `ch` resolves against the element's own font size, so on a card (16 px) it
 * would silently size the text by the card's type rather than the paragraph's,
 * and the summary is not the card's only text.
 *
 * Every number below is a **measurement**, not an estimate.
 *
 *  - Manrope 400's mean advance is **0.4525 em** per character — measured
 *    2026-10-21 in Chromium (Playwright 1243) against the app's own Google Fonts
 *    request, over the 25 delivered card lines transcribed from
 *    `docs/live-read-2026-10-21.md` §1. Stable to three significant figures
 *    across 13.5/14.5/16 px.
 *  - At the 32 rem cap the summary's column was 512 − 2 (border) − 56 (`px-7`
 *    a side) = **454 px**, so **69.2 characters** fit one full line.
 *  - Rendered in the product's own content column (2026-10-21, dev server,
 *    real component and stylesheet) that measured **median 68, max 73** over 45
 *    full lines.
 *  - The shipped single column is 1024 − 2 (border) − 56 (`px-7` a side) =
 *    **966 px**, so **147.2 characters** fit one full line.
 */
export const BRIEFING_READING = {
  /**
   * The card's cap at every width. Written as the Tailwind candidate verbatim —
   * the compiler scans source text, so a literal here is what emits the rule.
   * 64 rem is the dashboard shell's own `max-w-5xl` content column, so on a
   * desktop the card and the header above it are the same width.
   */
  cardClassName: "mx-auto w-full max-w-[64rem]",
  /** 64 rem at the 16 px root the app uses. Kept beside the class it mirrors. */
  cardMaxPx: 1024,
  /** The card's 1 px border, both sides: it sits inside the box the cap sizes. */
  borderPx: 2,
  /** The card's own horizontal padding above `sm` (`px-7` = 28 px a side). */
  gutterPx: 56,
  /**
   * The summary paragraph's size. Lifted from 13.5 px so it steps down from the
   * 16 px headline instead of running level with it, and stays above the 13 px
   * significance line and the 12 px provenance note.
   */
  summaryPx: 14.5,
  /** Manrope 400's mean advance per character, measured (see above). */
  advanceEm: 0.4525,
} as const;

/** The summary's column: the card, less its border and the padding on both sides. */
export function briefingReadingColumnPx(): number {
  return BRIEFING_READING.cardMaxPx - BRIEFING_READING.borderPx - BRIEFING_READING.gutterPx;
}

/**
 * Characters that fit one full line of the briefing's summary at the cap.
 * Rounded to one decimal, because the assertion is about a measured number, not
 * a glyph.
 */
export function briefingSummaryCharactersPerLine(): number {
  const advance = BRIEFING_READING.advanceEm * BRIEFING_READING.summaryPx;
  return Math.round((briefingReadingColumnPx() / advance) * 10) / 10;
}
