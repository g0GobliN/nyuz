/**
 * What changed between two snapshots of the same corpus.
 *
 *   node scripts/tsrun.mjs scripts/reader-composer-diff.ts before.json after.json
 *
 * The aggregate rows answer "did the defects go down". The last section answers
 * the question an aggregate cannot: which stories were rewritten hardest, what
 * disappeared from them, and whether any story lost its paragraphs entirely.
 * A rule can produce beautiful totals while deleting legitimate prose, and the
 * only place that shows is a story read by hand -- so this prints the material
 * to read: the words that were there before and are not there now.
 *
 * The defect rulers are the shared ones in `lib/defects.ts`, so this file and the
 * audit cannot disagree about what a malformed attribution is.
 */

import { readFileSync } from "node:fs";
import { hasSourceMetadata } from "@/lib/pipeline/source-text";
import { unresolvedContextOpening } from "@/lib/reader-evidence";
import {
  DOUBLE_SPACE,
  ENTITY_LEAK,
  GLUED_ATTRIBUTION,
  LEADING_QUOTE,
  OPENS_ON_QUOTE,
  SPACE_BEFORE_PUNCT,
  TWO_QUOTES,
} from "./lib/defects.ts";
import { heading, main, row, say } from "./lib/db.ts";

type Block = { text: string; evidence: number[] };
type SnapshotStory = {
  id: string;
  title: string;
  sources: number;
  deck: string;
  paragraphs: Block[];
};
type Snapshot = { at: string; stories: SnapshotStory[] };

const HOW_MANY = 15;
const CLIP = 300;

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const clip = (text: string, max = CLIP): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?]["”]?)\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const key = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function blocksOf(story: SnapshotStory): string[] {
  return [story.deck, ...story.paragraphs.map((paragraph) => paragraph.text)].filter(
    (block) => block !== "",
  );
}

type Metrics = {
  stories: number;
  words: number;
  paragraphs: number;
  zero: number;
  deckOnly: number;
  nothing: number;
  entity: number;
  metadata: number;
  glued: number;
  context: number;
  spacing: number;
  doubleSpace: number;
  twoQuotes: number;
  /** A block opening on a stray closing quote: a cut quotation's tail. */
  strayQuote: number;
  /** A block whose first character is a quotation mark: a quotation as a lead. */
  opensOnQuote: number;
  duplicateRefs: number;
  withRefs: number;
};

function measure(snapshot: Snapshot): Metrics {
  const metrics: Metrics = {
    stories: snapshot.stories.length,
    words: 0,
    paragraphs: 0,
    zero: 0,
    deckOnly: 0,
    nothing: 0,
    entity: 0,
    metadata: 0,
    glued: 0,
    context: 0,
    spacing: 0,
    doubleSpace: 0,
    twoQuotes: 0,
    strayQuote: 0,
    opensOnQuote: 0,
    duplicateRefs: 0,
    withRefs: 0,
  };
  for (const story of snapshot.stories) {
    const blocks = blocksOf(story);
    metrics.words += words(blocks.join(" "));
    metrics.paragraphs += story.paragraphs.length;
    if (story.paragraphs.length === 0) {
      metrics.zero += 1;
      if (story.deck) metrics.deckOnly += 1;
      else metrics.nothing += 1;
    }
    for (const block of blocks) {
      if (ENTITY_LEAK.test(block)) metrics.entity += 1;
      if (hasSourceMetadata(block)) metrics.metadata += 1;
      if (GLUED_ATTRIBUTION.test(block)) metrics.glued += 1;
      if (unresolvedContextOpening(block)) metrics.context += 1;
      if (SPACE_BEFORE_PUNCT.test(block)) metrics.spacing += 1;
      if (DOUBLE_SPACE.test(block)) metrics.doubleSpace += 1;
      if (TWO_QUOTES.test(block)) metrics.twoQuotes += 1;
      if (LEADING_QUOTE.test(block)) metrics.strayQuote += 1;
      if (OPENS_ON_QUOTE.test(block)) metrics.opensOnQuote += 1;
    }
    for (const paragraph of story.paragraphs) {
      if (paragraph.evidence.length > 0) metrics.withRefs += 1;
      if (new Set(paragraph.evidence).size !== paragraph.evidence.length)
        metrics.duplicateRefs += 1;
    }
  }
  return metrics;
}

main(async () => {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    throw new Error("usage: <before.json> <after.json>");
  }
  const beforeRaw: Snapshot = JSON.parse(readFileSync(beforePath, "utf8"));
  const afterRaw: Snapshot = JSON.parse(readFileSync(afterPath, "utf8"));
  // Same population, or the aggregates are not comparable: the corpus is live, so
  // a snapshot taken an hour earlier has a different newest-N than this one. Both
  // sides are cut to the stories they share, and the cut is printed rather than
  // left for the reader to wonder about.
  const shared = new Set(
    beforeRaw.stories
      .map((story) => story.id)
      .filter((id) => afterRaw.stories.some((s) => s.id === id)),
  );
  const before: Snapshot = {
    at: beforeRaw.at,
    stories: beforeRaw.stories.filter((story) => shared.has(story.id)),
  };
  const after: Snapshot = {
    at: afterRaw.at,
    stories: afterRaw.stories.filter((story) => shared.has(story.id)),
  };
  const arrived = afterRaw.stories.length - shared.size;
  const agedOut = beforeRaw.stories.length - shared.size;
  // A diff of two disjoint windows is not a diff: it is a table of zeroes that
  // reads like "nothing changed". Refusing here is the whole reason the corpus can
  // be frozen (`--corpus`); a report that cannot tell two rules apart from two
  // days apart has no business printing a conclusion.
  if (shared.size === 0) {
    say("no story appears in both snapshots -- these are two different windows.");
    say("freeze a corpus (scripts/reader-corpus-freeze.ts) and snapshot both sides from it.");
    return;
  }
  if (arrived !== 0 || agedOut !== 0) {
    say(
      `compared on the ${shared.size} stories both snapshots have; ${arrived} event(s) arrived and ${agedOut} aged out of the window between the runs`,
    );
  }
  const a = measure(before);
  const b = measure(after);

  heading(`Structure (${before.at.slice(0, 10)} -> ${after.at.slice(0, 10)})`);
  const average = (value: number, stories: number) => (value / Math.max(1, stories)).toFixed(1);
  say(row("stories", `${a.stories} -> ${b.stories}`));
  say(row("words, average", `${average(a.words, a.stories)} -> ${average(b.words, b.stories)}`));
  say(
    row(
      "paragraphs, average",
      `${(a.paragraphs / Math.max(1, a.stories)).toFixed(2)} -> ${(
        b.paragraphs / Math.max(1, b.stories)
      ).toFixed(2)}`,
    ),
  );
  say(row("story with no paragraphs", `${a.zero} -> ${b.zero}`));
  say(row("  deck only", `${a.deckOnly} -> ${b.deckOnly}`));
  say(row("  nothing at all", `${a.nothing} -> ${b.nothing}`));

  heading("Reader-visible defects (counted on the published prose)");
  const pair = (label: string, first: number, second: number) =>
    say(row(label, `${first} -> ${second}${second === first ? " (same)" : ""}`));
  pair("entity leaks", a.entity, b.entity);
  pair("metadata leaks", a.metadata, b.metadata);
  pair("malformed attribution", a.glued, b.glued);
  pair("context-dependent openings", a.context, b.context);
  pair("space before punctuation", a.spacing, b.spacing);
  pair("double spaces", a.doubleSpace, b.doubleSpace);
  pair("two quotes in one block", a.twoQuotes, b.twoQuotes);
  // Two rulers, two rows: the audit's "block opening with a quote" counts a
  // quotation in the lead slot (`OPENS_ON_QUOTE`), and this row used to carry
  // that label while measuring the opposite thing -- a block opening on a stray
  // *closing* quote, which is a cut quotation's tail. One label, one ruler.
  pair("block opening on a stray quote", a.strayQuote, b.strayQuote);
  pair("quotation in the lead slot", a.opensOnQuote, b.opensOnQuote);
  pair("duplicate citation in a block", a.duplicateRefs, b.duplicateRefs);
  pair("paragraphs carrying a citation", a.withRefs, b.withRefs);

  const beforeById = new Map(before.stories.map((story) => [story.id, story]));
  type Change = {
    story: SnapshotStory;
    was: SnapshotStory;
    delta: number;
    lost: string[];
    added: string[];
  };
  const changes: Change[] = [];
  let emptied = 0;
  let filled = 0;
  const heavy = 25;

  for (const story of after.stories) {
    const was = beforeById.get(story.id);
    if (!was) continue;
    const oldText = blocksOf(was).join(" ");
    const newText = blocksOf(story).join(" ");
    const delta = words(oldText) - words(newText);
    const oldSentences = new Set(sentences(oldText).map(key));
    const newSentences = new Set(sentences(newText).map(key));
    const lost = sentences(oldText).filter((part) => !newSentences.has(key(part)));
    const added = sentences(newText).filter((part) => !oldSentences.has(key(part)));
    if (was.paragraphs.length > 0 && story.paragraphs.length === 0) emptied += 1;
    if (was.paragraphs.length === 0 && story.paragraphs.length > 0) filled += 1;
    if (Math.abs(delta) >= heavy || lost.length > 0 || added.length > 0) {
      changes.push({ story, was, delta, lost, added });
    }
  }

  heading("What moved");
  say(row("stories rewritten at all", changes.length));
  say(
    row(
      `stories that lost or gained ${heavy}+ words`,
      changes.filter((c) => Math.abs(c.delta) >= heavy).length,
    ),
  );
  say(row("stories that became empty", emptied));
  say(row("stories that stopped being empty", filled));
  // A story that publishes nothing is the one outcome a reader cannot work
  // around, so it is counted and printed whatever its size: a rule that keeps
  // prose clean by deleting the page is not a fix.
  const silenced = after.stories.filter((story) => {
    const was = beforeById.get(story.id);
    return was !== undefined && blocksOf(was).length > 0 && blocksOf(story).length === 0;
  });
  const revived = after.stories.filter((story) => {
    const was = beforeById.get(story.id);
    return was !== undefined && blocksOf(was).length === 0 && blocksOf(story).length > 0;
  });
  say(row("stories that now publish nothing", silenced.length));
  say(row("stories that now publish something", revived.length));
  for (const story of silenced.slice(0, 8)) {
    const was = beforeById.get(story.id)!;
    say(`    · ${story.title}`);
    say(`      was: ${clip(blocksOf(was).join(" "), 240)}`);
  }
  for (const story of revived.slice(0, 4)) {
    say(`    + ${story.title}`);
    say(`      now: ${clip(blocksOf(story).join(" "), 240)}`);
  }

  // What came *back* is as important as what went, and it is the list a reviewer
  // reads first: a rule that only ever subtracts looks the same as one that
  // deletes real prose.
  const restored = changes
    .filter((change) => change.delta < 0)
    .sort((left, right) => left.delta - right.delta);
  heading(`The ${Math.min(HOW_MANY, restored.length)} stories that gained the most`);
  for (const change of restored.slice(0, HOW_MANY)) {
    say("");
    say(`+${Math.abs(change.delta)} words  ${change.story.title}`);
    say(
      `    words ${words(blocksOf(change.was).join(" "))} -> ${words(
        blocksOf(change.story).join(" "),
      )} · paragraphs ${change.was.paragraphs.length} -> ${change.story.paragraphs.length}`,
    );
    for (const part of change.added.slice(0, 4)) say(`      · ${clip(part, 220)}`);
  }

  changes.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  heading(`The ${HOW_MANY} stories this changed most, out of ${changes.length}`);
  for (const change of changes.slice(0, HOW_MANY)) {
    say("");
    say(`${change.delta > 0 ? "-" : "+"}${Math.abs(change.delta)} words  ${change.story.title}`);
    say(
      `    words ${words(blocksOf(change.was).join(" "))} -> ${words(
        blocksOf(change.story).join(" "),
      )} · paragraphs ${change.was.paragraphs.length} -> ${change.story.paragraphs.length} · ${change.story.sources} source(s)`,
    );
    if (change.lost.length > 0) {
      say(`    gone (${change.lost.length}):`);
      for (const part of change.lost.slice(0, 6)) say(`      · ${clip(part, 220)}`);
    }
    if (change.added.length > 0) {
      say(`    new (${change.added.length}):`);
      for (const part of change.added.slice(0, 4)) say(`      · ${clip(part, 220)}`);
    }
    say(`    deck now: ${clip(change.story.deck, 220)}`);
  }
});
