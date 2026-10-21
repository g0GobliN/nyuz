/**
 * The briefing's reading measure, as numbers, so the surface and the test that
 * guards it cannot drift apart.
 *
 * The audit that produced this (`docs/design-audit-2026-10-21.md`, B2) measured
 * the delivered briefing setting **144 characters on a line**: 13.5 px text over
 * a 911 px column inside the 969 px card the product's content area gives it.
 * The card was built for the marketing page's 548 px column, where the same text
 * reads correctly, and the dashboard mounted it unchanged.
 *
 * The cap is a card width rather than a `max-w-[65ch]` on the prose on purpose.
 * `ch` resolves against the element's own font size, so on a card (16 px) it
 * would silently size the text by the card's type rather than the paragraph's,
 * and the summary is not the card's only text. A rem cap on the card is the same
 * number at every width and is what a delivered artifact should be: one column,
 * centred, with the page's header and chips still full width.
 *
 * Every number below is a **measurement**, not an estimate.
 *
 *  - Manrope 400's mean advance is **0.4525 em** per character — measured
 *    2026-10-21 in Chromium (Playwright 1243) against the app's own Google Fonts
 *    request, over the 25 delivered card lines transcribed from
 *    `docs/live-read-2026-10-21.md` §1. Stable to three significant figures
 *    across 13.5/14.5/16 px.
 *  - At the 32 rem cap the summary's column is 512 − 2 (border) − 56 (`px-7`
 *    a side) = **454 px**, so **69.2 characters** fit one full line. The
 *    narrowest-charactered line in that corpus fits 74.4; the widest, 64.7.
 *  - Rendered in the product's own content column (2026-10-21, dev server,
 *    real component and stylesheet) that measured **median 68, max 73** over 45
 *    full lines — inside the 65–75 target, and against 144 before the fix.
 *
 * 32 rem was chosen from that measurement rather than guessed. The audit's own
 * recommendation (592 px) measured median 80 / max 85 and would not have met
 * the 65–75 target; 36 rem and above still fit more than 75.
 *
 * The neighbouring sizes scale with the same column: the 16 px headline fits
 * 62.7, the 13 px "Why it matters" line 77.2. Smaller supporting type in one
 * column always sets a few more characters than the prose it follows (the same
 * relation the product already has: 14.5 px body at 109 against a 16 px deck at
 * 88), and the line a reader actually reads a briefing through is the summary.
 */
export const BRIEFING_READING = {
  /**
   * The card's cap at every width. Written as the Tailwind candidate verbatim —
   * the compiler scans source text, so a literal here is what emits the rule.
   */
  cardClassName: "mx-auto w-full max-w-[32rem]",
  /** 32 rem at the 16 px root the app uses. Kept beside the class it mirrors. */
  cardMaxPx: 512,
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
 * Rounded to one decimal, because the assertion is about a range, not a glyph.
 */
export function briefingSummaryCharactersPerLine(): number {
  const advance = BRIEFING_READING.advanceEm * BRIEFING_READING.summaryPx;
  return Math.round((briefingReadingColumnPx() / advance) * 10) / 10;
}
