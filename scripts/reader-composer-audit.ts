/**
 * What the deterministic composer actually publishes, read from live events.
 *
 *   npm run audit:reader                      -- summary over the corpus
 *   npm run audit:reader -- --find "DigiCert" -- dump one event's raw rows
 *   npm run audit:reader -- --show 5          -- print the first five stories in full
 *   npm run audit:reader -- --changed 15      -- the 15 stories the rules acted on most
 *   npm run audit:reader -- --changed 15 --full  -- ... and their whole text
 *   npm run audit:reader -- --corpus /tmp/corpus.json
 *                                             -- audit a frozen corpus instead
 *                                                of the sliding live window
 *
 * The metrics are deliberately counted by *reading the published prose*, not by
 * trusting the composer's own counters: a leak the composer does not know about
 * is exactly the kind of leak worth measuring. The counters say how much the
 * boundary did; the samples say whether it was right, which is the question a
 * counter cannot answer. Every rewrite the composer performs keeps a bounded
 * before/after example, and a story is ranked by how many of them it has.
 *
 * It writes nothing: SELECT only, service-role client, same as `db:status`.
 * Node 22 or later: `@supabase/supabase-js` needs a native WebSocket, so this
 * cannot run on Node 20 -- use `~/.nvm/versions/node/v22.x/bin/node`.
 */

import { composeArticleWithDiagnostics } from "@/lib/editorial";
import { hasSourceMetadata, hasVisibleEntity } from "@/lib/pipeline/source-text";
import {
  headingUnit,
  readerSentences,
  sourceColour,
  unresolvableContext,
  unresolvedContextOpening,
} from "@/lib/reader-evidence";
import {
  CORPUS_SIZE,
  loadCorpusEvents,
  loadFixtureEvents,
  storyForEvent,
  type CorpusEvent as Row,
} from "./lib/corpus.ts";
import * as DEFECTS from "./lib/defects.ts";
import { heading, main, row, say } from "./lib/db.ts";
/** Before/after examples printed per kind, across the whole corpus. */
const EXAMPLES_PER_KIND = 6;

/**
 * The refusal reasons as a reader of this report should read them.
 *
 * `unresolved_context` is the counter that misleads: it counts a sentence opening
 * on a pronoun with nothing to point at, which is a context-dependent *opening*, not
 * an unresolved defect left on the page. Every one of them was refused, so the row
 * is a count of refusals by that rule -- the defects that survive to the prose are
 * the `context-dependent openings` row above, measured by reading the output.
 */
const REASON_LABEL: Record<string, string> = {
  unresolved_context: "context-dependent opening (refused)",
};
/** The stories printed in full when `--full` is passed. */
const MORE = 8;

/**
 * The rulers, shared with the before/after diff so the two cannot disagree about
 * what a defect is -- and with the fixture tests, which is where a report that
 * contradicts its own sample comes from.
 */
const ENTITY_LEAK = DEFECTS.ENTITY_LEAK;
const GLUED_ATTRIBUTION = DEFECTS.GLUED_ATTRIBUTION;
const DOUBLE_SPACE = DEFECTS.DOUBLE_SPACE;
const TWO_QUOTES = DEFECTS.TWO_QUOTES;
const LEADING_QUOTE = DEFECTS.OPENS_ON_QUOTE;

const clip = (text: string, max = 180): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Defects counted on the *input* the composer is handed, per raw sentence.
 *
 * The honest way to report "before" for a patch like this one: the composed
 * output only shows what survived, so the number of sentences that arrived
 * carrying each defect is what says how much work the boundary is doing.
 */
type InputCensus = {
  sentences: number;
  entities: number;
  headingUnits: number;
  gluedAttribution: number;
  unresolvableContext: number;
  sourceColour: number;
};

function emptyCensus(): InputCensus {
  return {
    sentences: 0,
    entities: 0,
    headingUnits: 0,
    gluedAttribution: 0,
    unresolvableContext: 0,
    sourceColour: 0,
  };
}

type Totals = {
  stories: number;
  words: number;
  paragraphs: number;
  zeroParagraph: number;
  deckOnly: number;
  noDeckNoParagraph: number;
  paragraphsWithRefs: number;
  duplicateRefBlocks: number;
  entityLeaks: number;
  metadataLeaks: number;
  gluedAttribution: number;
  unresolvedContext: number;
  doubleSpace: number;
  doubleQuotes: number;
  bareQuoteSentence: number;
  selectedFacts: number;
  renderedFacts: number;
  lostFacts: number;
  rejectedFacts: number;
  refusedFacts: number;
  restatements: number;
  sentencesRefused: number;
  voiceStripped: number;
  framesStripped: number;
  /** Words published lowercase that their source only ever capitalises. */
  caseRewrites: number;
  relativeTimesAnchored: number;
  relativeTimesStripped: number;
  narratorWrappersRemoved: number;
  authorAttributedFacts: number;
  ambiguousNarratorRejected: number;
  relativeTimeRefusals: number;
  colourRejections: number;
  /** Sources refused whole as digests of other publications' stories. */
  refusedDigests: number;
};

function emptyTotals(): Totals {
  return {
    stories: 0,
    words: 0,
    paragraphs: 0,
    zeroParagraph: 0,
    deckOnly: 0,
    noDeckNoParagraph: 0,
    paragraphsWithRefs: 0,
    duplicateRefBlocks: 0,
    entityLeaks: 0,
    metadataLeaks: 0,
    gluedAttribution: 0,
    unresolvedContext: 0,
    doubleSpace: 0,
    doubleQuotes: 0,
    bareQuoteSentence: 0,
    selectedFacts: 0,
    renderedFacts: 0,
    lostFacts: 0,
    rejectedFacts: 0,
    refusedFacts: 0,
    restatements: 0,
    sentencesRefused: 0,
    voiceStripped: 0,
    framesStripped: 0,
    caseRewrites: 0,
    relativeTimesAnchored: 0,
    relativeTimesStripped: 0,
    narratorWrappersRemoved: 0,
    authorAttributedFacts: 0,
    ambiguousNarratorRejected: 0,
    relativeTimeRefusals: 0,
    colourRejections: 0,
    refusedDigests: 0,
  };
}

/** One event, and how much of this patch's work landed on it. */
type Changed = {
  title: string;
  score: number;
  line: string;
  deck: string;
  paragraphs: string[];
  samples: string[];
};

main(async () => {
  const args = process.argv.slice(2);
  const findIndex = args.indexOf("--find");
  const find = findIndex >= 0 ? args[findIndex + 1] : undefined;
  const showIndex = args.indexOf("--show");
  const show = showIndex >= 0 ? Number(args[showIndex + 1] ?? 0) : 0;
  const changedIndex = args.indexOf("--changed");
  const changedLimit = changedIndex >= 0 ? Number(args[changedIndex + 1] ?? 12) : 0;
  const full = args.includes("--full");
  // A frozen corpus file, so this run and the next measure the same events.
  const corpusIndex = args.indexOf("--corpus");
  const corpus = corpusIndex >= 0 ? args[corpusIndex + 1] : undefined;

  const events = args.includes("--fixtures")
    ? await loadFixtureEvents()
    : await loadCorpusEvents(find ? 50 : CORPUS_SIZE, find, corpus);
  if (events.length === 0) {
    say(find ? `No event matching "${find}".` : "No completed events.");
    return;
  }

  const totals = emptyTotals();
  const census = emptyCensus();
  const offenders: string[] = [];
  const refusedByReason: Record<string, number> = {};
  const attributionShapes: Record<string, number> = {};
  const examples: Record<string, string[]> = {
    voiceStrips: [],
    frames: [],
    relativeTimes: [],
    droppedContext: [],
    narrator: [],
  };
  /** Which words were lowercased, and how often, when the source never does. */
  const caseWords = new Map<string, number>();
  /** The facts behind `facts lost`, in full, with the story they came from. */
  const lostFacts: string[] = [];
  const changed: Changed[] = [];
  const tally = (counter: Record<string, number>, key: string) => {
    counter[key] = (counter[key] ?? 0) + 1;
  };

  for (const event of events) {
    // No `understand`, so the composer takes the deterministic path -- the path
    // this audit is about, and the one the production story was rendered by.
    const { article, diagnostics } = composeArticleWithDiagnostics(storyForEvent(event));
    const paras = article.paragraphs.map((p) => p.text);
    const text = [article.deck.text, ...paras].join(" ");

    if (show > 0 && totals.stories < show) {
      heading(event.title);
      say(`deck: ${article.deck.text}`);
      paras.forEach((p, i) => say(`  ${i + 1}. ${p}`));
      say(
        `ordering=${diagnostics.ordering} selected=${diagnostics.facts.selected} rendered=${diagnostics.facts.rendered} lost=${diagnostics.facts.lost}`,
      );
      say(`refused: ${JSON.stringify(diagnostics.sentences.reasons)}`);
      continue;
    }

    for (const source of event.sourceList) {
      for (const sentence of readerSentences(source.excerpt ?? "")) {
        census.sentences += 1;
        if (hasVisibleEntity(sentence)) census.entities += 1;
        if (headingUnit(sentence)) census.headingUnits += 1;
        if (GLUED_ATTRIBUTION.test(sentence)) census.gluedAttribution += 1;
        if (unresolvableContext(sentence)) census.unresolvableContext += 1;
        if (sourceColour(sentence)) census.sourceColour += 1;
      }
    }

    totals.stories += 1;
    totals.words += text.split(/\s+/).filter(Boolean).length;
    totals.paragraphs += paras.length;
    if (paras.length === 0) totals.zeroParagraph += 1;
    if (paras.length === 0 && article.deck.text) totals.deckOnly += 1;
    if (paras.length === 0 && !article.deck.text) totals.noDeckNoParagraph += 1;
    totals.selectedFacts += diagnostics.facts.selected;
    totals.renderedFacts += diagnostics.facts.rendered;
    totals.lostFacts += diagnostics.facts.lost;
    for (const text of diagnostics.facts.lostFacts) lostFacts.push(`${event.title} · ${text}`);
    totals.rejectedFacts += diagnostics.facts.rejected;
    totals.refusedFacts += diagnostics.facts.refused;
    totals.restatements += diagnostics.dedupe.restatements;
    totals.sentencesRefused += diagnostics.sentences.refused;
    totals.voiceStripped += diagnostics.sourceNormalization.sourceVoiceStripped;
    totals.framesStripped += diagnostics.sourceNormalization.strippedFrames;
    totals.relativeTimesAnchored += diagnostics.sourceNormalization.relativeTimesAnchored;
    totals.relativeTimesStripped += diagnostics.sourceNormalization.relativeTimesStripped;
    totals.narratorWrappersRemoved += diagnostics.sourceNormalization.narratorWrappersRemoved;
    totals.authorAttributedFacts += diagnostics.sourceNormalization.authorAttributedFacts;
    totals.ambiguousNarratorRejected += diagnostics.sourceNormalization.ambiguousNarratorRejected;
    totals.relativeTimeRefusals += diagnostics.qualityGate.relativeTimeRefusals;
    totals.colourRejections += diagnostics.sourceNormalization.sourceColourRejections;
    totals.refusedDigests += diagnostics.sourceNormalization.refusedDigests;
    for (const [reason, count] of Object.entries(diagnostics.sentences.reasons)) {
      refusedByReason[reason] = (refusedByReason[reason] ?? 0) + count;
    }
    for (const [shape, count] of Object.entries(diagnostics.attribution)) {
      attributionShapes[shape] = (attributionShapes[shape] ?? 0) + count;
    }
    for (const [kind, list] of Object.entries(diagnostics.sourceNormalization.samples)) {
      const sink = examples[kind] ?? (examples[kind] = []);
      for (const entry of list)
        if (sink.length < EXAMPLES_PER_KIND) sink.push(`${event.title} · ${entry}`);
    }

    // The removed rule's signature, and the one defect an aggregate over published
    // prose cannot see: a word written lowercase here that the source never writes
    // any other way. Counted per word, so the list can be read for names.
    const sourceText = event.sourceList
      .map((source) =>
        [source.excerpt ?? "", ...(source.enrichedEvidence ?? []).map((unit) => unit.text)].join(
          " ",
        ),
      )
      .join(" ");
    const rewrittenCases = [
      ...new Set(
        [article.deck.text, ...paras].flatMap((block) =>
          DEFECTS.lowercasedSourceCapitals(block, sourceText),
        ),
      ),
    ];
    totals.caseRewrites += rewrittenCases.length;
    for (const word of rewrittenCases) caseWords.set(word, (caseWords.get(word) ?? 0) + 1);

    // What this patch did to this story, and why it is on the list: every
    // counted rewrite, refusal or drop makes it a story worth reading by hand.
    const run = {
      strips: diagnostics.sourceNormalization.sourceVoiceStripped,
      frames: diagnostics.sourceNormalization.strippedFrames,
      cases: rewrittenCases.length,
      times: diagnostics.sourceNormalization.relativeTimesAnchored,
      colour: diagnostics.sourceNormalization.sourceColourRejections,
      refused: diagnostics.facts.refused,
      lost: diagnostics.facts.lost,
      timeRefused: diagnostics.qualityGate.relativeTimeRefusals,
    };
    const score = Object.values(run).reduce((sum, value) => sum + value, 0);
    if (score > 0) {
      changed.push({
        title: event.title,
        score,
        line: `${Object.entries(run)
          .filter(([, value]) => value > 0)
          .map(([key, value]) => `${key}=${value}`)
          .join(
            " ",
          )} · selected=${diagnostics.facts.selected} rendered=${diagnostics.facts.rendered} paragraphs=${paras.length} words=${text.split(/\s+/).filter(Boolean).length}`,
        deck: article.deck.text,
        paragraphs: paras,
        samples: Object.values(diagnostics.sourceNormalization.samples).flat(),
      });
    }

    const blocks = [article.deck.text, ...paras].filter((b) => b !== "");
    totals.entityLeaks += blocks.filter((b) => ENTITY_LEAK.test(b)).length;
    totals.metadataLeaks += blocks.filter((b) => hasSourceMetadata(b)).length;
    totals.gluedAttribution += blocks.filter((b) => GLUED_ATTRIBUTION.test(b)).length;
    totals.unresolvedContext += blocks.filter((b) => unresolvedContextOpening(b)).length;
    totals.doubleSpace += blocks.filter((b) => DOUBLE_SPACE.test(b)).length;
    totals.doubleQuotes += blocks.filter((b) => TWO_QUOTES.test(b)).length;
    totals.bareQuoteSentence += blocks.filter((b) => LEADING_QUOTE.test(b)).length;

    for (const paragraph of article.paragraphs) {
      if (paragraph.evidence.length > 0) totals.paragraphsWithRefs += 1;
      if (new Set(paragraph.evidence).size !== paragraph.evidence.length)
        totals.duplicateRefBlocks += 1;
    }

    const reasons = [
      ENTITY_LEAK.test(text) ? "entity" : "",
      GLUED_ATTRIBUTION.test(text) ? "attribution" : "",
      unresolvedContextOpening(text) ? "context" : "",
      DOUBLE_SPACE.test(text) ? "spacing" : "",
    ].filter(Boolean);
    if (reasons.length) offenders.push(`${reasons.join("+")}: ${event.title}`);
  }

  heading(`Corpus (${totals.stories} events with coverage)`);
  say(row("words, average", Math.round(totals.words / Math.max(1, totals.stories))));
  say(row("paragraphs, average", (totals.paragraphs / Math.max(1, totals.stories)).toFixed(2)));
  say(row("story with no paragraphs", totals.zeroParagraph));
  say(row("  deck only", totals.deckOnly));
  say(row("  nothing at all", totals.noDeckNoParagraph));
  say(row("facts selected", totals.selectedFacts));
  say(row("facts rendered", totals.renderedFacts));
  say(row("facts refused", totals.refusedFacts));
  say(row("facts lost", totals.lostFacts));
  say(row("facts rejected", totals.rejectedFacts));
  say(row("restatement merges", totals.restatements));
  say(row("sentences refused", totals.sentencesRefused));

  heading("Reader-visible defects (counted on the published prose)");
  say(row("entity leaks", totals.entityLeaks));
  say(row("metadata leaks", totals.metadataLeaks));
  say(row("malformed attribution", totals.gluedAttribution));
  // Named for what it counts: a block opening on a demonstrative whose antecedent
  // is in the previous block of the same story is not a defect, and thirteen of
  // them were read by hand to be sure of exactly that.
  say(row("context-dependent openings", totals.unresolvedContext));
  say(row("double spaces", totals.doubleSpace));
  say(row("two quotes in one block", totals.doubleQuotes));
  say(row("block opening with a quote", totals.bareQuoteSentence));
  say(row("duplicate citation in a block", totals.duplicateRefBlocks));
  say(row("paragraphs carrying a citation", totals.paragraphsWithRefs));

  heading("What the composer refused, by reason");
  for (const [reason, count] of Object.entries(refusedByReason).sort((a, b) => b[1] - a[1])) {
    say(row(REASON_LABEL[reason] ?? reason, count));
  }
  // The other half of that table: `facts lost` counts what no rule refused by
  // name -- a block-level refusal charges the sentence, not the fact behind it
  // -- so the number is only a bug report if these can be read. Nothing here is
  // "expected": each one is a fact the reader did not get.
  heading("Facts lost, with no rule refusing them by name");
  say(row("listed", lostFacts.length));
  for (const text of lostFacts) say(`  ${clip(text, 240)}`);
  heading("How the published blocks acquired their attribution");
  for (const [shape, count] of Object.entries(attributionShapes).sort((a, b) => b[1] - a[1])) {
    say(row(shape, count));
  }

  heading("Rewrites, with before/after examples to check by hand");
  // A source-level refusal rather than a rewrite, and the only place this audit
  // can answer whether the digest boundary fired on the corpus it measured.
  say(row("digest sources refused", totals.refusedDigests));
  say(row("editorial adverbials removed", totals.voiceStripped));
  say(row("fronted frames removed", totals.framesStripped));
  // Not a defect count on its own: a share statistic has to be readable after its
  // survey, so its quantifier is lowered by the rule that matched it. Read the
  // words below -- a name here would be the rule this removed for a reason.
  say(row("words lowered the source never lowers", totals.caseRewrites));
  for (const [word, count] of [...caseWords].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    say(row(`  ${word}`, count));
  }
  say(row("relative dates anchored", totals.relativeTimesAnchored));
  say(row("relative dates dropped", totals.relativeTimesStripped));
  // The narrator rows: what the source's own voice was turned into. "Attributed to
  // the source itself" is both classes -- an observation reported and a claim whose
  // actor was renamed to the source -- because both are the source's own words
  // about itself, which is the thing the reader has to be able to see.
  say(row("narrator wrappers resolved to the actor", totals.narratorWrappersRemoved));
  say(row("facts attributed to the source itself", totals.authorAttributedFacts));
  say(row("first-person facts dropped as ambiguous", totals.ambiguousNarratorRejected));
  say(row("relative dates refused", totals.relativeTimeRefusals));
  say(row("loaded metaphors refused", totals.colourRejections));
  for (const [kind, list] of Object.entries(examples)) {
    if (list.length === 0) continue;
    say("");
    say(`${kind}:`);
    for (const entry of list) say(`  ${entry}`);
  }

  if (offenders.length) {
    heading("Events with a reader-visible defect");
    for (const line of offenders.slice(0, 40)) say(`  ${line}`);
  }

  changed.sort((a, b) => b.score - a.score);
  if (changedLimit > 0) {
    heading(`The ${changedLimit} stories this patch did the most to, out of ${changed.length}`);
    for (const item of changed.slice(0, changedLimit)) {
      say("");
      say(`${item.score}  ${item.title}`);
      say(`    ${item.line}`);
      say(`    deck: ${clip(item.deck)}`);
      for (const sample of item.samples.slice(0, 5)) say(`    · ${clip(sample, 220)}`);
      if (full) {
        for (const [index, paragraph] of item.paragraphs.entries()) {
          say(`    ${index + 1}. ${paragraph}`);
        }
      }
    }
    if (!full) {
      heading(`The same list, printed in full (${Math.min(MORE, changed.length)} stories)`);
      for (const item of changed.slice(0, MORE)) {
        say("");
        say(`— ${item.title}`);
        say(`  deck: ${item.deck}`);
        for (const [index, paragraph] of item.paragraphs.entries())
          say(`  ${index + 1}. ${paragraph}`);
      }
    }
  }

  heading("The same defects, counted on the input the composer was handed");
  say(row("sentences read", census.sentences));
  say(row("  carried an entity", census.entities));
  say(row("  a heading unit", census.headingUnits));
  say(row("  glued attribution", census.gluedAttribution));
  say(row("  unresolvable subject", census.unresolvableContext));
  say(row("  source colour", census.sourceColour));
});
