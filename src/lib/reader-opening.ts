import { recoverCardSummary } from "./editorial";
import { admissibleReaderSentence, normalizeSummary } from "./reader-evidence";
import type { Story } from "./story";
import { briefingText, cardSummaryRefused } from "./understand";

/**
 * The sentence a story opens on, wherever a reader meets it.
 *
 * **Why this exists.** Ruling #11 (arbiter, 2026-10-18) made the *delivered
 * briefing* carry the composer's own opening sentence, and `audit:surfaces`
 * then measured the same contract at the feed and the archive as a
 * counterfactual: **9 of 57** feed card lines and **7 of 14** archive card
 * lines were also the sentence their page opened on. The other rows opened the
 * story one way on the card and another way on the page, which is the defect
 * the ruling exists to empty — the product promises one authoritative sentence
 * at the point of delivery, and a card that says one thing before a page that
 * says another breaks that promise in the reader's own hand.
 *
 * The card and the page therefore resolve their opening here, once, and never
 * from their own copy of the rule. Three implementations of it existed before
 * this file — the card's memo, the archive's re-rendering, and the audit's
 * transcription of the card's memo — and they could drift from each other
 * without any of them being wrong on its own terms.
 *
 * **The order, and why it is this order.**
 *
 * 1. The item's delivered line, which every loader resolves through
 *    `deliveredLine` (`reader-summary.ts`): the composed artifact a briefing
 *    stored for the item when there is one, the event's own stored line
 *    otherwise. It is printed when the card's own wider boundary admits it —
 *    the deck predicate and the shared sentence boundary, asked *before* the
 *    line is printed, so a refused stored line is never rendered just because it
 *    is non-empty.
 * 2. The story's own opening, recovered from its coverage by the composition
 *    (`recoverCardSummary`) when there is no line or the line is refused. That
 *    is the sentence the story page prints, and the page prints it whether or
 *    not the card does — so a card that stayed silent here would be the mismatch
 *    this file exists to end. Measured on the feed's 56 cards (2026-10-20), 11
 *    stored lines were refused only because they open on a reference
 *    ("The authors introduce…"), and every one of them has a composition that
 *    publishes a deck.
 * 3. Nothing, when the line is provider furniture or a metadata leak — the
 *    ruling of 2026-10-14 keeps that behaviour at the card, and recovery would
 *    print around a line that is not a summary in the first place — or when the
 *    story has no coverage to compose from. The page prints its composition's
 *    deck in that case (`story-article.tsx`), so the surface gates such a card
 *    rather than showing a card that opens a story differently from its page.
 */
export function storyOpening(story: Story): string {
  const raw = (story.what ?? "").trim();
  if (raw !== "") {
    const stored = briefingText(raw);
    if (stored !== "") {
      if (cardSummaryRefused(raw) || !admissibleReaderSentence(stored)) {
        return recoverCardSummary(story);
      }
      return stored;
    }
    // `briefingText` withheld the line, and the two reasons are different
    // decisions. Provider furniture or a metadata leak keeps its own behaviour
    // and recovers nothing (the ruling of 2026-10-14). A block it cut is the
    // shared boundary's `trailing_ellipsis` refusal, so it goes down the same
    // recovery path as any other refused line (the ruling of 2026-10-15, whose
    // test is that a truncated description "no longer reaches readers through
    // the card summary").
    if (normalizeSummary(raw).reason !== null) return "";
  }
  // No stored line, or one the boundary cut: the page opens on the composition,
  // so the card opens on the same sentence. Composing here is the recovery path
  // the card already paid for a refused line; a story with no coverage publishes
  // nothing and returns nothing.
  if (story.sourceList.length === 0) return "";
  return recoverCardSummary(story);
}
