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
 *   `audit:delivered-line -- --fixture`
 *     The seeded pair, through this file's own report and verdict: two artifacts that differ, one
 *     deliberate defect, exit 1. It is how the assertion demonstrates that it can fail.
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
 * **Which page this compares against.** The page a reader opens today prints
 * `storyOpening` over the line of their *newest* delivery for the event
 * (`summariesFor` in `src/lib/server/briefing.ts`), not over the line of the
 * briefing being audited. So the page side is read from that newest row here, by
 * its own query and through the same two calls, while the card side is the item's
 * own stored `summary`. For the newest briefing the two rows are usually the same
 * one, and that is a fact about the data rather than a tautology in the code: a
 * re-briefed event, or an alert that landed after the briefing with no artifact of
 * its own, is where the two part, and a part is a defect that fails the run.
 *
 * This is the correction of 2026-10-20. The file had been computing both sides with
 * one expression -- `page` and `actual` were the same `storyOpening` call over the
 * same `item.summary` -- so `classify` could only return `agree` or `no-deck`, and
 * `PASS 25/25` was not evidence about anything.
 *
 * **What makes it able to fail.** `selfTest()` runs on every invocation, before the
 * database is read: it classifies a seeded pair whose two artifacts differ and
 * requires `defect`, and the same artifact on both sides and requires `agree`. It
 * also calls `cardArtifactOf()` / `pageArtifactOf()` and `pageSentence()` — the
 * functions that *pick* the two rows and resolve them — because picking the row is
 * the part that broke. A regression to one expression makes the run fail with "the
 * check cannot fail" instead of printing a count. `--fixture` runs this whole
 * report over that pair and exits non-zero, so the failure it is able to produce
 * can be read: `npm run audit:delivered-line -- --fixture` is a FAIL with one
 * defect, and the real run is a PASS.
 *
 * Measured 2026-10-21: with the page side inlined back onto `item.summary`, the
 * real run still printed `PASS 25 / 25` — on today's single delivered briefing the
 * two rows are the same row, so a correct instrument and a tautological one are
 * indistinguishable from the output alone. Only the self-test caught it, which is
 * why the two reads are named functions rather than inline expressions.
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
 *
 * Re-measured 2026-10-20 on the merged tree, with the page side read from the
 * reader's newest delivery rather than from the audited item (the two were one
 * expression before, so no row could be a defect):
 *
 *   delivered briefing `4a6b2ad2` (sent, 25 items)  25/25 agree, 0 defects, 0 no-deck;
 *                               the pre-ruling rule would agree on 13 of them.
 *   the two newest *generated* briefings were skips with no items, which is why this
 *                               mode now reads the newest briefing that delivered
 *                               cards instead of the newest generated one — it read
 *                               N/A while a 25-item briefing sat two rows below.
 */

import { writeFileSync } from "node:fs";
import { loadCorpusEvents, storyForEvent, type CorpusEvent } from "./lib/corpus";
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
const FIXTURE = args.includes("--fixture");
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

/* ---------------------------------------------------------------------- */
/* The seeded pair: the evidence that this check can fail                  */
/* ---------------------------------------------------------------------- */

/**
 * Two artifacts for one item, and the verdict each must produce.
 *
 * The card side is what a briefing build stored for the item; the page side is
 * what the reader's newest delivery says. They are two sentences on purpose, and
 * `classify` must part them. On 2026-10-20 this file computed both sides with one
 * expression, so `defect` was unreachable and `PASS 25/25` measured nothing; this
 * pair is the counter-example the file checks itself against, and `--fixture`
 * runs the full report over it.
 */
const SEEDED_CARD = "The regulator opened an inquiry into how the processor discloses fees.";
const SEEDED_PAGE =
  "Officials said the inquiry will examine fee disclosure and settlement delays across two markets.";
/** The composer's own deck for the same story, which the page prints when no line is admitted. */
const SEEDED_DECK =
  "The inquiry will examine fee disclosure and settlement delays across two markets.";

/**
 * The story the seeded pair belongs to.
 *
 * Two plain single sentences of coverage on purpose: `deliveredLine` and
 * `storyOpening` pass both artifacts through unchanged, so the only thing the
 * self-test can turn on is the difference between the two rows.
 */
const SEEDED_EVENT: CorpusEvent = {
  id: "00000000-0000-4000-8000-00000000f11e",
  title: "A regulator opens an inquiry into a payments processor",
  what: "The inquiry covers fee disclosure and settlement delays across two markets.",
  status: "complete",
  org: "Example News",
  sources: 2,
  publishedAt: "2026-10-01T00:00:00Z",
  sourceList: [
    {
      name: "Example News",
      at: "",
      headline: "Regulator opens inquiry into payments processor",
      excerpt:
        "The regulator said the inquiry covers fee disclosure and settlement delays across two markets, and that it expects to publish its findings next year.",
    },
    {
      name: "Example Wire",
      at: "",
      headline: "Payments processor faces inquiry over fees",
      excerpt:
        "The inquiry covers fee disclosure and settlement delays across two markets, according to a statement issued on Monday by the regulator.",
    },
  ],
  sourceKinds: ["news", "news"],
  coverage: [
    {
      name: "Example News",
      kind: "news",
      publishedAt: "2026-10-01T00:00:00Z",
      headline: "Regulator opens inquiry into payments processor",
      excerpt:
        "The regulator said the inquiry covers fee disclosure and settlement delays across two markets, and that it expects to publish its findings next year.",
      enrichment: "none",
    },
    {
      name: "Example Wire",
      kind: "news",
      publishedAt: "2026-10-01T00:00:00Z",
      headline: "Payments processor faces inquiry over fees",
      excerpt:
        "The inquiry covers fee disclosure and settlement delays across two markets, according to a statement issued on Monday by the regulator.",
      enrichment: "none",
    },
  ],
};

const seededRow = (page: string, opening = SEEDED_DECK): Measured => ({
  label: "seeded",
  title: "A regulator opens an inquiry into a payments processor",
  stored: SEEDED_CARD,
  opening,
  page,
  before: SEEDED_CARD,
  after: SEEDED_CARD,
  actual: SEEDED_CARD,
});

/**
 * The page side and the card side of the verdict, as one expression each.
 *
 * Both call `storyOpening` over `deliveredLine`, and they differ in one argument
 * only — which artifact row they resolve. `artifact` is the brief build's stored
 * `summary` on the card side and the reader's newest delivered row on the page
 * side. Keeping the difference in the *caller* rather than in this function is
 * what lets `selfTest()` prove the two rows are genuinely independent: on
 * 2026-10-20 the page side was built from `item.summary`, the same expression as
 * the card side, so `classify` could only return `agree` or `no-deck` and
 * `PASS 25/25` measured nothing.
 */
function pageSentence(
  page: ReturnType<typeof storyForEvent>,
  artifact: string | null,
  event: { what: string; title: string },
  fallback: string,
): string {
  return (
    storyOpening({
      ...page,
      what: deliveredLine({ summary: artifact }, event.what, event.title),
    }) || fallback
  );
}

/**
 * The page side's artifact, and the card side's — two different rows by name.
 *
 * The card reads the row this brief build stored (`item.summary`); the page reads
 * the reader's newest delivered row for the event, which is what `summariesFor`
 * hands the story page. These are deliberately *not* one expression: on 2026-10-20
 * both sides were built from `item.summary`, and the verdict could then only be
 * `agree` or `no-deck`.
 *
 * They are separate functions for a measured reason. With the two rows simply
 * inlined at the call site, putting the card's row back on the page side left the
 * run at PASS 25/25 with no complaint — measured 2026-10-21 — because on today's
 * single delivered briefing the two rows *are* the same row, so a correct run and
 * a tautological one are indistinguishable from the output alone. `selfTest()`
 * calls these functions with two rows that differ, so the wiring is checked
 * against a pair that parts rather than against a coincidence in the data.
 */
const cardArtifactOf = (item: { summary: string | null }): string | null => item.summary ?? null;
const pageArtifactOf = (
  item: { event_id: string },
  pageArtifacts: Map<string, string | null>,
): string | null => pageArtifacts.get(item.event_id) ?? null;

/**
 * Null when `classify` still parts two different artifacts — through this same
 * resolution and these same two reads the live rows use — or the reason it does
 * not. A non-null answer fails the run before any row is read.
 */
function selfTest(): string | null {
  const reasons: string[] = [];
  // The verdict, on two artifacts that differ and on one that repeats.
  const different = classify(seededRow(SEEDED_PAGE), SEEDED_CARD);
  const same = classify(seededRow(SEEDED_CARD), SEEDED_CARD);
  if (different !== "defect")
    reasons.push(`two different artifacts classified "${different}", not defect`);
  if (same !== "agree") reasons.push(`one artifact on both sides classified "${same}", not agree`);
  // The two reads, over a map that differs from the item. This is the pair the
  // 2026-10-20 code could not part, because there was only one read.
  const item = { event_id: SEEDED_EVENT.id, summary: SEEDED_CARD };
  const map = new Map([[SEEDED_EVENT.id, SEEDED_PAGE]]);
  const cardArtifact = cardArtifactOf(item);
  const pageArtifact = pageArtifactOf(item, map);
  if (cardArtifact === pageArtifact)
    reasons.push(
      "the card's own row and the page's newest delivery are the same artifact, so the two sides are not independent",
    );
  // And the sentence each side resolves, through the shared resolution.
  const story = storyForEvent(SEEDED_EVENT);
  if (
    pageSentence(story, cardArtifact, SEEDED_EVENT, SEEDED_DECK) ===
    pageSentence(story, pageArtifact, SEEDED_EVENT, SEEDED_DECK)
  )
    reasons.push(
      "the card's own line and the page's newest delivery resolve to the same sentence, so the two sides are not independent",
    );
  return reasons.length === 0 ? null : reasons.join("; ");
}

/** The same report and verdict, over the seeded pair, with one deliberate defect. */
function fixture(): void {
  const measured = [seededRow(SEEDED_PAGE), seededRow(SEEDED_CARD)];
  const verdicts = measured.map((row) => classify(row, row.actual));
  reportSurvivors(
    measured,
    verdicts,
    measured.map((row) => row.actual),
    true,
  );
  finish(measured.length, verdicts, [
    "seeded pair            two artifacts, one of them different from the other",
    `  card line === page opening          ${count(verdicts, "agree")}`,
    `  DEFECT — the two rows differ        ${count(verdicts, "defect")}`,
  ]);
}

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
      say(`          ${divergence(entry.line, entry.row.page ?? entry.row.opening)}`);
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

/**
 * The reader's newest delivered sentence for each event.
 *
 * This is the page's side of the verdict, read the way the story page's loader
 * reads it (`summariesFor` in `src/lib/server/briefing.ts`): the row whose digest
 * was scheduled latest wins, and a row that stored no artifact answers `null`, so
 * the page falls back to the event's own line exactly as it does in production.
 * The loader module imports the browser Supabase client through its auth guard
 * and cannot be loaded under Node, so the read is transcribed here rather than
 * called; the function it mirrors is named above so the two are kept in step.
 */
async function newestArtifacts(
  reader: string | null,
  eventIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!reader || eventIds.length === 0) return out;
  const { data, error } = await db()
    .from("digest_items")
    .select("event_id, summary, digests ( user_id, scheduled_for )")
    .in("event_id", eventIds);
  if (error) throw new Error(`digest_items: ${error.message}`);
  const newest = new Map<string, string>();
  for (const row of data ?? []) {
    const digest = row.digests as { user_id?: string; scheduled_for?: string } | null;
    if (digest?.user_id !== reader) continue;
    const at = digest?.scheduled_for ?? "";
    const best = newest.get(row.event_id);
    if (best !== undefined && at <= best) continue;
    newest.set(row.event_id, at);
    out.set(row.event_id, row.summary ?? null);
  }
  return out;
}

async function delivered(): Promise<void> {
  const client = db();
  const { data: digests, error } = DIGEST
    ? await client
        .from("digests")
        .select("digest_id, generated_at, scheduled_for, kind, status, user_id, item_count")
        .eq("digest_id", DIGEST)
        .limit(1)
    : await client
        .from("digests")
        .select("digest_id, generated_at, scheduled_for, kind, status, user_id, item_count")
        .order("scheduled_for", { ascending: false })
        .limit(24);
  if (error) throw new Error(`digests: ${error.message}`);
  const rows = digests ?? [];
  // The population is the newest briefing that actually *delivered* cards. A
  // briefing that was skipped has no items and no lines, so asking it reports a
  // vacuous pass or a vacuous N/A; on 2026-10-20 the two newest generated
  // briefings were skips and this instrument read N/A while a 25-item briefing sat
  // below them. `sent` first, then a `ready` build, then anything generated with
  // items — and if there is no such row, N/A is the honest answer.
  const digest = DIGEST
    ? rows[0]
    : (rows.find(
        (row) =>
          row.generated_at !== null &&
          row.kind === "briefing" &&
          row.status === "sent" &&
          row.item_count > 0,
      ) ??
      rows.find(
        (row) => row.generated_at !== null && row.kind === "briefing" && row.item_count > 0,
      ) ??
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
  // The page's side: the reader's newest delivery for each event, read by its own
  // query. This is not the audited item's row — that is the point. For the newest
  // briefing the two coincide unless the event was re-delivered or alerted
  // afterwards, and a row where they part is a defect.
  const pageArtifacts = await newestArtifacts(
    digest.user_id ?? null,
    deliveredRows.map((row) => row.event_id),
  );

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
      // What the story page prints for this reader today, resolved exactly as
      // `StoryArticle` does: the newest delivered sentence when the boundary
      // admits it, the composer's deck otherwise.
      page: pageSentence(page, pageArtifactOf(item, pageArtifacts), event, opening),
      before: deliveredLine({ summary: composedSummaryArtifact(base) }, event.what, page.title),
      after: deliveredLine(
        { summary: composedSummaryArtifact({ ...base, opening }) },
        event.what,
        page.title,
      ),
      // What this briefing card printed for the reader, resolved exactly as
      // `StoryCard` does, from the row this build stored. The same call as the
      // page side above, over a different row — that difference is the verdict.
      actual: pageSentence(page, cardArtifactOf(item), event, ""),
    };
    measured.push(row);
    lines.push(row.actual);
    verdicts.push(classify(row, row.actual));
  }

  if (measured.length === 0) {
    say(
      `delivered briefing   ${digest.digest_id}  (${digest.kind ?? "-"} / ${digest.status ?? "-"})  built ${digest.generated_at}`,
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
    `delivered briefing   ${digest.digest_id}  (${digest.kind ?? "-"} / ${digest.status ?? "-"})  scheduled ${digest.scheduled_for}  built ${digest.generated_at}`,
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
  // The instrument's own test, before any row is read: two artifacts that differ
  // must classify as a defect. A comparator that cannot say `defect` reports
  // nothing, and printing a PASS is the one thing it must not do.
  const broken = selfTest();
  if (broken !== null) {
    say(`ruling #11  FAIL  the check cannot fail: ${broken}`);
    process.exitCode = 1;
    return;
  }
  if (FIXTURE) fixture();
  else if (WINDOW) await window();
  else await delivered();
});
