import {
  admissibleReaderSentence,
  editorialNoise,
  unresolvedContextOpening,
} from "./reader-evidence";

/**
 * The summary line a reader may be shown for a story, or `null` when the stored text is not something
 * the reader should read.
 *
 * **Why this exists.** Until now every reader surface printed `events.what_happened` exactly as the
 * feed wrote it: `digest_items` stores no summary at all (its only generated text is
 * `why_it_matters`), so the dashboard, the briefing, the email and the alert digest all reach the
 * same raw column through a read-time join. The story page, meanwhile, composes and validates its
 * prose. Two standards on one product, and the measured cost of it, reproduced on the delivered
 * surface by [the audit](../../scripts/reader-delivered-summary-audit.ts) (`digests` +
 * `digest_items` + `deliveries`, last 21 days, measured three times on 2026-10-15): **20 briefings
 * delivered, 297 items handed to a reader, 289 of them carrying a line, and 10 of those lines
 * withheld by the guard below -- with 8 of the 20 briefings (40%) affected** (a wider union including
 * the deck-scoped rule reaches 11 of 297, and the difference is a decision recorded in the suite, not
 * absorbed here).
 *
 * The arbiter ruled the root cause on 2026-10-15: *"a reader-quality enforcement gap between
 * ingestion and delivery"*, and its contract for the fix is that a summary failing validation is
 * **withheld, never replaced by the raw feed description** (decisions/reader-delivery.md). Its
 * contract also names the checks to apply, and this function is exactly those: **sentence
 * admissibility**, **publisher furniture** and **context recoverability** -- `admissibleReaderSentence`
 * (which itself carries the development-record rule), `editorialNoise` and
 * `unresolvedContextOpening`, the same three the card and the story page already ask.
 *
 * **What is deliberately not here.** `noMainClause` -- the flattened-list-item rule -- is scoped to the
 * **deck boundary** by the arbiter's own ruling, on the measurement that its wider grammar match was
 * 11-of-12 ordinary prose, and it is not widened by being applied here. Two lines in the reproduced
 * sample below are therefore still not withheld, and they are kept as recorded true negatives in the
 * suite rather than silently absorbed.
 *
 * **What this is not.** It cannot invent the line the item should have had: an item withheld here is
 * delivered with no summary rather than with a good one. Composing the valid line at briefing build
 * time and storing it with provenance is the next slice of the same ruling, and this guard is what
 * makes the delivered surface honest until it lands -- it also covers the rows already stored, which
 * no build-time fix can reach.
 */
export function deliveredSummary(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return null;
  if (!admissibleReaderSentence(trimmed)) return null;
  if (editorialNoise(trimmed)) return null;
  if (unresolvedContextOpening(trimmed)) return null;
  return trimmed;
}
