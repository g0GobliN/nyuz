/**
 * Every corpus story the composer publishes, dumped as JSON.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-composer-snapshot.ts \
 *     --out /tmp/after.json [--corpus /tmp/corpus.json]
 *
 * The point is comparison. The audit reports what the rules did; two snapshots
 * report what they *cost* -- story by story, which is the only way to see prose
 * that was quietly deleted. It runs from any checkout, so the same command
 * inside a pristine worktree produces the "before" side of the same corpus.
 *
 * Writes nothing to the database: SELECT only, same client as `db:status`.
 */

import { writeFileSync } from "node:fs";
import { composeArticle } from "@/lib/editorial";
import { CORPUS_SIZE, loadCorpusEvents, storyForEvent } from "./lib/corpus.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const out = flag("--out");
if (!out) throw new Error("usage: --out <file.json> [--limit N] [--find TEXT] [--corpus FILE]");
const limit = Number(flag("--limit") ?? CORPUS_SIZE);
const find = flag("--find");
// A frozen corpus file: the live window slides, so two snapshots of it are two
// populations. See `freezeCorpus`.
const corpus = flag("--corpus");

const events = await loadCorpusEvents(limit, find, corpus);
const stories = events.map((event) => {
  const article = composeArticle(storyForEvent(event));
  return {
    id: event.id,
    title: event.title,
    sources: event.sourceList.length,
    deck: article.deck.text,
    paragraphs: article.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      evidence: paragraph.evidence,
    })),
  };
});

writeFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), stories }, null, 1)}\n`);
console.log(`${stories.length} stories -> ${out}`);
