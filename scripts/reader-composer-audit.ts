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
import { assessReadiness, marketingShape } from "@/lib/pipeline/readiness";
import { hasSourceMetadata, hasVisibleEntity } from "@/lib/pipeline/source-text";
import {
  headingUnit,
  rankEntities,
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

/**
 * A bare pronoun behind a leading connector: "However, they also rely on …".
 *
 * The shared ruler (`unresolvedContextOpening`) reads the first word, and the
 * composer's rules read the same one, so a connector in front of the pronoun
 * hides it from both. Found by reading the deployed Taiwan chip-supply story on
 * 2026-10-17: its fourth paragraph opens "However, they also rely on several
 * smaller manufacturers …" after the sentence that introduced those
 * manufacturers was refused. Measured here separately from the ruled class, so
 * the gap is sized and visible rather than silently folded into a zero.
 */
const CONNECTOR_PRONOUN_OPENING =
  /^(?:However|But|And|Still|Yet|So|Instead|Meanwhile|Also|Now|Then|Today|Yesterday|This week|That said|Even so|As a result|In addition)[,;]?\s+(?:they|them|their|it|its|this|these|those|he|she|him|her|both)\b/i;

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
  /**
   * A block opening on a bare pronoun behind a connector — "However, they also
   * rely on …". Once the gap this counter measured: the shared ruler read
   * position zero, so a connector in front of the pronoun hid it from the ruler
   * *and* from the gate. The class is covered now, and the counter stays as the
   * check that it is — a published one here is a regression.
   */
  connectorPronoun: number;
  /**
   * Sentences the ranked path published by restoring their source adjacency.
   *
   * The arbiter's ruling #4 (2026-10-17) makes the ranked path honour the same
   * contract the single-source path always had: a fact that opens on a reference
   * is published directly behind the sentence the author wrote before it, when
   * that sentence is selected and supplies the reference. Counted on the
   * composer's own record, and every one printed with both sentences.
   */
  adjacencyRepairs: number;
  /** Body openings judged against the page (arbiter ruling #7, Q2). */
  pageOpenings: { asked: number; kept: number; refused: number };
  doubleSpace: number;
  doubleQuotes: number;
  bareQuoteSentence: number;
  truncatedLeads: number;
  rawUrls: number;
  rawUrlDefects: number;
  selectedFacts: number;
  renderedFacts: number;
  lostFacts: number;
  rejectedFacts: number;
  /** Unrendered facts a named rule accounts for -- the partition's middle term. */
  refusedFacts: number;
  /** Fact-level refusal events, which is execution history rather than outcome. */
  refusalEvents: number;
  /** Facts a rule refused along one path that another path published anyway. */
  renderedAfterRefusal: number;
  /** Facts a rule charged that the page only resembles -- the generous half. */
  renderedAfterRefusalResemblance: number;
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
    connectorPronoun: 0,
    adjacencyRepairs: 0,
    pageOpenings: { asked: 0, kept: 0, refused: 0 },
    doubleSpace: 0,
    doubleQuotes: 0,
    bareQuoteSentence: 0,
    truncatedLeads: 0,
    rawUrls: 0,
    rawUrlDefects: 0,
    selectedFacts: 0,
    renderedFacts: 0,
    lostFacts: 0,
    rejectedFacts: 0,
    refusedFacts: 0,
    refusalEvents: 0,
    renderedAfterRefusal: 0,
    renderedAfterRefusalResemblance: 0,
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

  /**
   * Whether this corpus carries the coverage kinds the marketing rungs decide by.
   *
   * The live window does; a file frozen before the field existed does not, and
   * `--fixtures` never does. That distinction has to be stated, because the
   * marketing rung is gated on a first-party source: without kinds it is skipped,
   * so a frozen run reports a number that moved for a reason the corpus cannot
   * show. The decision's evidence is the labelled live-window run below it.
   */
  const kindsCarried = events.some((event) => event.sourceKinds.length > 0);

  const totals = emptyTotals();
  const census = emptyCensus();
  const offenders: string[] = [];
  const refusedByReason: Record<string, number> = {};
  /** Units the evidence pass refused before they were ever facts, by reason. */
  const evidenceRefusals: Record<string, number> = {};
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
  /**
   * Every story that published no paragraphs, with the path that emptied it.
   *
   * An empty story is the strongest version of "the rules decided against this":
   * the reader gets a headline, maybe a deck, and nothing else. Whether that is
   * justified or avoidable cannot be read off a total, so each one is printed with
   * its evidence volume, its selected/unrendered split, the rule that charged its
   * facts, the gate's own reason map and what the evidence pass refused -- the
   * whole path from selection to silence, which is what a reviewer needs to say
   * "correctly silent" or "lost on the way".
   *
   * The coverage itself is printed with it (D6, the arbiter's 2026-10-11 ruling:
   * every one of the 59 accounted for individually). The counts said
   * `sourceWords=2` and left the reader to trust that the excerpt really was two
   * words; a classification of the silence that cannot see the material it
   * silenced is an opinion about a number. Each source line carries its
   * `kind` and its own timestamp, and the event's clock is printed above them,
   * because the composer anchors a source's relative time to the event's date and
   * a reviewer judging "too thin to publish" needs the same clock the rules read.
   */
  const empties: string[] = [];
  /**
   * One line per silent story, which is the form D6's accounting takes.
   *
   * The arbiter's ruling (2026-10-11) asks for every one of the 59 accounted for
   * *individually*, with its evidence and its decision-time context. The verbose
   * records above are the evidence; this is the ledger a reader can hold in one
   * view and disagree with, and it is emitted by the same pass that produced the
   * census so the two cannot drift. Nothing here is a rule: it is the five facts
   * the classification turns on -- how much coverage there was, whether any
   * evidence had been extracted (`units`), how many facts were selected, whether
   * a deck was published, and which rule charged what it did.
   */
  const silenceLedger: string[] = [];
  /** Empty stories by cause, so "avoidable" is a number and not a word. */
  const emptyKinds: Record<string, number> = {};
  /** Empty stories the selection gate withheld, by the gate's own kind. */
  const emptyByGate: Record<string, number> = {};
  /**
   * Stories the composer would give a body, refused at selection anyway.
   *
   * The gate's whole job is to withhold what the reader cannot use, so this
   * number is not automatically a defect -- a vendor advert and a build tag both
   * belong here. It is on the report because every one of them is a candidate
   * for a reviewer to call right or wrong, and because a *large* one means the
   * gate has drifted away from the composer it is standing in front of.
   */
  const readableWithheld: string[] = [];
  /**
   * Stories the gate let through with no body: the defect number.
   *
   * It has to be zero. A card whose headline is real and whose article is empty
   * is the failure this whole path exists to prevent, and it is the one number
   * on this report that is a verdict rather than a measurement.
   */
  const deliveredEmpty: string[] = [];
  /**
   * Every story whose title wears a marketing shape, with its source kinds.
   *
   * The arbiter's D5 acceptance asks for this by name: the change trades a silent
   * loss for a possible wrong read, so the report has to show both sides of it --
   * the shapes refused and the shapes released -- split by the kinds that decided
   * them. `marketingShape` is the gate's own predicate, not a copy of it, and it
   * answers about the title alone, which is what makes a released shape visible.
   */
  const vendorShapes: {
    title: string;
    kinds: string;
    shape: string;
    verdict: string;
    paragraphs: number;
  }[] = [];
  /**
   * Every readable story the gate withheld, with the rule's own reason and the
   * body it would have delivered.
   *
   * Split by family because the count is not one quantity: a build number and a
   * real news headline refused by a marketing shape are both "readable stories
   * withheld", and only one of them is a loss. The reason string is the gate's
   * own, so the audit cannot disagree with the rule about which shape fired.
   */
  const withheldDetail: {
    title: string;
    kind: string;
    reason: string;
    family: DEFECTS.WithheldFamily;
    sources: string;
    sourceCount: number;
    paragraphs: number;
    words: number;
  }[] = [];
  /**
   * Stored evidence units that look like a fused sentence, and how many of them
   * the reader actually received.
   *
   * The candidate ruler (see `defects.ts`) cannot say a unit is wrong; the
   * confirmed count comes from re-extracting the source pages, which is what
   * `scripts/reader-fusion-sample.ts` does. What this section adds is the part
   * no re-extraction can know: whether the fused words reached a deck or a
   * paragraph, which is the difference between a storage curiosity and a defect
   * someone read.
   */
  const fusionUnits: string[] = [];
  const fusionStories = new Set<string>();
  const fusionVisible: string[] = [];
  /** The facts a rule charged that the reader received anyway, with the rule. */
  const overlapFacts: string[] = [];
  /**
   * The published blocks the context-dependent-opening ruler counted, in full.
   *
   * The row below is a count, and a count cannot answer the question the arbiter's
   * D2 closure ruling asked of it: which openings are genuinely unresolved, and which
   * are the ruler still disagreeing with the rule. A deck that opens `This paper
   * investigates ...` resolves itself by the act of reading, so it must not appear
   * here; the PC-shipments sentence, whose referent the page never establishes, must.
   */
  const contextOpenings: string[] = [];
  /** Blocks the connector form hides from the ruler, printed unclipped in kind. */
  const connectorOpenings: string[] = [];
  /**
   * The page's opening reference: repaired before the title moved, or preserved as it was.
   *
   * The arbiter's 2026-10-17 ruling (option 4) asks the audit to carry the story,
   * the offending reference, the repair actually applied and the outcome -- because
   * "nothing was deleted" is a measurement, not a passing test.
   */
  const openingRepairs: string[] = [];
  const openingUnresolved: string[] = [];
  /** One row per source-adjacency repair: both sentences and the outcome. */
  const adjacencyRepairRows: string[] = [];
  /** One row per body opening the page rule judged, with the page's answer. */
  const pageOpeningRows: string[] = [];
  /**
   * Every block that opens on a quotation, with the evidence that decides whether
   * it is a defect -- see `quoteOpeningEvidence`, which is where the definition
   * lives. The row below this list used to be a count, and the arbiter's ruling of
   * 2026-10-11 (option (a)) is why it is not one any more: a ruler's number is not
   * a defect count, and which of these blocks a reader cannot resolve is a
   * judgement the report has to carry the inputs for.
   */
  const quoteOpenings: (DEFECTS.QuoteOpeningEvidence & {
    title: string;
    position: string;
    opening: string;
    twoQuotes: boolean;
  })[] = [];
  /** The blocks carrying two quoted passages, so the second row is readable too. */
  const twoQuoteBlocks: (DEFECTS.StackedQuoteEvidence & {
    title: string;
    position: string;
    block: string;
  })[] = [];
  /** Published blocks whose opening sentence is cut at a clipping boundary. */
  const truncatedLeadBlocks: string[] = [];
  /** Published blocks that carry a raw URL as prose. */
  const rawUrlBlocks: string[] = [];
  /** Published blocks that carry the narrower URL-with-path defect. */
  const rawUrlDefectBlocks: string[] = [];
  /** Which rule accounts for the unrendered facts, across the corpus. */
  const dispositions: Record<string, number> = {};
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
    totals.refusalEvents += diagnostics.facts.refusalEvents;
    totals.renderedAfterRefusal += diagnostics.facts.renderedAfterRefusal;
    totals.renderedAfterRefusalResemblance += diagnostics.facts.renderedAfterRefusalResemblance;
    for (const [rule, count] of Object.entries(diagnostics.facts.dispositions ?? {})) {
      dispositions[rule] = (dispositions[rule] ?? 0) + count;
    }
    for (const entry of diagnostics.facts.renderedAfterRefusalFacts ?? []) {
      overlapFacts.push(`${event.title} · ${entry.rule} (${entry.matched}): ${entry.text}`);
      // The sentence the finding rests on, printed beneath it, so the reading can
      // be checked without re-running the composer.
      if (entry.evidence) overlapFacts.push(`    carried by: ${entry.evidence}`);
    }
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
    for (const [reason, count] of Object.entries(diagnostics.facts.evidenceRefusals ?? {})) {
      evidenceRefusals[reason] = (evidenceRefusals[reason] ?? 0) + count;
    }
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

    if (paras.length === 0) {
      const wordCount = (value: string) => value.split(/\s+/).filter(Boolean).length;
      const sourceWords = event.sourceList.reduce(
        (total, source) => total + wordCount(source.excerpt ?? ""),
        0,
      );
      const charged =
        Object.entries(diagnostics.facts.dispositions)
          .map(([rule, count]) => `${rule}=${count}`)
          .join(" ") || "no rule charged a fact";
      // Which kind of empty it is, decided from the accounting rather than from
      // the headline: `nothing-selected` means the evidence pass found no fact to
      // build from, `single-fact-is-the-deck` means the one usable fact became the
      // deck and a body needs a second one, and `emptied-after-selection` -- the
      // only genuinely suspicious class -- means two or more facts were selected
      // and the reader still got no paragraph.
      // `emptied-after-selection` split in two, because the name was doing more
      // work than the measurement. Two or more facts selected and no paragraph is
      // not automatically a defect: the composition rules can legitimately refuse
      // the remaining sentence, and the ledger charges it to the rule by name.
      // The class that must stay zero is the one with a fact the rules cannot
      // account for -- the 2026-10-10 live window had two stories in the loose
      // class and none in this one (one `unresolved_context`, one two
      // `stacked_quotes`), which is why the report distinguishes them.
      const kind =
        diagnostics.facts.selected === 0
          ? "nothing-selected"
          : diagnostics.facts.selected === 1
            ? "single-fact-is-the-deck"
            : diagnostics.facts.lost > 0
              ? "emptied-after-selection (unexplained)"
              : "emptied-after-selection (charged to a rule)";
      emptyKinds[kind] = (emptyKinds[kind] ?? 0) + 1;
      const unitsExtracted = event.sourceList.reduce(
        (total, source) => total + (source.enrichedEvidence?.length ?? 0),
        0,
      );
      const namesAReason =
        Object.entries(diagnostics.facts.evidenceRefusals ?? {})
          .filter(([, count]) => count > 0)
          .map(([reason, count]) => `${reason}=${count}`)
          .join(",") || "-";
      silenceLedger.push(
        `${kind} | selected=${diagnostics.facts.selected} deck=${article.deck.text ? `${wordCount(article.deck.text)}w` : "none"} units=${unitsExtracted} enrichment=${[...new Set(event.coverage.map((entry) => entry.enrichment))].join("+") || "?"} coverage=${event.sourceList.length} sourceWords=${sourceWords} clock=${event.publishedAt || "-"} charged=${charged} refused=${namesAReason} | ${event.title}`,
      );
      empties.push(
        [
          `· ${event.title}  [${kind}]`,
          `    sources=${event.sourceList.length} sourceWords=${sourceWords} selected=${diagnostics.facts.selected}`,
          `    deck=${article.deck.text ? `${wordCount(article.deck.text)}w` : "none"} unrendered=${diagnostics.facts.refused} unexplained=${diagnostics.facts.lost} words=${wordCount(text)}`,
          `    facts by rule: ${charged}`,
          `    paragraphs: ${JSON.stringify(diagnostics.paragraphs.reasons)} sentences: ${JSON.stringify(diagnostics.sentences.reasons)}`,
          `    evidence refused before selection: ${JSON.stringify(diagnostics.facts.evidenceRefusals)}`,
          `    clock: event=${event.publishedAt || "-"} kinds=${event.sourceKinds.join(",") || "-"} units=${unitsExtracted}`,
          `    charged by: ${namesAReason}`,
          // `units` is the decision-time fact the silence class turns on: a
          // story with no fact selected and no rule charged anything is either a
          // story whose evidence was never extracted (`units=0`) or one whose
          // extracted units the pass did not turn into facts. The two are
          // different findings and the counts alone cannot separate them.
          ...(event.coverage.length > 0
            ? event.coverage.map(
                (source, index) =>
                  `    coverage[${index}]${source.kind ? ` ${source.kind}` : ""} enrichment=${source.enrichment} @${source.publishedAt || "-"} units=${event.sourceList[index]?.enrichedEvidence?.length ?? 0}: ${clip(source.headline, 120)}${source.excerpt ? ` -- ${clip(source.excerpt, 200)}` : " -- (no excerpt)"}`,
              )
            : event.sourceList.map(
                (source, index) =>
                  `    coverage[${index}] (no kinds in this corpus) enrichment=? @- units=${source.enrichedEvidence?.length ?? 0}: ${clip(source.headline ?? "", 120)}${source.excerpt ? ` -- ${clip(source.excerpt, 200)}` : " -- (no excerpt)"}`,
              )),
        ].join("\n"),
      );
    }

    // Stored evidence: the fusion signature, and whether the reader saw it.
    for (const source of event.sourceList) {
      for (const unit of source.enrichedEvidence ?? []) {
        if (!DEFECTS.CANDIDATE_FUSION.test(unit.text)) continue;
        fusionUnits.push(`${event.title} · ${unit.text}`);
        fusionStories.add(event.id);
        // The published prose is where a reader would meet it: a 60-character
        // opening is enough to tie a unit to a deck or a paragraph without
        // pretending two similar sentences are the same one.
        const opening = unit.text.slice(0, 60);
        if (text.includes(opening)) {
          fusionVisible.push(`${event.title} · ${opening}…`);
        }
      }
    }

    // The gate the digest actually runs, over the same story the composer saw.
    // Two questions, one pass: does a story with a body get withheld anyway
    // (over-withholding, invisible to the reader), and does a story without one
    // get through (the defect). `sources` is the story's own coverage, exactly
    // as `loadBriefs` hands it over, so an absent-evidence refusal cannot be
    // confused with an evidence-based one.
    const verdict = assessReadiness({
      title: event.title,
      whatHappened: event.what,
      sourceCount: event.sources,
      sources: event.sourceList,
      // The coverage's kinds, which decide the marketing shapes since the
      // arbiter's ruling of 2026-10-11 (D5): a vendor shape refuses only when the
      // publisher was speaking for itself. A corpus frozen before the field
      // existed carries none, so the rung is skipped -- unknown is not the
      // vendor's own voice -- and this report says so rather than letting a
      // number move for a reason the corpus cannot show.
      sourceKinds: event.sourceKinds,
      // The event's clock, because the gate composes: without it a source's
      // relative time cannot be anchored and a fact the reader's page publishes
      // is refused here instead. Composing the same article both ways is what
      // makes this cross-tab a comparison rather than two opinions.
      publishedAt: event.publishedAt,
    });
    const gateKind = verdict.ready ? "ready" : verdict.kind;
    const shape = marketingShape(event.title);
    if (shape !== null) {
      vendorShapes.push({
        title: event.title,
        kinds: event.sourceKinds.length > 0 ? event.sourceKinds.join("+") : "unknown",
        shape,
        verdict: verdict.ready ? "released" : gateKind,
        paragraphs: paras.length,
      });
    }
    if (paras.length === 0) {
      emptyByGate[gateKind] = (emptyByGate[gateKind] ?? 0) + 1;
      if (verdict.ready) deliveredEmpty.push(event.title);
    } else if (!verdict.ready) {
      readableWithheld.push(`[${gateKind}] ${event.title} — ${verdict.reason}`);
      // The reader cost, not just the refusal: what the story would have
      // delivered had the gate let it through. The gate composed it already, so
      // this is the same article the delivery path would have published.
      withheldDetail.push({
        title: event.title,
        kind: gateKind,
        reason: verdict.reason,
        family: DEFECTS.withheldFamily(verdict.reason),
        sources: event.sourceList.map((source) => source.name ?? "(unnamed)").join(" + "),
        sourceCount: event.sourceList.length,
        paragraphs: paras.length,
        words: text.split(/\s+/).filter(Boolean).length,
      });
    }

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
    for (const block of blocks) {
      if (!unresolvedContextOpening(block)) continue;
      totals.unresolvedContext += 1;
      contextOpenings.push(`${event.title} · ${block}`);
    }
    for (const block of blocks) {
      if (!CONNECTOR_PRONOUN_OPENING.test(block.trim())) continue;
      totals.connectorPronoun += 1;
      connectorOpenings.push(`${event.title} · ${block}`);
    }
    // The page rule of 2026-10-17 (arbiter ruling #7, Q2): every body block whose
    // opening asked the page for a reference, and what the page answered. Kept
    // separate from the document-identity repair above because the question is
    // different -- that one repairs an opening, this one decides whether the
    // sentence may open at all.
    totals.pageOpenings.asked += diagnostics.qualityGate.pageOpenings.asked;
    totals.pageOpenings.kept += diagnostics.qualityGate.pageOpenings.kept;
    totals.pageOpenings.refused += diagnostics.qualityGate.pageOpenings.refused;
    for (const sample of diagnostics.qualityGate.pageOpenings.samples)
      pageOpeningRows.push(`${event.title} · ${sample}`);
    for (const sample of diagnostics.qualityGate.openingReferences.samples)
      openingRepairs.push(`${event.title} · ${sample}`);
    for (const text of diagnostics.qualityGate.openingReferences.unresolved)
      openingUnresolved.push(`${event.title} · ${text}`);
    // Every adjacency repair by name, with the sentence it now sits behind and
    // whether the prose actually carries it -- a repair the gate then refused is
    // not a repair, and the count must not claim it is.
    for (const sample of diagnostics.qualityGate.adjacencyRepairs.samples) {
      totals.adjacencyRepairs += 1;
      const carried = blocks.some((block) => block.includes(sample.dependent));
      adjacencyRepairRows.push(
        `${event.title}\n    dependent [${sample.dependentOrder}] ${sample.dependent}\n    predecessor [${sample.predecessorOrder}] ${sample.predecessor}\n    ${carried ? "published" : "refused after the repair"}`,
      );
    }
    totals.doubleSpace += blocks.filter((b) => DOUBLE_SPACE.test(b)).length;
    // The story's own named entities, longest first, are what make an attribution
    // readable rather than guessed: a name-shaped ruler cannot tell `The report
    // said` from `Jane Smith said`, and this one does not have to.
    const entityNames = rankEntities(event.title, event.sourceList)
      .map((entity) => entity.name)
      .sort((a, b) => b.length - a.length);
    for (const [index, block] of blocks.entries()) {
      const truncated = DEFECTS.truncatedLead(block);
      if (truncated !== "") {
        totals.truncatedLeads += 1;
        truncatedLeadBlocks.push(`${event.title} · ${truncated}`);
      }
      if (DEFECTS.RAW_URL.test(block)) {
        totals.rawUrls += 1;
        rawUrlBlocks.push(`${event.title} · ${block}`);
      }
      if (DEFECTS.RAW_URL_WITH_PATH.test(block)) {
        totals.rawUrlDefects += 1;
        rawUrlDefectBlocks.push(`${event.title} · ${block}`);
      }
      if (TWO_QUOTES.test(block)) {
        totals.doubleQuotes += 1;
        twoQuoteBlocks.push({
          ...DEFECTS.stackedQuoteEvidence({
            page: blocks,
            index,
            names: entityNames,
            unrendered: diagnostics.facts.unrendered,
          }),
          title: event.title,
          position: index === 0 ? "deck" : `paragraph ${index}`,
          block,
        });
      }
      if (!DEFECTS.OPENS_ON_QUOTE.test(block)) continue;
      totals.bareQuoteSentence += 1;
      quoteOpenings.push({
        ...DEFECTS.quoteOpeningEvidence({
          page: blocks,
          index,
          names: entityNames,
          unrendered: diagnostics.facts.unrendered,
        }),
        title: event.title,
        position: index === 0 ? "deck" : `paragraph ${index}`,
        opening: block,
        twoQuotes: TWO_QUOTES.test(block),
      });
    }

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
  for (const entry of contextOpenings) say(`  ${clip(entry, 240)}`);
  // Measured, not ruled: the shared predicate reads position zero, so a block
  // that opens "However, they also …" is invisible to it. Counted separately so
  // the instrument stops under-reporting, and printed with its examples so the
  // next decision is made on pages rather than on a number.
  say(row("  of those, a pronoun behind a connector", totals.connectorPronoun));
  for (const entry of connectorOpenings) say(`    ${clip(entry, 240)}`);
  // The body-boundary half of the same contract, ruled 2026-10-17 (#7, Q2): a
  // block whose opening asks the page for a reference may only open on it when
  // the deck and the paragraphs above carry it. Asked/kept/refused, with the
  // openings themselves, so the number can be read against the prose.
  say(row("body openings judged against the page", totals.pageOpenings.asked));
  say(row("  kept, the page establishes them", totals.pageOpenings.kept));
  say(row("  refused, it does not", totals.pageOpenings.refused));
  for (const entry of pageOpeningRows) say(`  ${clip(entry, 400)}`);
  // The ranked path's own repair, kept apart from the document-identity one on
  // purpose: the arbiter asked for this outcome to be identifiable as a
  // source-adjacency repair, not folded into the other class's number.
  say(row("source-adjacency repairs (ranked body path)", totals.adjacencyRepairs));
  for (const entry of adjacencyRepairRows) say(`  ${clip(entry, 700)}`);
  // The opening reference, as the composer itself judged it: moved in front when the
  // block named the document, preserved and recorded when nothing did.
  say(row("opening references repaired (title moved in front)", openingRepairs.length));
  for (const entry of openingRepairs) say(`  ${clip(entry, 400)}`);
  say(
    row("opening references preserved and recorded (nothing names them)", openingUnresolved.length),
  );
  for (const entry of openingUnresolved) say(`  ${clip(entry, 260)}`);
  say(row("double spaces", totals.doubleSpace));
  say(row("truncated lead", totals.truncatedLeads));
  for (const entry of truncatedLeadBlocks) say(`  ${clip(entry, 240)}`);
  say(row("raw URL in published prose", totals.rawUrls));
  for (const entry of rawUrlBlocks) say(`  ${clip(entry, 240)}`);
  say(row("  of those, URL with path or scheme (defect class)", totals.rawUrlDefects));
  for (const entry of rawUrlDefectBlocks) say(`    ${clip(entry, 240)}`);
  say(row("two quotes in one block", totals.doubleQuotes));
  for (const entry of twoQuoteBlocks) {
    say(`  [${entry.class}] ${entry.position} · ${entry.title}`);
    say(`      ${clip(entry.block, 220)}`);
    say(
      `      speaker=${entry.attribution === "" ? "not named" : entry.attribution} (${entry.where})` +
        (entry.refusedRule === "" ? "" : ` charged as ${entry.refusedRule}`),
    );
    if (entry.attributionSentence !== "") say(`      in: ${clip(entry.attributionSentence, 200)}`);
    if (entry.duplicateOf !== "") say(`      repeats above: ${clip(entry.duplicateOf, 160)}`);
  }
  // The two quote rows are diagnostics, and the arbiter's ruling of 2026-10-11
  // (option (a)) is why they are printed with their classification rather than as
  // a work queue: a block opening on quoted speech is not a defect, a block the
  // reader cannot resolve is, and the difference is evidence this report has to
  // carry. `confirmed` is the class that may be fixed; `unresolved` is not a
  // defect yet -- it is the list to read before anyone decides it is one.
  const quoteDefects = quoteOpenings.filter(
    (entry) => entry.class === "duplicate" || entry.class === "attribution-refused",
  );
  say(row("block opening with a quote", totals.bareQuoteSentence));
  say(row("  confirmed defects", quoteDefects.length));
  say(
    row(
      "    same sentence already published above it",
      quoteDefects.filter((entry) => entry.class === "duplicate").length,
    ),
  );
  say(
    row(
      "    the page names the speaker only in a charged fact",
      quoteDefects.filter((entry) => entry.class === "attribution-refused").length,
    ),
  );
  say(
    row(
      "  valid quote leads (the page names the speaker)",
      quoteOpenings.filter((entry) => entry.class === "valid").length,
    ),
  );
  say(
    row(
      "  unresolved: no speaker named anywhere, nothing charged",
      quoteOpenings.filter((entry) => entry.class === "unresolved").length,
    ),
  );
  say(
    row(
      "  stories carrying a quote opening",
      new Set(quoteOpenings.map((entry) => entry.title)).size,
    ),
  );
  say(
    row(
      "  of those blocks, a second quotation in the same block",
      quoteOpenings.filter((entry) => entry.twoQuotes).length,
    ),
  );
  for (const entry of quoteOpenings) {
    say(`  [${entry.class}] ${entry.position} · ${entry.title}`);
    say(`      ${clip(entry.opening, 220)}`);
    say(
      `      speaker=${entry.attribution === "" ? "not named" : entry.attribution} (${entry.where})` +
        (entry.refusedRule === "" ? "" : ` charged as ${entry.refusedRule}`),
    );
    // Where the name was found, because the name alone is not the evidence: the
    // ruler reports *an* entity in an attribution seam, and the sentence is what
    // shows whether that entity is the person speaking.
    if (entry.attributionSentence !== "") say(`      in: ${clip(entry.attributionSentence, 200)}`);
    if (entry.duplicateOf !== "") say(`      repeats above: ${clip(entry.duplicateOf, 160)}`);
  }
  say(row("duplicate citation in a block", totals.duplicateRefBlocks));
  say(row("paragraphs carrying a citation", totals.paragraphsWithRefs));
  // The classes this queue competes with, in the same run and beside it. The
  // arbiter's ruling asked for the trade-off rather than the queue: the size of a
  // diagnostic counter is not the size of the reader-facing cost, and the two
  // numbers have to be read together before anyone spends a slice.
  heading("The same run's competing classes, for the priority decision");
  say(row("quote-opening blocks (the queue)", quoteOpenings.length));
  say(row("  confirmed defects in it", quoteDefects.length));
  say(row("readable stories withheld (a body refused)", readableWithheld.length));
  say(row("stories publishing nothing", empties.length));
  for (const [kind, count] of Object.entries(emptyKinds).sort()) say(row(`  ${kind}`, count));
  say(row("delivered with no body  <- must be zero", deliveredEmpty.length));
  say(row("refused then published  <- must be zero", totals.renderedAfterRefusal));

  heading("What the composer refused, by reason");
  for (const [reason, count] of Object.entries(refusedByReason).sort((a, b) => b[1] - a[1])) {
    say(row(REASON_LABEL[reason] ?? reason, count));
  }
  // The other table half: units the evidence pass refused before they were
  // ever facts. Without it, `newsletter_index` and `imperative_instruction`
  // and every sibling reason are silent -- the gate cannot name a sentence
  // that never reached it.
  if (Object.values(evidenceRefusals).some((count) => count > 0)) {
    heading("Refused in the evidence pass, before selection");
    for (const [reason, count] of Object.entries(evidenceRefusals)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])) {
      say(row(REASON_LABEL[reason] ?? reason, count));
    }
  }
  // Every selected fact leaves the composer in exactly one of three states, and
  // this is the line that has to add up: rendered prose, an absence a named rule
  // accounts for, or the residue nobody can explain. The refusal-event count sits
  // beside it deliberately -- it is the rules' execution history, and the two are
  // different numbers whenever a refused fact was published by another path.
  heading("Fact ledger: where every selected fact went");
  say(
    row(
      "selected = rendered + explained + unexplained",
      `${totals.selectedFacts} = ${totals.renderedFacts} + ${totals.refusedFacts} + ${totals.lostFacts}`,
    ),
  );
  say(
    row(
      "  reconciles",
      totals.renderedFacts + totals.refusedFacts + totals.lostFacts === totals.selectedFacts
        ? "yes"
        : "NO — the accounting is broken",
    ),
  );
  say(row("unrendered, by the rule that accounts for it", totals.refusedFacts));
  for (const [rule, count] of Object.entries(dispositions).sort((a, b) => b[1] - a[1])) {
    say(row(`  ${rule}`, count));
  }
  say(row("refusal events (rules' history, not the partition)", totals.refusalEvents));
  say(row("refused then published by another path  <- must be zero", totals.renderedAfterRefusal));
  // Not a defect: the wording comparison matched a sentence about something else.
  // Its own row so the verdict above is not weakened by it.
  say(
    row(
      "  of those, resemblance only (the counter being generous)",
      totals.renderedAfterRefusalResemblance,
    ),
  );
  // The facts behind the two numbers above, so a reader can check a decision
  // rather than take a count's word for it. Both are bounded by what the corpus
  // selected, and both are printed in full.
  if (overlapFacts.length > 0) {
    heading("Refused, then published anyway (each one a path that bypassed a rule)");
    for (const entry of overlapFacts) say(`  ${clip(entry, 240)}`);
  }
  // An unexplained fact is a bug report, not a tolerance: nothing here is
  // "expected", because a rule that accounts for the absence has to be named.
  heading("Facts lost, with no rule accounting for them");
  say(row("listed", lostFacts.length));
  for (const text of lostFacts) say(`  ${clip(text, 240)}`);
  heading("Stories that published no paragraphs, and the path that emptied them");
  say(row("stories", empties.length));
  for (const [kind, count] of Object.entries(emptyKinds)) say(row(`  ${kind}`, count));
  // Keyed on the class the census actually produces. The old key
  // (`emptied-after-selection`) stopped existing when the class was split in two,
  // so this row read zero from an absent key -- a number that agreed with the
  // verdict for the wrong reason.
  say(
    row(
      "  emptied after selection (the avoidable class)",
      emptyKinds["emptied-after-selection (unexplained)"] ?? 0,
    ),
  );
  for (const entry of empties) say(entry);

  heading("D6 ledger: one line per silent story, with its decision-time context");
  say(row("stories", silenceLedger.length));
  for (const entry of silenceLedger) say(`  ${entry}`);

  heading("Stored evidence carrying a candidate fusion (2026-10-10 standfirst defect)");
  say(row("stored units matching the candidate signature", fusionUnits.length));
  say(row("stories affected", fusionStories.size));
  say(row("of those units, in a deck or paragraph", fusionVisible.length));
  say(
    row("  confirmed by re-extraction  <- not a text pattern;", "scripts/reader-fusion-sample.ts"),
  );
  say(row("    run it:  npm run audit:fusion", ""));
  // Named and labelled, because the ruler cannot tell a fusion from a place
  // name: "travelled from nearby Haryana state" matches it, and it fires on 374
  // of the corpus's 1369 stored units. The list is material to read by hand, and
  // the only counts above that mean anything are the confirmed ones.
  say("  reader-visible candidates to read by hand (the ruler counts place names too):");
  for (const entry of fusionVisible.slice(0, 8)) say(`  · ${entry}`);

  heading("Selection gate: what the reader would actually receive");
  say(row("stories that published no paragraph", empties.length));
  for (const [kind, count] of Object.entries(emptyByGate).sort())
    say(row(`  withheld as ${kind}`, count));
  say(row("delivered with no body  <- must be zero", deliveredEmpty.length));
  for (const title of deliveredEmpty) say(`  · ${title}`);
  say(row("readable stories withheld", readableWithheld.length));
  // The invisible-miss class, and the only part of that number that was ever a
  // defect: 26 stories on the 2026-10-10 corpus had a body and no summary, and
  // only the summary rung refused them. Rung 1 now runs where the caller could
  // not load coverage, so this has to stay zero on a corpus that supplies it.
  say(
    row(
      "  of those, by the summary rung  <- must be zero",
      readableWithheld.filter((entry) => entry.startsWith("[empty]")).length,
    ),
  );
  // The families first, then every story with the rule's own reason and the body
  // it would have delivered. `first-party-shape` is the only family the gate is
  // *guessing* about -- the shape is decided from the title alone -- so it is the
  // one a reviewer has to read, and printing the source beside it is what says
  // whether the source was the vendor or a newsroom reporting the same words.
  for (const family of ["not-a-headline", "promotion", "first-party-shape", "evidence"] as const) {
    const list = withheldDetail.filter((entry) => entry.family === family);
    if (list.length === 0) continue;
    say(row(`  ${family}`, list.length));
  }
  for (const entry of withheldDetail) {
    say(`  · [${entry.family}] ${entry.kind} · ${entry.title}`);
    say(`      ${entry.reason}`);
    say(
      `      would have delivered: ${entry.paragraphs} paragraph(s), ${entry.words} words · sources: ${entry.sources} (${entry.sourceCount})`,
    );
  }

  // The trade the D5 ruling made, shown from both sides. A shape that is refused
  // is the rule working; a shape that is released is the rule standing down
  // because the publisher was not the story's subject. The kinds column is what
  // decides, so it is printed -- and "unknown" is the honest answer for a corpus
  // frozen before the field existed, which is why the line above the list says so.
  heading("Vendor shapes: which titles wore one, and what decided them");
  say(
    row(
      "coverage kinds carried by this corpus",
      kindsCarried ? "yes" : "no - the marketing rung is skipped",
    ),
  );
  say(row("stories whose title wears a marketing shape", vendorShapes.length));
  say(row("  refused as marketing", vendorShapes.filter((e) => e.verdict === "marketing").length));
  say(row("  released", vendorShapes.filter((e) => e.verdict === "released").length));
  for (const entry of vendorShapes) {
    say(`  · [${entry.verdict}] ${entry.shape}`);
    say(`      ${entry.title}`);
    say(`      kinds: ${entry.kinds} · composed: ${entry.paragraphs} paragraph(s)`);
  }

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
