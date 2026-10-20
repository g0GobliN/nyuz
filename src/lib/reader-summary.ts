import { recoveredSummaryFromSources } from "./editorial";
import {
  admissibleReaderSentence,
  editorialNoise,
  unresolvedContextOpening,
  type ReaderSource,
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
export function deliveredSummary(
  text: string | null | undefined,
  title?: string | null,
): string | null {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return null;
  if (!admissibleReaderSentence(trimmed)) return null;
  if (editorialNoise(trimmed)) return null;
  if (unresolvedContextOpening(trimmed, title)) return null;
  return trimmed;
}

/**
 * The line an item is delivered with: the composed artifact when it has one, the
 * event's own stored line otherwise, and nothing when neither may be shown.
 *
 * This is the only place a reader surface resolves an item's summary, and it is
 * asked at every join that turns a stored row into a line -- the home feed, the
 * briefing, the digest archive and the email. The order is the rulings': the
 * artifact first, because where it exists it is the sentence the page opens on
 * (ruling #11) or the composed, validated line the earlier ruling recovered, and
 * the raw column second, guarded exactly as it was before the artifact existed,
 * so an item built before these slices keeps the behaviour it already had.
 *
 * Both halves are asked through `deliveredSummary`, which is what keeps the
 * **raw fallback** at zero by construction: a refused raw description is withheld
 * whether or not an artifact exists, never printed as a fallback.
 */
export function deliveredLine(
  stored: { summary?: string | null } | null | undefined,
  raw: string | null | undefined,
  title?: string | null,
): string {
  return deliveredSummary(stored?.summary, title) ?? deliveredSummary(raw, title) ?? "";
}

/**
 * The line for an item on a **translated** digest: the composed artifact when the
 * item has one, the cached translation of its own line when that line is one the
 * boundary admits, and nothing otherwise.
 *
 * **Why the translation is not simply preferred.** The boundaries ask English
 * grammar, so a translated copy of a line the boundary refuses passes them
 * trivially -- it is the refused line in another language, and printing it is the
 * same defect one locale over. Before the artifact existed the email path printed
 * exactly that: `translated?.whatHappened ?? event.what_happened ?? ""`, with the
 * guard asked only on the English column it was replacing. The rule here is
 * therefore: a translation is printed only when the English line it translates is
 * admissible, and a refused one is withheld in every language.
 *
 * Measured before this was written, 2026-10-15, 60 days (`digests` +
 * `digest_items` + `deliveries`): **694 delivered items, 106 of them carrying a
 * refused English line, and 0 of those on a digest whose reader is not on
 * English** -- the three readers with preferences are all `en`, and
 * `event_translations` holds **0 rows**. So no reader has received one, and this
 * closes the class by construction rather than repairing a delivered row. That an
 * artifact is composed in English and is not itself translated is recorded as the
 * open question it is (decisions/reader-delivery.md): with no non-English reader,
 * inventing a translation path for it would be a decision without a subject.
 */
export function deliveredTranslatedLine(
  stored: { summary?: string | null } | null | undefined,
  raw: string | null | undefined,
  translated: string | null | undefined,
  title?: string | null,
): string {
  const artifact = deliveredSummary(stored?.summary, title);
  if (artifact !== null) return artifact;
  const own = deliveredSummary(raw, title);
  if (own === null) return "";
  return translated?.trim() ? translated.trim() : own;
}

/**
 * The summary line the briefing build stores for an item, or `null` when the
 * read path should resolve the item's own stored line instead.
 *
 * **The contract (arbiter ruling #11, 2026-10-18, option 2).** The delivered
 * briefing card and email carry *the composer's own opening sentence* whenever
 * the composer publishes a deck -- one authoritative sentence at the point of
 * delivery, attribution framing included, never stripped or regenerated here.
 * That sentence arrives as `opening`, taken from the composition the readiness
 * gate already ran, so this function composes nothing in the normal case, and it
 * is returned whether or not the item's stored line was admissible: "do not
 * substitute the producer's stored line merely because it is non-empty or
 * differs from the composed opening".
 *
 * **When the stored line is still the line.** `null` is the answer when the
 * composer published no deck (`opening` empty, e.g. a caller that never
 * composed). The read path then resolves the item's own line, guarded by
 * `deliveredSummary`. For a stored line that boundary refuses, the earlier
 * ruling's composition is still made here (`recoveredSummaryFromSources`) rather
 * than shipping the item with no line: it recovers the story's own sentence from
 * its coverage through the product's composition path and invents nothing, which
 * is the boundary ruling #11 states as "do not manufacture a sentence".
 *
 * `null` therefore means "no artifact", and the read path resolves it back to the
 * item's own line -- guarded there too, so both the not-needed and
 * nothing-composed cases end in the right place.
 */
export function composedSummaryArtifact(input: {
  title: string;
  sources: ReaderSource[];
  publishedAt?: string | null | undefined;
  whatHappened?: string | null | undefined;
  /** The sentence the readiness gate's composition published, or `""`. */
  opening?: string | null | undefined;
}): string | null {
  const composed = (input.opening ?? "").trim();
  if (composed !== "") return composed;
  if (deliveredSummary(input.whatHappened, input.title) !== null) return null;
  return deliveredSummary(
    recoveredSummaryFromSources(input.title, input.sources, { publishedAt: input.publishedAt }),
    input.title,
  );
}
