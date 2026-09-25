/**
 * What the heading rule refuses, and what its refusal costs, over the frozen
 * 200-event corpus.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/reader-headline-census.ts \
 *     [--corpus /tmp/corpus.json]
 *
 * The rule it measures is `headingUnit`: a unit that opens on a wh-word, asks
 * nothing, carries no clause boundary inside it and is not a cleft. That replaced
 * a word-list version (`WH_HEADLINE + no question mark`) which refused 19 units in
 * this corpus -- 16 of them ordinary sentences, none of them the source's own
 * headline -- and whose deletion published the production fixture's standfirst.
 *
 * The second refusal it measures is `sourceSeam`, a heading or a session credit
 * line a provider joined to the prose under it with no punctuation, which is a
 * shape `headingUnit` cannot see -- the unit has commas and a predicate, both
 * supplied by the glued half. Kept in its own section, because a unit both rules
 * refuse is no evidence for either.
 *
 * The universe it runs on is the units the evidence pass sees, so this mirrors
 * that pass -- enriched evidence first, then `readerSentences(excerpt)` -- and then
 * applies the three rewrites `selectReaderEvidence` performs before the check.
 *
 * Each refusal is classified against the source's own headline, and against what
 * the rest of the chain would do with it (`next=` is the first rule that would
 * fire if the heading rule let the unit through, `publish=` whether the composer's
 * gate would take it). The second list is the trade in the other direction: every
 * wh-opening unit the rule now *admits*, so a reader of this file can see what
 * came back and check it by hand rather than trusting a count.
 *
 * Writes /tmp/headline-census.json. Reads the database (SELECT only).
 */

import { writeFileSync } from "node:fs";
import {
  editorialNoise,
  hasPredicate,
  headingUnit,
  readerSentences,
  sourceSeam,
  unbalancedQuotes,
  unresolvableContext,
  validDeterministicParagraph,
  validDeterministicSentence,
} from "@/lib/reader-evidence";
import { CORPUS_SIZE, loadCorpusEvents, storyForEvent } from "./lib/corpus.ts";

/** The next refusal a unit would meet if the heading rule let it through. */
function nextRefusal(text: string): string {
  if (!validDeterministicSentence(text)) return "invalid_sentence";
  if (unresolvableContext(text)) return "unresolved_context";
  if (/…$|\.\.\.$/.test(text)) return "trailing_ellipsis";
  if (unbalancedQuotes(text)) return "unbalanced_quote";
  if (/^["“]/.test(text) && !/\b(?:said|says|told|according to)\b/.test(text))
    return "unassigned_quote";
  if (!hasPredicate(text)) return "no_predicate";
  return "admitted";
}

const wouldPublish = (text: string) =>
  nextRefusal(text) === "admitted" &&
  !editorialNoise(text) &&
  validDeterministicParagraph(text) !== false;

const key = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type Row = {
  story: string;
  source: string;
  kind: "enriched" | "rss";
  text: string;
  headline: string;
  verdict: "furniture" | "prose" | "unclear";
  why: string;
  next: string;
  publish: boolean;
  /** A headword the unit shares with nowhere else: a heading glued to prose. */
  glued: boolean;
};

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const rows: Row[] = [];
const allowedFurnitureRows: Row[] = [];
/** Units the seam guard refuses, with the fragment that made it fire. */
const seamRows: (Row & { seam: string })[] = [];
let admittedHeadlines = 0;
/** The same opening the rule tests, so the admitted list is its complement. */
const WH_OPENING = /^(?:Why|How|What|When|Where|Who|Which|Here)\b/;
const events = await loadCorpusEvents(CORPUS_SIZE, undefined, flag("--corpus"));

for (const event of events) {
  const story = storyForEvent(event);
  for (const source of story.sourceList) {
    const headline = source.headline ?? "";
    const units = [
      ...(source.enrichedEvidence ?? []).map((unit) => ({ ...unit, origin: "enriched" as const })),
      ...readerSentences(source.excerpt ?? "").map((text) => ({
        text,
        kind: "fact",
        origin: "rss" as const,
      })),
    ];
    for (const unit of units) {
      // The three rewrites the pass applies before the check.
      let text = unit.kind === "quote" ? unit.text : unit.text.trim().replace(/®$/, "");
      const retrospective = text.match(/^When we [^,]+, (.+)$/i);
      if (retrospective?.[1] && source.name)
        text = `${source.name} previously reported that ${retrospective[1]}`;
      text = text.replace(/^In the short interval since then,\s*/i, "");

      const unitKey = key(text);
      const headlineKey = key(headline);
      const isHeadline =
        headlineKey.length > 8 &&
        (unitKey === headlineKey ||
          unitKey.startsWith(headlineKey) ||
          unitKey.replace(/ (in|at|for|on|with).*$/, "") === headlineKey);
      // A section heading written into the same field as the prose after it: the
      // sentence is longer than one clause and its first part is not the item
      // headline, which is what every glue case in this corpus looks like.
      const glued =
        !isHeadline &&
        /^[A-Z][^.!?]{9,90}?\s(?:The|All|This|A|An|Attendees|Modern|Website)\b/.test(text);

      const row = (verdict: Row["verdict"], why: string): Row => ({
        story: event.title,
        source: source.name ?? "?",
        kind: unit.origin,
        text,
        headline,
        verdict,
        why,
        next: nextRefusal(text),
        publish: wouldPublish(text),
        glued,
      });

      // Measured before the heading rule, and reported on its own: the seam guard
      // is a second, narrower refusal, and a unit refused by both must not be
      // counted as evidence for either one.
      const seam = sourceSeam(text);
      if (seam) seamRows.push({ ...row("prose", "seam"), seam });

      if (headingUnit(text)) {
        const complete = hasPredicate(text) && /[.!?]$/.test(text);
        rows.push(
          row(
            isHeadline ? "furniture" : complete ? "prose" : "unclear",
            isHeadline
              ? "matches the source's own headline"
              : complete
                ? "complete sentence, not the headline"
                : "no predicate / no terminal punctuation",
          ),
        );
        continue;
      }
      // The trade in the other direction: every wh-opening unit the rule admits,
      // so the prose that came back can be read rather than counted.
      if (WH_OPENING.test(text.trim())) {
        allowedFurnitureRows.push(row("prose", "wh-opening unit the rule admits"));
        if (isHeadline && unit.origin === "rss") admittedHeadlines += 1;
      }
    }
  }
}

const byVerdict = new Map<string, number>();
for (const row of rows) byVerdict.set(row.verdict, (byVerdict.get(row.verdict) ?? 0) + 1);
const publishable = rows.filter((row) => row.publish);
const publishableGlue = publishable.filter((row) => row.glued);
/** The seam guard's own ledger: refused by it, and not by the heading rule. */
const seamOnly = seamRows.filter((row) => !headingUnit(row.text));
const seamPublishable = seamOnly.filter((row) => row.publish);

console.log(`units refused by headingUnit over ${events.length} events: ${rows.length}`);
for (const [verdict, count] of byVerdict) console.log(`  ${verdict}: ${count}`);
console.log(`  of those, admitted by every other rule and publishable: ${publishable.length}`);
console.log(`  of those, a heading glued to prose: ${publishableGlue.length}`);
console.log(`wh-opening units the rule admits: ${allowedFurnitureRows.length}`);
console.log(`  of those, the source's own headline (rss): ${admittedHeadlines}`);
console.log(`units refused by the seam guard over ${events.length} events: ${seamRows.length}`);
console.log(
  `  of those, the heading rule would have refused anyway: ${seamRows.length - seamOnly.length}`,
);
console.log(
  `  reached the gate as one unit and would have published without it: ${seamPublishable.length}`,
);

for (const verdict of ["furniture", "prose", "unclear"] as const) {
  const list = rows.filter((row) => row.verdict === verdict);
  if (list.length === 0) continue;
  console.log(`\n===== ${verdict} (${list.length}) =====`);
  for (const row of list) {
    console.log(`  next=${row.next} publish=${row.publish} glued=${row.glued} [${row.source}]`);
    console.log(`    ${row.text.slice(0, 170)}`);
    if (row.headline) console.log(`    headline: ${row.headline.slice(0, 120)}`);
  }
}

if (seamRows.length > 0) {
  console.log(`\n===== units carrying a seam (${seamRows.length}) =====`);
  for (const row of seamRows) {
    console.log(
      `  seam=${JSON.stringify(row.seam)} heading=${headingUnit(row.text)} publish=${row.publish} [${row.source}]`,
    );
    console.log(`    ${row.text.slice(0, 170)}`);
  }
}

if (allowedFurnitureRows.length > 0) {
  console.log(`\n===== admitted wh-opening units (${allowedFurnitureRows.length}) =====`);
  for (const row of allowedFurnitureRows)
    console.log(`  publish=${row.publish} [${row.source}] ${row.text.slice(0, 140)}`);
}

writeFileSync(
  "/tmp/headline-census.json",
  `${JSON.stringify({ rows, allowedFurnitureRows, seamRows }, null, 1)}\n`,
);
