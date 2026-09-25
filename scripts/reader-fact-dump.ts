/**
 * Every corpus event's *selected facts*, dumped as JSON.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-fact-dump.ts \
 *     --out /tmp/facts-after.json --corpus /tmp/corpus.json
 *
 * The audit reports `facts selected` for the corpus as a whole. When that number
 * moves, an aggregate cannot say *which* fact stopped being selected or why, and
 * "eleven fewer facts" is not an answer a reviewer can act on. Two dumps of the
 * same frozen corpus, one from a worktree at another commit, are that answer:
 * the diff names the sentences, and the refusal counters name the rule that took
 * each one.
 *
 * Writes nothing: SELECT only, same client as `db:status`.
 */

import { writeFileSync } from "node:fs";
import { composeArticleWithDiagnostics } from "@/lib/editorial";
import { selectReaderEvidence } from "@/lib/reader-evidence";
import { CORPUS_SIZE, loadCorpusEvents, storyForEvent } from "./lib/corpus.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = flag("--out");
if (!out) throw new Error("usage: --out <file.json> [--corpus FILE] [--limit N]");

const events = await loadCorpusEvents(
  Number(flag("--limit") ?? CORPUS_SIZE),
  undefined,
  flag("--corpus"),
);
const stories = events.map((event) => {
  const story = storyForEvent(event);
  const selection = selectReaderEvidence(story.title, story.sourceList);
  const { article, diagnostics } = composeArticleWithDiagnostics(story);
  return {
    id: event.id,
    title: event.title,
    facts: selection.facts.map((fact) => ({
      text: fact.text,
      evidence: fact.evidence,
      origin: fact.origin,
    })),
    rejectionReasons: selection.rejectionReasons,
    counts: diagnostics.facts,
    reasons: diagnostics.sentences.reasons,
    blocks: [article.deck.text, ...article.paragraphs.map((paragraph) => paragraph.text)].filter(
      (block) => block !== "",
    ),
  };
});

writeFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), stories }, null, 1)}\n`);
console.log(`${stories.length} events -> ${out}`);
