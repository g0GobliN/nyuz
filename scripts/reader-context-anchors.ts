/**
 * Which *published* blocks open on a reference the page has not established?
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-context-anchors.ts \
 *     [--limit 200] [--find "NTT"] [--corpus /tmp/corpus.json]
 *
 * A census, not a verdict -- the same standing `reader-block-shapes.ts` has. The
 * ruled ruler (`unresolvedContextOpening`) reads pronouns at position zero, and
 * the open NTT defect is neither: block 1 opens "The report models three growth
 * trajectories ..." and nothing above it -- headline, deck or earlier block --
 * ever says which report. This asks that question of every published block in
 * order, so the class has a size before a rule is proposed for it.
 *
 * It counts two shapes and classifies each:
 *
 *   - `definite`   -- a block opening on The/This/These/That/Those and a noun;
 *   - `connector`  -- "However, they ...", a pronoun behind a leading connector,
 *                     which both the ruler and the gate miss because they read
 *                     position zero.
 *
 * The definite shape is split by whether the page names its head noun above, and
 * by whether that word is capitalised in place (a proper noun names itself: "The
 * Verge reports that ..."). **The split is a screen, not a judgement.** The head
 * noun is the first content word after the article, which is sometimes an
 * adjective ("The new phone ..."), and a stem match is not a meaning match, so a
 * candidate still has to be read. What the count is good for is refusing the
 * refusal: if a tenth of the corpus opens this way and most of it reads fine, no
 * string rule may delete it.
 *
 * It measures. It changes nothing: SELECT only, the shared corpus loader, same
 * client as `db:status`.
 */

import { composeArticleWithDiagnostics } from "@/lib/editorial";
import { CORPUS_SIZE, loadCorpusEvents, storyForEvent } from "./lib/corpus.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const limit = Number(flag("--limit") ?? CORPUS_SIZE);
const find = flag("--find");
const corpus = flag("--corpus");
const events = await loadCorpusEvents(limit, find, corpus);

/** `The|This|These|That|Those <noun>` at position zero, plus the head noun. */
const DEFINITE_OPENING =
  /^(?:The|This|These|That|Those)\s+(?:[a-z][\p{L}-]*\s+){0,2}?([a-z][\p{L}-]{2,})\b/iu;
/** "However, they ..." -- the shape that hides a pronoun behind a connector. */
const CONNECTOR_PRONOUN =
  /^(?:However|But|Yet|Still|Then|Meanwhile|Instead|So|And|Also|Moreover|Though|Although|While|After|Before),\s*(?:they|it|he|she|them|these|those|this|both|its|their|his|her)\b/i;

/** A crude stem, so "report" and "reports" are the same word for this screen. */
function stem(word: string): string {
  return word
    .toLowerCase()
    .replace(/(?:ies|es|s)$/, "")
    .replace(/(?:ing|ed)$/, "");
}

type Shape =
  | "definite (proper noun)"
  | "definite (named above)"
  | "definite (unnamed above)"
  | "connector+pronoun";
type Row = { title: string; index: number; shape: Shape; noun: string; block: string };

/**
 * The nouns that name a document the story is about, where "which one" is the reader's question.
 *
 * Deliberately short and closed: it is the class the NTT and Ukraine-power stories are in, and the
 * census reports it separately so a rule for it is sized before it exists. A definite noun outside
 * this list ("The device", "The court", "The auditor") is usually resolved by the headline or by
 * ordinary inference, which is why the census does not fold them in.
 */
const DOCUMENT_NOUNS = new Set(
  "report document filing study analysis memo prospectus whitepaper assessment review guidance letter".split(
    " ",
  ),
);

const rows: Row[] = [];
const byShape: Record<string, number> = {};
let blocks = 0;
let stories = 0;
/** Stories whose first body block does not stand alone, and the document-noun subset. */
const firstBlock: { title: string; shape: Shape; noun: string; block: string }[] = [];

for (const event of events) {
  const story = storyForEvent(event);
  const { article } = composeArticleWithDiagnostics(story);
  if (article.paragraphs.length === 0) continue;
  stories += 1;
  const published = [article.deck.text, ...article.paragraphs.map((p) => p.text)].filter(
    (text) => text !== "",
  );
  published.forEach((block, index) => {
    blocks += 1;
    const trimmed = block.trim();
    const definite = DEFINITE_OPENING.exec(trimmed);
    const connector = CONNECTOR_PRONOUN.test(trimmed);
    if (!definite && !connector) return;
    // Everything the reader has read before this block, headline included.
    const above = `${event.title}\n${published.slice(0, index).join(" ")}`.toLowerCase();
    const noun = definite ? (definite[1] ?? "") : "";
    // The captured word in its original case: a capital says the noun names itself.
    const asWritten = definite ? definite[0].slice(definite[0].length - noun.length) : "";
    const shape: Shape = connector
      ? "connector+pronoun"
      : /^\p{Lu}/u.test(asWritten)
        ? "definite (proper noun)"
        : above.includes(stem(noun))
          ? "definite (named above)"
          : "definite (unnamed above)";
    byShape[shape] = (byShape[shape] ?? 0) + 1;
    rows.push({ title: event.title, index, shape, noun, block: trimmed.slice(0, 220) });
    // The deck has its own test; the block under it is the page's next sentence and
    // nothing else measures it. Index 1 is the first paragraph because index 0 is the deck.
    if (index === 1 && shape !== "definite (proper noun)" && shape !== "definite (named above)") {
      firstBlock.push({
        title: event.title,
        shape,
        noun: stem(noun),
        block: trimmed.slice(0, 220),
      });
    }
  });
}

if (find) {
  for (const event of events.slice(0, 5)) {
    const { article } = composeArticleWithDiagnostics(storyForEvent(event));
    console.log(`\n=== ${event.title}`);
    console.log(`deck: ${article.deck.text.slice(0, 160)}`);
    article.paragraphs.forEach((p, i) => console.log(`block ${i + 1}: ${p.text.slice(0, 200)}`));
  }
}

console.log(`\ncorpus: ${events.length} events, ${stories} with published prose, ${blocks} blocks`);
console.log(`  candidates: ${rows.length}`);
for (const [shape, count] of Object.entries(byShape).sort((a, b) => b[1] - a[1]))
  console.log(`    ${shape}: ${count}`);

const documentFirst = firstBlock.filter((row) => DOCUMENT_NOUNS.has(row.noun));
console.log(`\nfirst body block does not stand alone: ${firstBlock.length} of ${stories} stories`);
console.log(`  of those, a document noun the page never names: ${documentFirst.length}`);
for (const row of firstBlock) {
  console.log(`\n${row.title}  [${row.shape}${row.noun ? ` · "${row.noun}"` : ""}]`);
  console.log(`  ${row.block}`);
}
for (const row of rows) {
  console.log(
    `\n${row.title}  [block ${row.index} · ${row.shape}${row.noun ? ` · "${row.noun}"` : ""}]`,
  );
  console.log(`  ${row.block}`);
}
