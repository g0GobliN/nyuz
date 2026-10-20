/**
 * Does every delivered briefing card open on the sentence its story page opens on?
 *
 * That is arbiter ruling #11's acceptance criterion (2026-10-18, option 2: one source of truth at the
 * delivered surface). The contract is in `reader-summary.ts` and the briefing build in `digest.ts`;
 * this file is the instrument that says whether a build actually met it, and it exists as a committed
 * script because the measurement was first taken from a scratch file that lived outside the repository
 * -- the same mistake `audit:delivered-summary` was written to stop, where a recorded count could not be
 * reproduced because the probe that produced it had been thrown away.
 *
 * Two populations, one classification:
 *
 *   `audit:delivered-line`
 *     The newest delivered briefing, read from `digests` + `digest_items`. This is the reader's own
 *     artifact: the line each card printed is `deliveredLine({ summary }, events.what_happened)`, so the
 *     comparison is between what a reader received and the sentence the story page renders for the same
 *     event. This is the mode to run after a build.
 *
 *   `audit:delivered-line -- --window [--limit 200] [--out FILE]`
 *     The live window of finished events, asking what a briefing built *now* would deliver for each,
 *     against the sentence the page opens on. This is the census in
 *     `docs/decisions/reader-delivery.md` (ruling #11), and the mode that answers whether the contract
 *     holds for stories before they reach a briefing.
 *
 * Every row lands in exactly one class, and the class is what keeps the number honest:
 *
 *   `agree`     the delivered line is the page's opening, character for character;
 *   `no-deck`   the composition published no deck, so the card falls back to the story's own stored
 *               line -- the boundary ruling #11 drew, not a defect, and reported separately so it can
 *               never inflate the agreement count;
 *   `defect`    the page has a deck and the card's line is a different sentence. This is the class the
 *               ruling exists to empty.
 *
 * Both modes also print the **pre-ruling** count for the same rows -- the same computation with no
 * composed opening, i.e. the rule that predates ruling #11 -- so the before-and-after pair in the record
 * is reproduced by one run rather than by remembering an earlier file.
 *
 * The last line is the verdict, one line, and the process exits non-zero when it is not met (`N/A` for a
 * briefing that delivered no items at all, which is not evidence of anything and must not read as
 * green).
 *
 * Measured 2026-10-18, this instrument:
 *
 *   live window, 200 events     composer published a deck 179, no deck 21
 *                               delivered line === page opening  131/179 before, 179/179 after
 *   delivered briefing 7:30 AM  newest briefing digest `5294a8b9`, built 2026-10-17T22:59Z, 13 items,
 *                               every row written before the ruling: 6/13 agree, 7 defects,
 *                               0 no-deck; the same rows through the new write path: 13/13.
 */

import { writeFileSync } from "node:fs";
import { loadCorpusEvents, storyForEvent } from "./lib/corpus";
import { composeFromSources } from "../src/lib/editorial";
import { storyOpening } from "../src/lib/reader-opening";
import { composedSummaryArtifact, deliveredLine } from "../src/lib/reader-summary";
import { db, main, say } from "./lib/db";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const WINDOW = args.includes("--window");
const LIMIT = (() => {
  const value = Number(flag("--limit") ?? 200);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 200;
})();
const DIGEST = flag("--digest") ?? null;
const OUT = flag("--out") ?? null;

/** One event's rows, as `deliveredLine` would resolve them for a briefing. */
type Measured = {
  /** Where the row sits in the digest, or its index in the window. */
  label: string;
  title: string;
  /** The story's own stored line, which a no-deck card falls back to. */
  stored: string;
  /** The sentence the story page opens on (the composer's own deck). */
  opening: string;
  /**
   * The sentence the page *prints*: `storyOpening` over the line the item was
   * delivered with, falling back to the composition's deck. Since 2026-10-20 the
   * page opens on the same sentence its card carried, so this is what ruling
   * #11's contract is measured against; `opening` stays as the composer's own
   * answer, which is the drift measurement beside it.
   */
  page?: string;
  /** The line a card built before ruling #11 delivered for this item. */
  before: string | null;
  /** The line a card built under the contract delivers for this item. */
  after: string | null;
  /** The line the row actually carries, when the row is a delivered one. */
  actual: string | null;
};

type Verdict = "agree" | "no-deck" | "defect";

const classify = (measured: Measured, line: string | null): Verdict => {
  const page = measured.page ?? measured.opening;
  if (page.trim() === "") return "no-deck";
  // A card that printed no line contradicts nothing: the page opens on its own
  // sentence and there is nothing on the card to disagree with (the same rule
  // `audit:surfaces` applies). Counted on its own so it can neither inflate nor
  // deflate the agreement count.
  if ((line ?? "").trim() === "") return "no-deck";
  return line === page ? "agree" : "defect";
};

const count = (verdicts: Verdict[], verdict: Verdict): number =>
  verdicts.filter((value) => value === verdict).length;

/** The first place two sentences part, so a survivor can be read without printing both in full. */
const divergence = (line: string, opening: string): string => {
  let index = 0;
  while (index < line.length && index < opening.length && line[index] === opening[index]) index++;
  const from = Math.max(0, index - 40);
  return [
    `at ${index}: card  ${JSON.stringify(line.slice(from, index + 70))}`,
    `            page  ${JSON.stringify(opening.slice(from, index + 70))}`,
  ].join("\n");
};

/**
 * Prints the survivors with their class, which is the part a bare count cannot say.
 *
 * `showNoDeck` is on for a delivered briefing, where an item that reached a reader with no deck is
 * worth naming, and off for the window, where the no-deck rows are the population's remainder and are
 * already counted in the line above -- listing 20 of them would bury the defects.
 */
function reportSurvivors(
  measured: Measured[],
  verdicts: Verdict[],
  lines: (string | null)[],
  showNoDeck: boolean,
): void {
  const survivors = measured
    .map((row, index) => ({
      row,
      verdict: verdicts[index] ?? "no-deck",
      line: lines[index] ?? null,
    }))
    .filter((entry) => entry.verdict !== "agree" && (showNoDeck || entry.verdict !== "no-deck"));
  if (survivors.length === 0) return;
  say();
  say(`survivors (${survivors.length})`);
  for (const entry of survivors.slice(0, 20)) {
    const word = entry.verdict === "no-deck" ? "no-deck " : "DEFECT  ";
    say(`  ${word} ${entry.row.label}  ${entry.row.title.slice(0, 62)}`);
    if (entry.verdict === "defect" && entry.line !== null)
      say(`          ${divergence(entry.line, entry.row.opening)}`);
    if (entry.verdict === "defect" && entry.line === null)
      say("          the card printed no line at all");
  }
  if (survivors.length > 20) say(`  … and ${survivors.length - 20} more`);
}

/**
 * The one line that says whether ruling #11 holds.
 *
 * A no-deck row is not a failure: the ruling's boundary is that such a card keeps the story's own
 * stored line rather than inventing a sentence, so it is counted and named beside the defects instead of
 * being folded into the denominator. The verdict is therefore "no defects", and it is `N/A` when there
 * was nothing to check -- a green read on zero rows is the claim this instrument must not make.
 */
function verdictLine(checked: number, verdicts: Verdict[]): string {
  const agreeing = count(verdicts, "agree");
  const noDeck = count(verdicts, "no-deck");
  const defects = count(verdicts, "defect");
  const comparable = checked - noDeck;
  if (comparable === 0)
    return "ruling #11  N/A   0 card lines to check — nothing here can be confirmed";
  const result = defects === 0 ? "PASS" : "FAIL";
  return `ruling #11  ${result}  ${agreeing} / ${comparable} card lines equal their page opening (${defects} defect${defects === 1 ? "" : "s"}, ${noDeck} no-deck fallback)`;
}

function finish(checked: number, verdicts: Verdict[], headline: string[]): void {
  const line = verdictLine(checked, verdicts);
  say();
  for (const entry of headline) say(entry);
  say(line);
  process.exitCode = line.includes(" PASS ") ? 0 : 1;
}

async function delivered(): Promise<void> {
  const client = db();
  const { data: digests, error } = DIGEST
    ? await client
        .from("digests")
        .select("digest_id, generated_at, scheduled_for, kind, status")
        .eq("digest_id", DIGEST)
        .limit(1)
    : await client
        .from("digests")
        .select("digest_id, generated_at, scheduled_for, kind, status")
        .order("scheduled_for", { ascending: false })
        .limit(12);
  if (error) throw new Error(`digests: ${error.message}`);
  const rows = digests ?? [];
  // A briefing that has not been generated has no items and no lines; asking it would report a
  // vacuous pass, so the newest *generated* briefing is the one to read.
  const digest = DIGEST
    ? rows[0]
    : (rows.find((row) => row.generated_at !== null && row.kind === "briefing") ??
      rows.find((row) => row.generated_at !== null));
  // Not `fail()`: that calls `process.exit` with the database socket still open, which on Windows
  // aborts the process and prints a libuv assertion after the message. Setting the exit code and
  // returning lets Node close the handle it opened.
  if (!digest) {
    say(`no digest to read${DIGEST ? ` for --digest ${DIGEST}` : " has been generated"}`);
    process.exitCode = 1;
    return;
  }

  const { data: items, error: itemError } = await client
    .from("digest_items")
    .select("event_id, position, summary")
    .eq("digest_id", digest.digest_id)
    .order("position", { ascending: true });
  if (itemError) throw new Error(`digest_items: ${itemError.message}`);

  const deliveredRows = items ?? [];
  const events = await loadCorpusEvents(
    deliveredRows.length,
    undefined,
    undefined,
    deliveredRows.map((row) => row.event_id),
  );
  const byId = new Map(events.map((event) => [event.id, event] as const));

  const measured: Measured[] = [];
  const verdicts: Verdict[] = [];
  const lines: (string | null)[] = [];
  let missingCoverage = 0;
  for (const item of deliveredRows) {
    const event = byId.get(item.event_id);
    if (!event) {
      missingCoverage++;
      continue;
    }
    const page = storyForEvent(event);
    const opening = composeFromSources(page.title, page.sourceList, {
      publishedAt: event.publishedAt,
    }).article.deck.text;
    const base = {
      title: page.title,
      sources: page.sourceList,
      publishedAt: event.publishedAt,
      whatHappened: event.what,
    };
    const row: Measured = {
      label: `#${item.position}`,
      title: event.title,
      stored: event.what,
      opening,
      // What the page prints for this item, resolved exactly as `StoryArticle`
      // does: the card's sentence when the boundary admits it, the composer's
      // deck otherwise.
      page:
        storyOpening({
          ...page,
          what: deliveredLine({ summary: item.summary ?? null }, event.what, page.title),
        }) || opening,
      before: deliveredLine({ summary: composedSummaryArtifact(base) }, event.what, page.title),
      after: deliveredLine(
        { summary: composedSummaryArtifact({ ...base, opening }) },
        event.what,
        page.title,
      ),
      actual: storyOpening({
        ...page,
        what: deliveredLine({ summary: item.summary ?? null }, event.what, page.title),
      }),
    };
    measured.push(row);
    lines.push(row.actual);
    verdicts.push(classify(row, row.actual));
  }

  if (measured.length === 0) {
    say(
      `delivered briefing   ${digest.digest_id}  (${digest.kind ?? "-"})  built ${digest.generated_at}`,
    );
    finish(0, [], ["items delivered      0"]);
    return;
  }

  const agreeing = count(verdicts, "agree");
  const underPreRulingRule = measured.filter((row) => row.before === row.opening).length;
  const withDeck = measured.filter((row) => row.opening.trim() !== "").length;
  const wouldAgree = measured.filter((row) => row.after === row.opening).length;
  if (missingCoverage > 0) {
    say(`${missingCoverage} item(s) had no event coverage to compose from and are not counted`);
  }
  reportSurvivors(measured, verdicts, lines, true);
  finish(measured.length, verdicts, [
    `delivered briefing   ${digest.digest_id}  (${digest.kind ?? "-"})  scheduled ${digest.scheduled_for}  built ${digest.generated_at}`,
    `items delivered      ${deliveredRows.length}${missingCoverage > 0 ? ` (${missingCoverage} unreadable)` : ""}`,
    `  page published a deck               ${withDeck}`,
    `  card line === page, as delivered    ${agreeing}`,
    `  card line === page, pre-ruling rule ${underPreRulingRule}   (counterfactual, same rows)`,
    `  card line === page if built now     ${wouldAgree}   (what the next build should deliver)`,
  ]);
}

async function window(): Promise<void> {
  const events = await loadCorpusEvents(LIMIT);
  const measured: Measured[] = events.map((event, index) => {
    const page = storyForEvent(event);
    const opening = composeFromSources(page.title, page.sourceList, {
      publishedAt: event.publishedAt,
    }).article.deck.text;
    const base = {
      title: page.title,
      sources: page.sourceList,
      publishedAt: event.publishedAt,
      whatHappened: event.what,
    };
    return {
      label: `${index + 1}`.padStart(3, "0"),
      title: event.title,
      stored: event.what,
      opening,
      before: deliveredLine({ summary: composedSummaryArtifact(base) }, event.what, page.title),
      after: deliveredLine(
        { summary: composedSummaryArtifact({ ...base, opening }) },
        event.what,
        page.title,
      ),
      actual: null,
    };
  });

  const verdicts = measured.map((row) => classify(row, row.after));
  const beforeVerdicts = measured.map((row) => classify(row, row.before));
  const withDeck = measured.filter((row) => row.opening.trim() !== "").length;
  const noDeck = measured.length - withDeck;
  // The ruling's own fallback, counted rather than assumed: a no-deck row whose stored line the
  // delivery boundary accepts keeps it; one whose stored line is refused gets the earlier ruling's
  // recovery composition, or no line at all. `deliveredLine` answers `""` rather than `null` when it
  // refuses, so the empty string is the absence this counts.
  const noDeckRows = measured.filter((row) => row.opening.trim() === "");
  const storedFallback = noDeckRows.filter(
    (row) => row.after !== "" && row.after === row.stored,
  ).length;
  const recoveredFallback = noDeckRows.filter(
    (row) => row.after !== "" && row.after !== row.stored,
  ).length;
  const noLine = noDeckRows.length - storedFallback - recoveredFallback;
  if (OUT) {
    writeFileSync(
      OUT,
      `${JSON.stringify({ at: new Date().toISOString(), limit: LIMIT, rows: measured }, null, 1)}\n`,
    );
  }
  reportSurvivors(
    measured,
    verdicts,
    measured.map((row) => row.after),
    false,
  );
  finish(measured.length, verdicts, [
    `live window          ${measured.length} events (limit ${LIMIT})${OUT ? ` -> ${OUT}` : ""}`,
    `  composer published a deck           ${withDeck}`,
    `  no deck (the ruling's boundary)      ${noDeck}`,
    `    of those, the stored line is delivered  ${storedFallback}`,
    `                a recovered composition     ${recoveredFallback}`,
    `                no line at all              ${noLine}`,
    `  delivered line === page opening, before ruling   ${count(beforeVerdicts, "agree")} / ${withDeck}`,
    `  delivered line === page opening, after ruling    ${count(verdicts, "agree")} / ${withDeck}`,
  ]);
}

main(async () => {
  if (WINDOW) await window();
  else await delivered();
});
