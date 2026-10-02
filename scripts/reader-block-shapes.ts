/**
 * Which *published* blocks are not reporting prose, and where each one came
 * from. A census, not a verdict: the families are read by hand out of this
 * output, because a rule designed from punctuation would refuse prose.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-block-shapes.ts \
 *     [--corpus /tmp/corpus.json] [--all]
 *
 * The question it answers is the one a rule needs before it exists: do the
 * blocks that read as a link list, a related-headline paste or a release-note
 * bullet run share a structural signature at the source, or are they unrelated
 * mechanisms that only look alike on the page? So every candidate is printed
 * with two things the page cannot show:
 *
 *   - its signals (a spaced dash, a heading-shaped sentence, an imperative
 *     opening, an enumeration, a run of short sentences), which screen for
 *     candidates and are deliberately coarse;
 *   - its provenance: for each sentence in the block, the source units that
 *     contain it -- name, kind (excerpt sentence or article-page enrichment),
 *     and the shape of that unit -- plus whether any item carries a usable
 *     claim.
 *
 * `--all` prints every published block, so a family the signals miss can be
 * found by reading rather than by trusting the screen.
 *
 * Writes /tmp/block-shapes.json. Reads the database (SELECT only), or a frozen
 * corpus file with `--corpus`.
 */

import { writeFileSync } from "node:fs";
import { composeArticleWithDiagnostics } from "@/lib/editorial";
import {
  hasPredicate,
  headingUnit,
  normalizeReaderSources,
  readerSentences,
  sentenceKey,
} from "@/lib/reader-evidence";
import { CORPUS_SIZE, loadCorpusEvents, storyForEvent } from "./lib/corpus.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const printAll = args.includes("--all");

/** A sentence that opens on a base verb, which no reporting sentence does. */
const IMPERATIVE_OPENING =
  /^(?:Detect|Integrate|Replace|Deploy|Configure|Use|Try|Read|Learn|Follow|Get|See|Set|Build|Create|Manage|Enable|Install|Update|Run|Add|Make|Publish|Host|Apply|Register|Sign)\b/;

/** The signals a candidate is screened on. Coarse on purpose, see the header. */
function signals(block: string): string[] {
  const found: string[] = [];
  const parts = readerSentences(block);
  if (/\s[—–]\s/.test(block)) found.push("dash");
  const titles = parts.filter((part) => headingUnit(part)).length;
  if (titles > 0) found.push(`heading-sentence x${titles}`);
  const imperatives = parts.filter((part) => IMPERATIVE_OPENING.test(part.trim())).length;
  if (imperatives > 0) found.push(`imperative x${imperatives}`);
  const semis = parts.filter((part) => (part.match(/;/g) ?? []).length >= 2).length;
  if (semis > 0) found.push(`enumeration x${semis}`);
  const short = parts.filter((part) => part.length < 70).length;
  if (short >= 2) found.push(`short-run x${short}`);
  return found;
}

/** Everything a source unit can say about its own shape. */
function unitShape(text: string): string {
  const parts: string[] = [];
  if (/\s[—–]\s/.test(text)) parts.push("dash");
  if (headingUnit(text)) parts.push("heading");
  if (!hasPredicate(text)) parts.push("no-predicate");
  if (IMPERATIVE_OPENING.test(text.trim())) parts.push("imperative");
  if (text.length < 90) parts.push("short");
  if (/[;:]/.test(text)) parts.push("punctuated");
  return parts.join("+") || "sentence";
}

/** Whether the unit states something a reader could use as a fact. */
function claimShaped(text: string): boolean {
  return hasPredicate(text) && !headingUnit(text) && text.length >= 50;
}

type Provenance = { source: string; kind: "excerpt" | "enriched"; shape: string; claim: boolean };

const events = await loadCorpusEvents(CORPUS_SIZE, undefined, flag("--corpus"));
type Row = {
  story: string;
  signals: string[];
  block: string;
  provenance: (Provenance | null)[];
};
const rows: Row[] = [];
const bySignal: Record<string, number> = {};
let blocks = 0;

for (const event of events) {
  const story = storyForEvent(event);
  const { article } = composeArticleWithDiagnostics(story);
  const { sources } = normalizeReaderSources(story.sourceList);
  // Every unit the composer read, in the same shape it read it.
  const units: { text: string; provenance: Provenance }[] = sources.flatMap((source) => [
    ...(source.excerpt ?? "")
      .split(/(?<=[.!?])\s+/)
      .filter((text) => text.trim() !== "")
      .map((text) => ({
        text,
        provenance: {
          source: source.name ?? "?",
          kind: "excerpt" as const,
          shape: unitShape(text),
          claim: claimShaped(text),
        },
      })),
    ...(source.enrichedEvidence ?? []).map((unit) => ({
      text: unit.text,
      provenance: {
        source: source.name ?? "?",
        kind: "enriched" as const,
        shape: unitShape(unit.text),
        claim: claimShaped(unit.text),
      },
    })),
  ]);
  const published = [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)];
  for (const block of published) {
    if (block === "") continue;
    blocks += 1;
    const found = signals(block);
    if (!printAll && found.length === 0) continue;
    for (const signal of found) bySignal[signal] = (bySignal[signal] ?? 0) + 1;
    const provenance = readerSentences(block).map((part) => {
      const key = sentenceKey(part);
      if (key === "") return null;
      const unit = units.find((candidate) => sentenceKey(candidate.text).includes(key));
      return unit ? unit.provenance : null;
    });
    rows.push({ story: event.title, signals: found, block, provenance });
  }
}
console.log(`published blocks: ${blocks}`);
console.log(
  `candidates: ${rows.length}${printAll ? " (--all: every published block printed)" : ""}`,
);
for (const [signal, count] of Object.entries(bySignal).sort((a, b) => b[1] - a[1]))
  console.log(`  ${signal}: ${count}`);
const stories = new Set(rows.map((row) => row.story));
console.log(`  distinct stories: ${stories.size}`);

for (const row of rows) {
  console.log(`\n${row.story}`);
  console.log(`  signals: ${row.signals.join(", ")}`);
  console.log(`  block: ${row.block.slice(0, 300)}`);
  for (const [index, item] of row.provenance.entries()) {
    const part = readerSentences(row.block)[index] ?? "";
    console.log(
      item
        ? `  item ${index + 1}: [${item.source} · ${item.kind} · ${item.shape} · claim=${item.claim}] ${part.slice(0, 140)}`
        : `  item ${index + 1}: [no source unit matched] ${part.slice(0, 140)}`,
    );
  }
}

writeFileSync("/tmp/block-shapes.json", `${JSON.stringify({ rows }, null, 1)}\n`);
