/**
 * Do the reader's other surfaces meet their bar, and does an alert carry anything a reader would act on?
 *
 *   npm run audit:surfaces                 the feed, the archive and the alert channel
 *   npm run audit:surfaces -- --feed       one population, on its own
 *   npm run audit:surfaces -- --archive
 *   npm run audit:surfaces -- --alerts [--days 7]
 *   npm run audit:surfaces -- --limit 120  rows per surface population (default 60)
 *   npm run audit:surfaces -- --fixture    the seeded pair: the same report, one
 *                                          deliberate defect, exit 1
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * `audit:delivered-line` answers ruling #11 for the briefing and nothing else. `audit:alerts` is a
 * deep report: it prints six sections of funnel, history and counters and always exits 0, so "the
 * alert side is quiet and meaningful" could not be a *check* — only an opinion formed by reading it.
 * The same held for the home feed and the archive, which had no instrument at all. The checklist in
 * `docs/reader-quality-10-of-10.md` names all four commands and says each one's exit status is the
 * check; two of the four did not exist until this file.
 *
 * So this is the second instrument, shaped exactly like the first: a fixed population, one class per
 * row, every row that is not `agree` printed with the class that refused it and the point in the
 * text where it parts from the bar, one verdict line, and a non-zero exit when a defect survives or
 * when a population had nothing comparable to measure. A green read on zero rows is the claim this
 * instrument must not make, exactly as in the delivered-line audit.
 *
 * ---------------------------------------------------------------------------
 * The bar, per population
 * ---------------------------------------------------------------------------
 *
 * **Feed** — the home feed's cards (`loadHomeFeed` -> `storiesFromDigest`/`loadMatchedStories` ->
 * `gateHomeFeed` -> `StoryCard`). The population is the cards a reader's feed is actually given:
 * the newest ready-or-sent briefing's items for each reader, and matched stories for the readers
 * whose newest briefing is not ready or sent (filtered to matches after a skipped slot), each
 * filtered by the same per-card gate the loader applies (`assessReadiness` plus the title classes
 * rulings #9, #14 and the 2026-10-20 first-party-celebration class added). A matched story that the
 * reader's newest ready-or-sent briefing does not carry is not a card today, so it is not measured —
 * and the skipped branch is applied as the loader applies it, counting the matches that fall before
 * its slot rather than pretending they are on the feed. **The bar is ruling #11, the one the arbiter
 * set on 2026-10-18 and this instrument now enforces here: a card's line is the sentence its story
 * page opens on.**
 *
 * The two sides read a different row wherever the product lets them, and the same row on the one
 * path where the product makes them:
 *
 *   card   the row *that surface's loader* hands the card — the newest briefing's own stored
 *          `summary` for its items (`storiesFromDigest`), the reader's newest delivered artifact
 *          for a matched story (`loadMatchedStories`), resolved through `deliveredLine` and then
 *          the card's boundary (`storyOpening`);
 *   page   the reader's newest delivered artifact for the event, which is what the story page's
 *          loader resolves (`summariesFor`), through the same two calls.
 *
 * On the digest path those are genuinely different rows, and that is the class of defect ruling #11
 * was written for: the 2026-10-19 briefing composed its gate from the article's excerpt while the
 * page composed from the excerpt and its evidence, and three cards opened on a sentence their page
 * never said. A re-delivered event, or an alert that lands after a briefing with no artifact of its
 * own, is where the two still part today — and a row that parts is a defect, and fails the run.
 *
 * On the matches path they are the same row *by design*: `loadMatchedStories` and the story page
 * both call `summariesFor`, so there is no second input for a data-level check to read. This
 * instrument does not pretend otherwise. The claim that survives on that path is the *population* —
 * how many cards carry a line at all — and the defect that would break it (a component that stops
 * calling `storyOpening`, or a loader that stops passing the summary) is caught by
 * `src/components/dashboard/story-opening-surfaces.test.ts`, which renders the card and the page and
 * compares the text a reader would read, and by `story-card.test.ts`, which fails if the card prints
 * a refused stored line instead of recovering the story's own opening. A data audit cannot see a
 * component's rule; saying so here is part of the measurement.
 *
 * **Archive** — the same card, rendered over the items of the newest delivered briefings. It is a
 * separate population because the archive takes a different read path (a briefing card carries *its
 * digest's* stored sentence, while the page carries the reader's newest one), and because the
 * delivered archive is immutable: a row that fails here is a re-render defect at read time, never a
 * reason to rewrite the digest. The classes are identical to the feed's, for that same reason.
 *
 * **Alerts** — the stories that reach the send path now: matched to a listing reader, still inside
 * the flash window at match time, not yet alerted. The bar is what the alert path asks before it
 * interrupts anyone — the briefing's own readiness gate (`assessReadiness`) and the alert shape
 * floor (`assessAlertFloor`) that refuses the five shapes a reader need not act on — and the two
 * gates are re-derived here rather than trusted, so the number is the gates' verdict on the live
 * pool and not a restatement of the send path. A row that clears both is `fire`: an interruption
 * the bar justifies, and the only comparable row. A row the gate or the floor refuses is withheld,
 * and the class names which gate refused it and why — the correct default for an alert, and the
 * evidence that the gate is engaged at all. The defect class is the one this instrument exists to
 * catch: a row that clears both gates yet still reaches a reader, or one the send path would carry
 * while a gate refuses it (`alerts.ts` asks both before sending; this is the check that it still
 * does, on this pool).
 *
 * ---------------------------------------------------------------------------
 * What makes this instrument able to fail
 * ---------------------------------------------------------------------------
 *
 * A check that cannot return `defect` on any input is not a check, and both of
 * this file's card comparisons were one on 2026-10-20: the feed passed the same
 * artifact to both sides of `classifyCard`, so the equality was a tautology and
 * "feed 53/53" could not detect anything. Three things keep that from happening
 * again, and the run is red if any of them stops holding:
 *
 * 1. `selfTest()` runs on every invocation, before the database is touched, and
 *    classifies a seeded pair whose two artifacts differ: it must come back
 *    `defect`, and the same artifact on both sides must come back `agree`. It
 *    calls `cardArtifactFor()` — the function that *picks* which row each side
 *    reads — rather than handing `classifyCard` two literals, because picking
 *    the row is the part that actually broke. A regression to one expression
 *    makes the self-test say so and the run fail with "the check cannot fail"
 *    rather than pass with a full count.
 * 2. `--fixture` runs the audit over that seeded pair instead of the live
 *    population, through the same report and verdict lines, and exits non-zero.
 *    That is the demonstration, reproduced on demand: `npm run audit:surfaces --
 *    --fixture` is a FAIL with one defect, and the real run is a PASS.
 * 3. Each population says which two rows it read and how many rows took each
 *    path, so "card line === page opening" can be read beside the evidence that
 *    the two sides were ever different inputs.
 *
 * **Measured 2026-10-21, and this is why point 1 is worded the way it is.** With
 * the card side collapsed back to the page's artifact at the call site, the real
 * run still printed `PASS feed 23/23` — a correct run and a tautological one were
 * indistinguishable from the output, because on today's data the two rows are
 * usually the same row. Only the self-test, fed a pair that parts, caught it. The
 * `--fixture` mode alone would not have: it exercises `classifyCard` directly, so
 * it said nothing about which row the live path chose.
 *
 * ---------------------------------------------------------------------------
 * Measured 2026-10-20, on the merged tree
 * ---------------------------------------------------------------------------
 *
 *   feed     24/24 on the digest path (0 defects, 0 no line, 1 gated off). The
 *            population is the newest sent briefing's items for the reader who has
 *            one, which is what that reader's feed is; the old population counted
 *            the newest 60 matched events and reported 56 cards, 53 of them
 *            "agreeing" with a second copy of themselves.
 *   archive  25/25 (0 defects, 0 no line).
 *   fixture  1/2 with 1 defect, exit 1: the same report over the seeded pair.
 *
 * The feed count moved because the population is now the cards a reader is shown.
 * 53 was never a feed count; it was a sample of matched events that most readers'
 * feeds do not carry on the day it was taken.
 *
 * ---------------------------------------------------------------------------
 * What a reader is told here, and what it cost
 * ---------------------------------------------------------------------------
 *
 * The feed and archive rows use the same composition path the card does (`recoverCardSummary` only
 * for a stored line the boundary refused), and the alert rows read the same tables the alert stage
 * reads. Nothing is written: SELECT only, service-role client, Node 22 or later.
 */

import { IMPORTANT_FLOOR, withinFlashWindow } from "@/lib/pipeline/alerts";
import {
  assessAlertFloor,
  isCouponPageTitle,
  isReaderDealTitle,
  isReaderModTitle,
} from "@/lib/pipeline/alert-floor";
import { assessReadiness } from "@/lib/pipeline/readiness";
import { isVendorCelebrationTitle } from "@/lib/pipeline/vendor-celebration";
import { allowedBreaking } from "@/lib/plans";
import { composeFromSources } from "@/lib/editorial";
import { storyOpening } from "@/lib/reader-opening";
import { deliveredLine } from "@/lib/reader-summary";
import { db, heading, main, row as rowLine, say } from "./lib/db";
import { loadCorpusEvents, storyForEvent, type CorpusEvent } from "./lib/corpus";

const DEFAULT_LIMIT = 60;
const DEFAULT_DAYS = 7;
/** Delivered briefings whose items make up the archive population. */
const ARCHIVE_BRIEFINGS = 3;
/** Ids per `.in()`; over 400 PostgREST silently returns nothing. */
const CHUNK = 200;
/** How many survivors print before the rest are only counted. */
const SHOW = 20;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const numeric = (name: string, fallback: number): number => {
  const value = Number(flag(name) ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const LIMIT = numeric("--limit", DEFAULT_LIMIT);
const DAYS = numeric("--days", DEFAULT_DAYS);
/**
 * `--fixture` runs the seeded pair instead of the live population, through the
 * same report and verdict lines, and exits non-zero. It is the demonstration
 * that the comparison can fail, reproducible without the database.
 */
const FIXTURE = args.includes("--fixture");
const ONLY = (["--feed", "--archive", "--alerts"] as const).filter((name) => args.includes(name));
const WANT = (population: "feed" | "archive" | "alerts"): boolean =>
  ONLY.length === 0 || ONLY.includes(`--${population}`);

/**
 * Ruling #11 at every card surface: the card's line *is* the page's opening.
 *
 * The briefing has enforced this since 2026-10-18 (`audit:delivered-line`), but
 * the feed and the archive only reported it: **9 of 57** feed card lines and
 * **7 of 14** archive card lines were also the sentence their page opened on,
 * measured 2026-10-18. A reader met the story one way on the card and another
 * way on the page — the defect the ruling exists to empty, on the surfaces most
 * readers actually use.
 *
 * Both surfaces now resolve that sentence through one function (`storyOpening`,
 * `reader-opening.ts`), and this instrument compares the row each loader hands
 * its card with the row the story page resolves, rather than trusting either to
 * have used the function:
 *
 *   card   the newest briefing's own stored `summary` for a digest item
 *          (`storiesFromDigest`), the reader's newest delivered artifact for a
 *          matched card (`loadMatchedStories`) — then `deliveredLine`, then the
 *          card's boundary;
 *   page   the reader's newest delivered artifact for the event, which is what
 *          the story page's loader resolves (`summariesFor`), through the same
 *          two calls.
 *
 * On the digest path and the archive those are *different* rows, and that is the
 * class of defect ruling #11 was written for: a surface that composes from one
 * row while the page composes from another. On the matches path they are one row
 * by design, and the header says so rather than claiming a comparison the code
 * cannot make.
 */
function openingCounterfactual(rows: Row[]): string {
  const withLine = rows.filter((row) => row.line.trim() !== "");
  const same = withLine.filter(
    (row) => row.composition !== undefined && row.line.trim() === row.composition.trim(),
  ).length;
  return rowLine(
    "  the fresh composition is the same sentence (reported, not enforced)",
    `${same} / ${withLine.length}`,
  );
}

type Class = "agree" | "withheld" | "defect";

type Row = {
  /** Where the reader meets it: card position, digest, or reader. */
  label: string;
  title: string;
  /** The line the reader is actually given, or "" when the surface prints none. */
  line: string;
  /**
   * The sentence the story page opens on for the same reader. Absent on the
   * alert rows, which have no page opening to compare with.
   */
  opening?: string;
  verdict: Class;
  /** The gate that refused it, in its own words. Absent on `agree`. */
  bar?: string;
  /** The precise point the line parts from the bar (or the page). */
  part?: string;
  /** The deck a fresh composition chooses, for the drift line. Reported only. */
  composition?: string;
};

/** The first character at which the card and the page part, for a survivor. */
function partPoint(line: string, opening: string): string {
  if (opening.trim() === "") {
    return `the page opens on nothing and the card prints ${JSON.stringify(line.slice(0, 70))}`;
  }
  let index = 0;
  while (index < line.length && index < opening.length && line[index] === opening[index]) index++;
  const from = Math.max(0, index - 40);
  return [
    `at ${index}: card  ${JSON.stringify(line.slice(from, index + 70))}`,
    `            page  ${JSON.stringify(opening.slice(from, index + 70))}`,
  ].join("\n");
}

/**
 * One event, as its card and as its page.
 *
 * `cardArtifact` is the delivered line the surface's own loader hands the card;
 * `pageArtifact` is the one the story page's loader resolves, which is the
 * reader's newest delivery. Both are passed through `deliveredLine` and then
 * `storyOpening`, the same two calls the components make, so this measures the
 * two loaders against each other and not the prose rules.
 */
function classifyCard(
  label: string,
  event: CorpusEvent,
  cardArtifact: string | null,
  pageArtifact: string | null,
): Row {
  const base = storyForEvent(event);
  const cardStory = {
    ...base,
    what: deliveredLine({ summary: cardArtifact }, event.what, event.title),
  };
  const pageStory = {
    ...base,
    what: deliveredLine({ summary: pageArtifact }, event.what, event.title),
  };
  const composition = composeFromSources(base.title, base.sourceList, {
    publishedAt: base.publishedAt,
  }).article.deck.text;
  const line = storyOpening(cardStory);
  // The page's opening, exactly as `StoryArticle` prints it: the card's sentence
  // when the read boundary admits it, the composition's own deck otherwise.
  const pageOpening = storyOpening(pageStory) || composition;
  const row = { label, title: event.title, line, opening: pageOpening, composition };
  // A card with no line contradicts nothing. It is the product's complete-card
  // state (the arbiter's 2026-10-17 ruling: headline, what happened, provenance),
  // and the class keeps it out of both the agreement count and the defects —
  // the same job `no-line` did before the contract was enforced.
  if (line.trim() === "")
    return {
      ...row,
      verdict: "withheld",
      bar: "no line",
      part: `the card prints no line, so it opens the story no way at all  at 0: page ${JSON.stringify(pageOpening.slice(0, 90))}`,
    };
  if (line !== pageOpening)
    return { ...row, verdict: "defect", bar: "page-opening", part: partPoint(line, pageOpening) };
  return { ...row, verdict: "agree" };
}

/* ---------------------------------------------------------------------- */
/* The seeded pair: the evidence that this check can fail                  */
/* ---------------------------------------------------------------------- */

/**
 * One story, two artifacts, and the answer each must produce.
 *
 * A comparison that is handed the same artifact on both sides can only say
 * `agree`, and on 2026-10-20 that is exactly what the feed path did — so
 * "feed 53/53" was a tautology. This pair is the counter-example the instrument
 * checks itself against: two admissible sentences that differ, classified
 * through the same `classifyCard` the live rows use. If a future edit collapses
 * the two sides into one expression again, `selfTest()` reports the verdict it
 * actually returned and the run fails before it reads a row.
 *
 * Both sentences are plain single sentences on purpose: `deliveredLine` and
 * `briefingText` pass them unchanged, so the only thing the classification can
 * turn on is the difference between the two artifacts.
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

/** What a briefing build stored for the item — the card's row. */
const SEEDED_CARD_ARTIFACT =
  "The regulator opened an inquiry into how the payments processor discloses fees and settles payments.";
/** What the reader's newest delivery says — the page's row. */
const SEEDED_PAGE_ARTIFACT =
  "Officials said the inquiry will examine fee disclosure and settlement delays across two markets.";

/** A story with nothing to print: furniture, and no coverage to recover from. */
const SEEDED_SILENT_EVENT: CorpusEvent = {
  ...SEEDED_EVENT,
  id: "00000000-0000-4000-8000-00000000f11f",
  title: "A photograph caption from a wire service",
  what: "Photograph: Alexandra Topping/The Guardian.",
  sources: 0,
  sourceList: [],
  sourceKinds: [],
  coverage: [],
};

/**
 * Which row the card side reads, and which the page side reads.
 *
 * `digest` carries the briefing's own stored `summary` (`storiesFromDigest`);
 * `matches` carries the reader's newest artifact (`loadMatchedStories`) — which is
 * the same row the story page resolves. These are two named reads, not one
 * expression, and `selfTest()` calls *this* function rather than handing
 * `classifyCard` two literals: on 2026-10-20 the feed passed one artifact to both
 * sides of the comparison, so "feed 53/53" was a tautology. A self-test that
 * bypassed this function would not have caught that, and a later edit collapsing
 * it to `return pageArtifact` would otherwise pass again in silence. Measured
 * 2026-10-21: with this collapsed the real run still reported PASS 23/23, which is
 * exactly the failure the self-test exists to make red.
 */
function cardArtifactFor(card: FeedCard, pageArtifact: string | null): string | null {
  return card.path === "digest" ? card.card : pageArtifact;
}

/**
 * Null when the classifier still parts two different artifacts — through the same
 * wiring the live rows use — or the reason it does not. A non-null answer fails
 * the run: the instrument is measuring nothing.
 */
function selfTest(): string | null {
  const reasons: string[] = [];
  // The classifier itself, on two artifacts that differ and on one that repeats.
  const different = classifyCard(
    "self-test",
    SEEDED_EVENT,
    SEEDED_CARD_ARTIFACT,
    SEEDED_PAGE_ARTIFACT,
  );
  const same = classifyCard("self-test", SEEDED_EVENT, SEEDED_CARD_ARTIFACT, SEEDED_CARD_ARTIFACT);
  if (different.verdict !== "defect")
    reasons.push(
      `two different artifacts classified "${different.verdict}" (line ${JSON.stringify(different.line)}, page ${JSON.stringify(different.opening)})`,
    );
  if (same.verdict !== "agree")
    reasons.push(`one artifact on both sides classified "${same.verdict}", not agree`);
  // The wiring: a digest card's own stored line against the page's newest
  // artifact. This is the check that went missing — with the card side reading
  // the page's row, this is the row that parts and the run must go red.
  const digestCard: FeedCard = {
    reader: "00000000-0000-4000-8000-00000000f11d",
    eventId: SEEDED_EVENT.id,
    card: SEEDED_CARD_ARTIFACT,
    path: "digest",
  };
  const wired = classifyCard(
    "self-test",
    SEEDED_EVENT,
    cardArtifactFor(digestCard, SEEDED_PAGE_ARTIFACT),
    SEEDED_PAGE_ARTIFACT,
  );
  if (wired.verdict !== "defect")
    reasons.push(
      `a digest card's own line against the page's artifact classified "${wired.verdict}", so the card side is not reading its own row`,
    );
  return reasons.length === 0 ? null : reasons.join("; ");
}

/**
 * The same report and verdict lines, over the seeded pair, so the failure this
 * instrument is able to produce can be read rather than argued.
 */
function fixtureRows(): Row[] {
  return [
    classifyCard("fixture", SEEDED_EVENT, SEEDED_CARD_ARTIFACT, SEEDED_PAGE_ARTIFACT),
    classifyCard("fixture", SEEDED_EVENT, SEEDED_CARD_ARTIFACT, SEEDED_CARD_ARTIFACT),
    classifyCard("fixture", SEEDED_SILENT_EVENT, null, null),
  ];
}

/**
 * The reader's newest delivered sentence per (reader, event).
 *
 * The story page's loader resolves exactly this (`summariesFor` in
 * `src/lib/server/briefing.ts`), so it is the page's side of every comparison
 * below. Select only; one round trip for the whole population.
 */
const artifactKey = (userId: string, eventId: string): string => `${userId}\u0000${eventId}`;

async function newestArtifacts(
  pairs: { userId: string; eventId: string }[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (pairs.length === 0) return out;
  const ids = [...new Set(pairs.map((pair) => pair.eventId))];
  const client = db();
  const { data, error } = await client
    .from("digest_items")
    .select("event_id, summary, digests ( user_id, scheduled_for )")
    .in("event_id", ids);
  if (error) throw new Error(`digest_items: ${error.message}`);
  const wanted = new Set(pairs.map((pair) => artifactKey(pair.userId, pair.eventId)));
  const newest = new Map<string, string>();
  for (const row of data ?? []) {
    const digest = row.digests as { user_id?: string; scheduled_for?: string } | null;
    const userId = digest?.user_id;
    if (!userId) continue;
    const key = artifactKey(userId, row.event_id);
    if (!wanted.has(key)) continue;
    const at = digest?.scheduled_for ?? "";
    const best = newest.get(key);
    if (best !== undefined && at <= best) continue;
    newest.set(key, at);
    out.set(key, row.summary ?? null);
  }
  return out;
}

/**
 * The newest briefing of every reader, with its items in the order the card list
 * would show them.
 *
 * `loadHomeFeed` asks `latestDigest` for the reader's newest *briefing* — any of
 * ready, sent, skipped, generating or failed — and branches on it: ready or sent
 * renders that digest's items; skipped renders matches that arrived after its
 * slot; anything else renders the live matches. So the status decides which row a
 * feed card carries, which is what this comparison turns on.
 */
type Briefing = {
  reader: string;
  digestId: string;
  status: string;
  scheduledFor: string;
  /** `(eventId, summary)` in `position` order; empty unless ready or sent. */
  items: { eventId: string; summary: string | null }[];
};

async function latestBriefings(): Promise<Map<string, Briefing>> {
  const out = new Map<string, Briefing>();
  const client = db();
  const { data, error } = await client
    .from("digests")
    .select("digest_id, user_id, scheduled_for, status")
    .eq("kind", "briefing")
    .in("status", ["ready", "sent", "skipped", "generating", "failed"])
    .order("scheduled_for", { ascending: false })
    .limit(400);
  if (error) throw new Error(`digests: ${error.message}`);
  for (const row of data ?? []) {
    const userId = row.user_id;
    if (!userId) continue;
    const scheduledFor = row.scheduled_for ?? "";
    const best = out.get(userId);
    if (best !== undefined && scheduledFor <= best.scheduledFor) continue;
    out.set(userId, {
      reader: userId,
      digestId: row.digest_id,
      status: row.status ?? "",
      scheduledFor,
      items: [],
    });
  }
  // Only a ready or sent briefing carries cards; the others decide the branch
  // and their items are not read.
  const carrying = [...out.values()].filter(
    (briefing) => briefing.status === "ready" || briefing.status === "sent",
  );
  const digestOf = new Map(carrying.map((briefing) => [briefing.digestId, briefing] as const));
  const ids = carrying.map((briefing) => briefing.digestId);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: items, error: itemError } = await client
      .from("digest_items")
      .select("digest_id, event_id, position, summary")
      .in("digest_id", ids.slice(i, i + CHUNK))
      .order("position", { ascending: true });
    if (itemError) throw new Error(`digest_items: ${itemError.message}`);
    for (const item of items ?? []) {
      digestOf
        .get(item.digest_id)
        ?.items.push({ eventId: item.event_id, summary: item.summary ?? null });
    }
  }
  return out;
}

/**
 * The story's carriers as `sources.kind` values, for the first-party class.
 *
 * `gateHomeFeed` reads this through `sourceKindsOf(story)`: one carrier with no
 * kind makes the list unknown and the class fails open. The corpus keeps the same
 * kinds per coverage row, so the same rule is applied here — an audit that read
 * the deduplicated union instead would refuse a card the reader is actually shown.
 */
function gateKinds(event: CorpusEvent): string[] {
  const kinds = event.coverage.map((entry) => entry.kind);
  return kinds.length > 0 && kinds.every((kind) => kind !== "") ? kinds : [];
}

/**
 * One card a reader is shown, before it is classified.
 *
 * `path` is which branch of `loadHomeFeed` put it there, and therefore which row
 * its line came from: `digest` carries that briefing's stored `summary`,
 * `matches` carries the reader's newest artifact — the same row the page reads.
 */
type FeedCard = {
  reader: string;
  eventId: string;
  card: string | null;
  path: "digest" | "matches";
};

/**
 * The feed's cards, as `loadHomeFeed` chooses and `gateHomeFeed` gates them.
 *
 * The population is the cards a reader is actually shown, not the newest events
 * in the database: for a reader whose newest briefing is ready or sent, that
 * briefing's items and nothing else — a story matched after the build is not on
 * their feed today — and for every other reader, their matched stories, filtered
 * to those that arrived after a skipped slot when that is the newest briefing.
 *
 * The gate is transcribed from `gateHomeFeed` (`briefing.ts`) because that
 * function is module-private: readiness plus the title classes rulings #9, #14
 * and the 2026-10-20 celebration class landed, asked in the loader's own order.
 *
 * The two paths are the point of the comparison. On the digest path the card
 * reads *this briefing's* stored summary (`storiesFromDigest`) while the page
 * reads the reader's newest artifact (`summariesFor`), which is a genuinely
 * different row whenever an event was re-delivered or alerted afterwards. On the
 * matches path both read the newest artifact, which is one row by design — the
 * header says what that means for the count rather than claiming otherwise.
 */
async function feedRows(): Promise<{
  rows: Row[];
  unmatched: number;
  absent: number;
  digest: number;
  matches: number;
}> {
  const client = db();
  const briefings = await latestBriefings();
  const carrying = [...briefings.values()].filter(
    (briefing) => briefing.status === "ready" || briefing.status === "sent",
  );
  const cards: FeedCard[] = [];
  const seenCards = new Set<string>();
  const push = (card: FeedCard): boolean => {
    const key = artifactKey(card.reader, card.eventId);
    if (seenCards.has(key)) return cards.length < LIMIT;
    seenCards.add(key);
    cards.push(card);
    return cards.length < LIMIT;
  };
  for (const briefing of carrying) {
    for (const item of briefing.items) {
      if (
        !push({
          reader: briefing.reader,
          eventId: item.eventId,
          card: item.summary,
          path: "digest",
        })
      )
        break;
    }
    if (cards.length >= LIMIT) break;
  }

  let absent = 0;
  if (cards.length < LIMIT) {
    const { data: matches, error } = await client
      .from("user_events")
      .select("user_id, event_id, matched_at")
      .order("matched_at", { ascending: false })
      .limit(LIMIT * 10);
    if (error) throw new Error(`user_events: ${error.message}`);
    for (const row of matches ?? []) {
      const briefing = briefings.get(row.user_id);
      if (briefing && (briefing.status === "ready" || briefing.status === "sent")) continue;
      // The skipped branch renders only matches that arrived after its slot.
      if (briefing?.status === "skipped" && (row.matched_at ?? "") < briefing.scheduledFor) {
        absent += 1;
        continue;
      }
      if (!push({ reader: row.user_id, eventId: row.event_id, card: null, path: "matches" })) break;
    }
  }

  const ids = [...new Set(cards.map((card) => card.eventId))];
  if (ids.length === 0) return { rows: [], unmatched: 0, absent, digest: 0, matches: 0 };
  const events = await loadCorpusEvents(ids.length, undefined, undefined, ids);
  const byId = new Map(events.map((event) => [event.id, event] as const));
  const artifacts = await newestArtifacts(
    cards.map((card) => ({ userId: card.reader, eventId: card.eventId })),
  );

  const rows: Row[] = [];
  let unmatched = 0;
  let digestRows = 0;
  let matchRows = 0;
  cards.forEach((card, index) => {
    const event = byId.get(card.eventId);
    if (!event) {
      unmatched += 1;
      return;
    }
    const readiness = assessReadiness({ title: event.title, whatHappened: event.what });
    const onFeed =
      readiness.ready &&
      !isReaderDealTitle(event.title) &&
      !isReaderModTitle(event.title) &&
      !isCouponPageTitle(event.title) &&
      !isVendorCelebrationTitle(event.title, gateKinds(event));
    if (!onFeed) {
      unmatched += 1;
      return;
    }
    const pageArtifact = artifacts.get(artifactKey(card.reader, card.eventId)) ?? null;
    const cardArtifact = cardArtifactFor(card, pageArtifact);
    if (card.path === "digest") digestRows += 1;
    else matchRows += 1;
    rows.push(
      classifyCard(`${`${index + 1}`.padStart(3, "0")}`, event, cardArtifact, pageArtifact),
    );
  });
  return { rows, unmatched, absent, digest: digestRows, matches: matchRows };
}

type ItemRow = {
  event_id: string;
  position: number;
  digest_id: string;
  summary: string | null;
};

async function archiveRows(): Promise<Row[]> {
  const client = db();
  const { data: digests, error } = await client
    .from("digests")
    .select("digest_id, generated_at, kind, scheduled_for, user_id")
    .eq("kind", "briefing")
    .not("generated_at", "is", null)
    .order("scheduled_for", { ascending: false })
    .limit(ARCHIVE_BRIEFINGS);
  if (error) throw new Error(`digests: ${error.message}`);
  const ids = (digests ?? []).map((row) => row.digest_id);
  if (ids.length === 0) return [];

  const items: ItemRow[] = [];
  for (const digestId of ids) {
    const { data, error: itemError } = await client
      .from("digest_items")
      .select("event_id, position, digest_id, summary")
      .eq("digest_id", digestId)
      .order("position", { ascending: true });
    if (itemError) throw new Error(`digest_items: ${itemError.message}`);
    items.push(...((data ?? []) as ItemRow[]));
  }
  if (items.length === 0) return [];

  const events = await loadCorpusEvents(
    items.length,
    undefined,
    undefined,
    items.map((row) => row.event_id),
  );
  const byId = new Map(events.map((event) => [event.id, event] as const));
  const readerOf = new Map(
    (digests ?? []).map((row) => [row.digest_id, row.user_id ?? ""] as const),
  );
  const digestLabel = new Map(
    (digests ?? []).map((row) => [row.digest_id, (row.scheduled_for ?? "").slice(0, 10)] as const),
  );
  // The page's side: the reader's newest delivered sentence for the event.
  const artifacts = await newestArtifacts(
    items.map((item) => ({
      userId: readerOf.get(item.digest_id) ?? "",
      eventId: item.event_id,
    })),
  );
  const rows: Row[] = [];
  for (const item of items) {
    const event = byId.get(item.event_id);
    if (!event) continue;
    const label = `#${item.position} ${digestLabel.get(item.digest_id) ?? ""}`.trim();
    // The briefing card carries *this* digest's stored sentence; the page
    // carries the reader's newest one. That is the pair worth comparing: a
    // re-briefed event is where the two can genuinely part.
    const pageArtifact =
      artifacts.get(artifactKey(readerOf.get(item.digest_id) ?? "", item.event_id)) ?? null;
    rows.push(classifyCard(label, event, item.summary ?? null, pageArtifact));
  }
  return rows;
}

/* ---------------------------------------------------------------------- */
/* Alerts                                                                  */
/* ---------------------------------------------------------------------- */

type AlertEvent = {
  id: string;
  title: string;
  what_happened: string | null;
  importance: number | null;
  status: string;
  first_seen_at: string;
  material_occurrence_at: string | null;
};

type MatchRow = { user_id: string; event_id: string; matched_at: string };

/**
 * The stories that would be sent right now, and what each one is worth interrupting for.
 *
 * The funnel is the shipped one, asked in the order the stage asks it: importance, a match, the
 * flash window at match time, not already alerted, a listening reader, the briefing gate, the alert
 * shape floor. Rows that never reach the radio are reported by the gate that stopped them — that is
 * the correct default (silence), so only a row that *would* fire and still fails is a defect.
 */
async function alertRows(): Promise<{ rows: Row[]; comparable: number; note: string }> {
  const client = db();
  const now = new Date();
  const since = new Date(now.getTime() - DAYS * 24 * 3_600_000).toISOString();

  const { data: events, error } = await client
    .from("events")
    .select("id, title, what_happened, importance, status, first_seen_at, material_occurrence_at")
    .gte("first_seen_at", since)
    .eq("status", "complete")
    .gte("importance", IMPORTANT_FLOOR)
    .order("first_seen_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`events: ${error.message}`);
  const important = (events ?? []) as AlertEvent[];
  if (important.length === 0) {
    return {
      rows: [],
      comparable: 0,
      note: `no complete event at importance >= ${IMPORTANT_FLOOR} in ${DAYS} days`,
    };
  }

  const { data: matches, error: matchError } = await client
    .from("user_events")
    .select("user_id, event_id, matched_at")
    .gte("matched_at", since);
  if (matchError) throw new Error(`user_events: ${matchError.message}`);
  const byEvent = new Map<string, MatchRow[]>();
  for (const row of (matches ?? []) as MatchRow[]) {
    const list = byEvent.get(row.event_id) ?? [];
    list.push(row);
    byEvent.set(row.event_id, list);
  }

  const { data: prefs, error: prefError } = await client
    .from("notification_preferences")
    .select("user_id, breaking, channels, paused");
  if (prefError) throw new Error(`notification_preferences: ${prefError.message}`);
  const { data: subs, error: subError } = await client
    .from("subscriptions")
    .select("user_id, plan");
  if (subError) throw new Error(`subscriptions: ${subError.message}`);
  const planByUser = new Map((subs ?? []).map((row) => [row.user_id, row.plan]));
  const listening = new Set<string>();
  for (const reader of (prefs ?? []) as {
    user_id: string;
    breaking: string | null;
    channels: string[] | null;
    paused: boolean | null;
  }[]) {
    const plan = planByUser.get(reader.user_id) ?? "uno";
    const mode = allowedBreaking(plan, (reader.breaking ?? "off") as "important");
    if (mode !== "off" && reader.paused !== true) listening.add(reader.user_id);
  }

  const { data: alertDigests, error: digestError } = await client
    .from("digests")
    .select("digest_id")
    .eq("kind", "alert");
  if (digestError) throw new Error(`digests: ${digestError.message}`);
  const alertIds = (alertDigests ?? []).map((row) => row.digest_id);
  const alerted = new Set<string>();
  for (let i = 0; i < alertIds.length; i += CHUNK) {
    const { data, error: itemError } = await client
      .from("digest_items")
      .select("event_id")
      .in("digest_id", alertIds.slice(i, i + CHUNK));
    if (itemError) throw new Error(`digest_items: ${itemError.message}`);
    for (const row of data ?? []) alerted.add(row.event_id);
  }

  /** Matched to a reader, still in reach at match time, not yet alerted: the candidate set. */
  const candidates: { event: AlertEvent; listeningReader: boolean }[] = [];
  const withheld: Record<string, number> = {};
  for (const event of important) {
    const rows = byEvent.get(event.id) ?? [];
    const clock = event.material_occurrence_at ?? event.first_seen_at;
    const inReach = rows.filter((row) => withinFlashWindow(clock, new Date(row.matched_at)));
    const why = (key: string) => {
      withheld[key] = (withheld[key] ?? 0) + 1;
    };
    if (rows.length === 0) {
      why("no reader matched");
      continue;
    }
    if (inReach.length === 0) {
      why("outside the flash window at match");
      continue;
    }
    if (alerted.has(event.id)) {
      why("already alerted");
      continue;
    }
    const listener = inReach.some((row) => listening.has(row.user_id));
    if (!listener) {
      why("matched only to a reader who is not listening");
      continue;
    }
    candidates.push({ event, listeningReader: true });
  }

  const stories = await loadCorpusEvents(
    candidates.length,
    undefined,
    undefined,
    candidates.map((row) => row.event.id),
  );
  const byId = new Map(stories.map((story) => [story.id, story] as const));

  const rows: Row[] = [];
  /**
   * The gate is asked *here*, and a refusal is a withhold rather than a defect.
   *
   * This is the boundary between the two: `alerts.ts` asks the readiness gate and the shape floor
   * before it paces or sends, so the correct outcome for a newsletter or a single-source research
   * item is silence — counted and named, never repaired. A row is a defect only if it clears both
   * gates and still cannot be justified, which is what makes the gate line a check rather than a
   * tally of what the pool happens to contain.
   */
  for (const { event } of candidates) {
    const story = byId.get(event.id);
    if (!story) continue;
    const base = { label: event.id.slice(0, 8), title: event.title, line: "" };
    const readiness = assessReadiness({
      title: story.title,
      whatHappened: story.what,
      sourceCount: story.sources,
      sources: story.sourceList,
      sourceKinds: story.sourceKinds,
      publishedAt: story.publishedAt,
    });
    if (!readiness.ready) {
      withheld[`readiness: ${readiness.kind}`] =
        (withheld[`readiness: ${readiness.kind}`] ?? 0) + 1;
      rows.push({
        ...base,
        verdict: "withheld",
        bar: readiness.kind,
        part: `readiness gate ${readiness.kind}  at 0: ${JSON.stringify(readiness.reason.slice(0, 90))}`,
      });
      continue;
    }
    const floor = assessAlertFloor({ title: story.title, whatHappened: story.what });
    if (!floor.ready) {
      withheld[`alert floor: ${floor.kind}`] = (withheld[`alert floor: ${floor.kind}`] ?? 0) + 1;
      rows.push({
        ...base,
        verdict: "withheld",
        bar: floor.kind,
        part: `alert floor ${floor.kind}  at 0: ${JSON.stringify(floor.reason.slice(0, 90))}`,
      });
      continue;
    }
    rows.push({ ...base, verdict: "agree", line: `${story.what.slice(0, 80)}` });
  }
  const note =
    Object.keys(withheld).length === 0
      ? "nothing withheld by the gates"
      : Object.entries(withheld)
          .sort()
          .map(([key, count]) => `${key} ${count}`)
          .join(" · ");
  return { rows, comparable: rows.length, note };
}

/* ---------------------------------------------------------------------- */
/* Report                                                                  */
/* ---------------------------------------------------------------------- */

const tally = (rows: Row[]) => ({
  checked: rows.length,
  agree: rows.filter((row) => row.verdict === "agree").length,
  withheld: rows.filter((row) => row.verdict === "withheld").length,
  defects: rows.filter((row) => row.verdict === "defect").length,
});

/**
 * Every row that is not an agreement, with the class and the point it parts from the bar.
 *
 * A withheld row is not a defect, but it is what the reader gets instead, and the count above cannot
 * say which gate withheld it — so the class prints here for both kinds, in one list, and the label
 * distinguishes them. Defects print first because they are the only ones that fail the run.
 */
function reportSurvivors(name: string, rows: Row[]): void {
  const survivors = rows.filter((row) => row.verdict !== "agree");
  if (survivors.length === 0) return;
  const ordered = [...survivors].sort(
    (a, b) => (a.verdict === "defect" ? 0 : 1) - (b.verdict === "defect" ? 0 : 1),
  );
  say();
  say(`${name} — survivors`);
  for (const row of ordered.slice(0, SHOW)) {
    say(
      `  ${row.verdict === "defect" ? "DEFECT  " : "withheld"} ${row.label}  ${row.title.slice(0, 58)}`,
    );
    say(`            ${row.part ?? row.bar ?? ""}`);
  }
  if (ordered.length > SHOW) say(`  … and ${ordered.length - SHOW} more`);
}

type Result = { name: string; rows: Row[]; note?: string; counterfactual?: string };

function verdictLine(results: Result[]): string {
  const parts: string[] = [];
  let failed = false;
  for (const result of results) {
    const { checked, agree, withheld, defects } = tally(result.rows);
    const comparable = checked - withheld;
    if (comparable === 0) {
      parts.push(`${result.name} N/A`);
      failed = true;
      continue;
    }
    parts.push(
      `${result.name} ${agree}/${comparable} (${withheld} no line, ${defects} defect${defects === 1 ? "" : "s"})`,
    );
    if (defects > 0) failed = true;
  }
  return `reader surfaces  ${failed ? "FAIL" : "PASS"}  ${parts.join(" · ")}`;
}

main(async () => {
  // The instrument's own test, before any row is read: two artifacts that differ
  // must classify as a defect. A comparator that cannot say `defect` reports
  // nothing, and a run that says PASS is the one thing it must not do.
  const broken = selfTest();
  if (broken !== null) {
    say(`reader surfaces  FAIL  the check cannot fail: ${broken}`);
    process.exitCode = 1;
    return;
  }

  const results: Result[] = [];

  if (FIXTURE) {
    heading("The seeded pair — two artifacts that differ, through the same report");
    const rows = fixtureRows();
    reportSurvivors("fixture", rows);
    const { checked, agree, withheld, defects } = tally(rows);
    say();
    say(rowLine("seeded rows read", checked));
    say(rowLine("  card line === page opening", agree));
    say(rowLine("  no line — headline and provenance only", withheld));
    say(rowLine("  DEFECT — a line the page does not open on", defects));
    results.push({ name: "fixture", rows });
    const line = verdictLine(results);
    say();
    say(line);
    process.exitCode = line.includes(" PASS ") ? 0 : 1;
    return;
  }

  if (WANT("feed")) {
    heading(`The feed — the newest ${LIMIT} cards a reader's home feed is shown`);
    const { rows, unmatched, absent, digest, matches } = await feedRows();
    const { checked, agree, withheld, defects } = tally(rows);
    reportSurvivors("feed", rows);
    say();
    say(rowLine("cards a reader is shown", checked));
    say(rowLine("  on the digest path (card and page read different rows)", digest));
    say(rowLine("  on the matches path (card and page read the same row)", matches));
    say(rowLine("  gated off the feed before the card (never seen)", unmatched));
    say(rowLine("  matched before a skipped slot (no card today)", absent));
    say(rowLine("  card line === page opening (ruling #11, enforced)", agree));
    say(rowLine("  no line — headline and provenance only", withheld));
    say(rowLine("  DEFECT — a line the page does not open on", defects));
    say(openingCounterfactual(rows));
    results.push({ name: "feed", rows });
  }

  if (WANT("archive")) {
    heading(`The archive — the newest ${ARCHIVE_BRIEFINGS} delivered briefings, re-rendered`);
    const rows = await archiveRows();
    const { checked, agree, withheld, defects } = tally(rows);
    reportSurvivors("archive", rows);
    say();
    say(rowLine("archived items read", checked));
    say(rowLine("  card line === page opening (ruling #11, enforced)", agree));
    say(rowLine("  no line — headline and provenance only", withheld));
    say(rowLine("  DEFECT — a line the page does not open on", defects));
    say(openingCounterfactual(rows));
    results.push({ name: "archive", rows });
  }

  if (WANT("alerts")) {
    heading(`The alert channel — what would be sent in the last ${DAYS} days`);
    const { rows, note } = await alertRows();
    reportSurvivors("alerts", rows);
    const { agree, withheld, defects } = tally(rows);
    say();
    say(rowLine("stories that would fire (both gates clear)", agree));
    say(rowLine("  withheld by a gate (the correct default)", withheld));
    say(rowLine("  DEFECT — fires while a gate refuses it", defects));
    for (const line of note.split(" · ")) say(`  withheld  ${line}`);
    results.push({ name: "alerts", rows, note });
  }

  const line = verdictLine(results);
  say();
  say(line);
  process.exitCode = line.includes(" PASS ") ? 0 : 1;
});
