import {
  centralTokens,
  numericKeys,
  readerSentences,
  sourceSeam,
  unitTextRejection,
  validDeterministicSentence,
} from "./reader-evidence";
import {
  gluedAttribution,
  hasSourceMetadata,
  hasVisibleEntity,
  malformedAttribution,
} from "./pipeline/source-text";

export type ArticleParagraph = {
  text: string;
  evidence: number[];
  heading?: string;
  /**
   * Sentences that must stay directly behind the one before them in a block.
   *
   * The composer restores source adjacency for a ranked fact that opens on a
   * reference (`they`, `this`): the sentence the author wrote immediately before
   * it is published directly in front of it. The block splitter is the last
   * place that could silently undo that, so the pair travels with its paragraph
   * and the splitter will not break it (arbiter ruling #4, 2026-10-17).
   */
  glue?: { dependent: string; predecessor: string }[];
};

export type ReaderArticle = {
  deck: { text: string; evidence: number[] };
  paragraphs: ArticleParagraph[];
};

export type ArticleProseRejection =
  | "malformed_sentence"
  | "malformed_attribution"
  | "headline_fragment"
  | "source_seam"
  | "unresolved_context"
  | "metadata_leak"
  | "entity_leak"
  | "editorial_noise"
  | "unsupported";

export type ArticleProseVerdict = { ok: true } | { ok: false; reason: ArticleProseRejection };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function prose(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text && text.length <= 20_000 ? text : null;
}

function paragraph(value: unknown, evidenceCount: number): ArticleParagraph | null {
  const row = record(value);
  const text = prose(row?.["text"]);
  if (!row || !text || !Array.isArray(row["evidence"])) return null;
  const evidence = [...new Set(row["evidence"])].filter(
    (ref): ref is number =>
      typeof ref === "number" && Number.isInteger(ref) && ref >= 1 && ref <= evidenceCount,
  );
  const heading = prose(row["heading"]);
  return { text, evidence, ...(heading ? { heading } : {}) };
}

/** Reject malformed articles whole, rather than silently dropping part of the narrative. */
export function readReaderArticle(value: unknown, evidenceCount: number): ReaderArticle | null {
  const raw = record(value);
  if (!raw || !Array.isArray(raw["paragraphs"])) return null;
  const deck = paragraph(raw["deck"], evidenceCount);
  const paragraphs = raw["paragraphs"].map((value) => paragraph(value, evidenceCount));
  if (!deck || paragraphs.some((value) => value === null)) return null;
  return {
    deck: { text: deck.text, evidence: deck.evidence },
    paragraphs: paragraphs as ArticleParagraph[],
  };
}

/**
 * Reject malformed reader prose without requiring the source excerpts to still
 * be available. This keeps old authored copies readable when the app has only
 * retained a headline, while still refusing obvious broken joins at render time.
 */
export function validateReaderArticleStructure(article: ReaderArticle): ArticleProseVerdict {
  for (const block of [article.deck, ...article.paragraphs]) {
    const sentences = readerSentences(block.text);
    if (!sentences.length) return { ok: false, reason: "malformed_sentence" };
    for (const text of sentences) {
      if (hasSourceMetadata(text)) return { ok: false, reason: "metadata_leak" };
      if (hasVisibleEntity(text)) return { ok: false, reason: "entity_leak" };
      if (sourceSeam(text)) return { ok: false, reason: "source_seam" };
      if (malformedAttribution(text) || gluedAttribution(text))
        return { ok: false, reason: "malformed_attribution" };
      const rejection = unitTextRejection(text, /["“]/.test(text));
      if (rejection !== null) {
        return {
          ok: false,
          reason:
            rejection === "headline_fragment"
              ? "headline_fragment"
              : rejection === "unresolved_context"
                ? "unresolved_context"
                : "malformed_sentence",
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Check generated prose before it is shown or cached.
 *
 * The source comparison is deliberately conservative. It catches malformed
 * joins, off-topic insertions, and unsupported figures, but does not claim to
 * prove entailment: factual support still needs semantic verification or review.
 */
export function judgeReaderArticle(
  article: ReaderArticle,
  title: string,
  evidence: readonly { title: string; excerpt: string }[],
): ArticleProseVerdict {
  const structure = validateReaderArticleStructure(article);
  if (!structure.ok) return structure;
  const sourceTokens = new Set(
    centralTokens(`${title} ${evidence.map((item) => `${item.title} ${item.excerpt}`).join(" ")}`),
  );
  for (const block of [article.deck, ...article.paragraphs]) {
    const refs = block.evidence;
    if (!refs.length || refs.some((ref) => !evidence[ref - 1]))
      return { ok: false, reason: "unsupported" };
    const sentences = readerSentences(block.text);
    for (const text of sentences) {
      const tokens = centralTokens(text);
      const overallOverlap = tokens.filter((token) => sourceTokens.has(token)).length;
      if (tokens.length >= 4 && overallOverlap < Math.max(2, Math.ceil(tokens.length * 0.18)))
        return { ok: false, reason: "unsupported" };
      // Each sentence must overlap a source cited on this block, rather than
      // borrowing its citation from an unrelated source elsewhere.
      if (
        !refs.some((ref) => {
          const source = evidence[ref - 1];
          if (!source) return false;
          const citedTokens = new Set(centralTokens(`${source.title} ${source.excerpt}`));
          const shared = tokens.filter((token) => citedTokens.has(token)).length;
          return shared >= (tokens.length <= 2 ? 1 : 2);
        })
      )
        return { ok: false, reason: "unsupported" };
      const figures = numericKeys(text);
      if (
        figures.some(
          (figure) =>
            !refs.some((ref) => {
              const source = evidence[ref - 1];
              return source && numericKeys(`${source.title} ${source.excerpt}`).includes(figure);
            }),
        )
      )
        return { ok: false, reason: "unsupported" };
    }
  }
  return { ok: true };
}

export function articleMinutes(article: ReaderArticle): number {
  const words = [article.deck.text, ...article.paragraphs.map((p) => p.text)]
    .join(" ")
    .trim()
    .split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 220));
}

/** Collapse for comparison: case, punctuation and whitespace, as every instrument does. */
const flatSentence = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

/**
 * The body with its own opening removed, so a reader never reads one sentence twice.
 *
 * **Why this exists.** The page's opening is now the sentence the card printed
 * (`storyOpening`, `reader-opening.ts`), not necessarily the deck the composer
 * built. The composition picks its body facts from the same evidence, and when
 * the stored line *is* one of those facts the reader would meet it twice: once
 * as the opening and again inside the first paragraph. Measured on the feed's
 * own 56 cards (2026-10-20): **19** stored lines are a whole sentence inside a
 * composed paragraph, **1** is a whole paragraph, and **none** of the 19 takes
 * part in a `glue` pair — so the sentence can be lifted without breaking the
 * adjacency the composer restored.
 *
 * The rule is exact equality after case/punctuation collapse, never a prefix or
 * a fuzzy match: a sentence that merely resembles the opening is a different
 * fact and stays. When the opening is the composition's own deck nothing
 * matches (the composer spends that fact on the deck), so the rule is a no-op
 * for every story that already agreed.
 */
export function withoutOpening(article: ReaderArticle, opening: string): ReaderArticle {
  const target = flatSentence(opening);
  if (target === "") return article;
  const paragraphs = article.paragraphs.flatMap((paragraph) => {
    const sentences = readerSentences(paragraph.text);
    if (sentences.length <= 1) {
      return flatSentence(paragraph.text) === target ? [] : [paragraph];
    }
    const kept = sentences.filter((sentence) => flatSentence(sentence) !== target);
    if (kept.length === sentences.length) return [paragraph];
    if (kept.length === 0) return [];
    const glue = paragraph.glue?.filter(
      (pair) => kept.includes(pair.dependent) && kept.includes(pair.predecessor),
    );
    return [
      {
        ...paragraph,
        text: kept.join(" "),
        ...(glue !== undefined && glue.length > 0 ? { glue } : {}),
      },
    ];
  });
  return { ...article, paragraphs };
}

export const READER_ARTICLE_CONTRACT = `
article is the reader-facing article, separate from internal structured analysis.
First understand all the supplied evidence and its limitations, then write one
connected editorial narrative from beginning to end. Do not write independent
fact fragments or expose the analysis categories as sections.

Use this article shape inside understand:
"article": {
  "deck": { "text": "1-2 sentences introducing the event and why it is worth reading, without repeating the headline", "evidence": [1] },
  "paragraphs": [{ "text": "a natural paragraph developing the story", "evidence": [1], "heading": null }]
}

The deck leads into the body; the first body paragraph should advance it, not
repeat it. Cover meaningful new facts, important numbers, relevant context,
practical consequences, conflicting accounts and key uncertainty where supported
by the supplied evidence. Distinguish reported facts from bounded implications;
never add unsupported background, speculation or invented facts.

Write only as much as the story genuinely needs. There is no minimum word count
or paragraph count. Rough guidance, never targets: a simple update may need
250-400 words, a normal story 450-700, and a complex major story more if useful.
Thin evidence can justify much less. A complete 320-word story stops at 320.
Never pad to reach a range. Do not repeat facts, add generic industry history,
restate the introduction at the end, or invent an empty conclusion.
For every paragraph ask: if removed, would the reader be meaningfully less
informed? If not, remove it. Usually 5-7 reasonably short paragraphs suffice,
but let the evidence determine both length and flow. Vary paragraph lengths.

Use clear modern English, short to medium sentences, concrete language, natural
transitions and a calm editorial tone. Avoid PR language, analyst jargon, robotic
transitions and cliches such as "In today's rapidly evolving landscape",
"It remains to be seen" and "This marks a significant milestone".

Most articles need zero or one subheading. Set heading to null by default.
Only attach a natural subheading to a paragraph at a real topic transition that
introduces multiple paragraphs. Longer stories may use more when necessary.
Never force headings such as What happened, Why it matters, The picture,
New in this announcement, The details or What to watch into each story.
Use connected prose, without cards, diagrams, scores or routine bullet lists.
Do not add a source list, Sources footer, repeated publication credits, or inline
source URLs. Attribution lives in the sidebar. Put citation numbers in evidence,
not in text; use only the numbered sources that support each paragraph or deck.
Preserve attribution within a sentence when it is necessary to identify a claim,
quote or disagreement. Do not imply that an attributed claim is an established fact.
The article synthesizes the internal facts; internal deduplication rules do not
prevent a meaningful fact or number appearing in the article once.
`;
