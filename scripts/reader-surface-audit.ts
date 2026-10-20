/**
 * Do the reader's other surfaces meet their bar, and does an alert carry anything a reader would act on?
 *
 *   npm run audit:surfaces                 the feed, the archive and the alert channel
 *   npm run audit:surfaces -- --feed       one population, on its own
 *   npm run audit:surfaces -- --archive
 *   npm run audit:surfaces -- --alerts [--days 7]
 *   npm run audit:surfaces -- --limit 120  rows per surface population (default 60)
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
 * `gateHomeFeed` -> `StoryCard`). The population is the reader's own matched stories, newest first,
 * filtered by the same per-card gate the loader applies (`assessReadiness` plus the three title
 * classes rulings #9 and #14 landed) — because an unmatched event never reaches a feed card, and
 * measuring it would report defects on a surface no reader has. **The bar is ruling #11, the one the
 * arbiter set on 2026-10-18 and this instrument now enforces here: a card's line is the sentence its
 * story page opens on.** The card's line is the item's delivered line as the loader resolves it
 * (`deliveredLine`) run through the card's boundary (`storyOpening`); the page's opening is the same
 * resolution through the story page's loader, which reads the reader's newest delivered artifact.
 * The two sides read different rows on purpose, because that is the defect class ruling #11 was
 * written for — a gate that composed from one input while the page composed from another. A card
 * that resolves no line is `withheld`: it opens the story no way at all, so it cannot contradict the
 * page, and it is counted on its own so it can neither inflate nor deflate the agreement count. A
 * card whose line the page does not open on is a defect, and the run fails.
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
 * `reader-opening.ts`), and this instrument compares what each surface would
 * print rather than trusting them to have used it:
 *
 *   card   the item's delivered line as that surface's loader resolves it — a
 *          digest item's own `summary` for a briefing card, the reader's newest
 *          delivered artifact for a matched card — then the card's boundary;
 *   page   the same resolution through the story page's loader, which reads the
 *          reader's newest delivered artifact for the event.
 *
 * The two sides therefore read *different* rows on purpose. That is the class of
 * defect ruling #11 was written for: the 2026-10-19 briefing composed its gate
 * from the article's excerpt while the page composed from the excerpt and its
 * evidence, and three cards opened on a sentence their page never said. A check
 * that asked one loader and then compared it with itself could not have caught
 * that, and cannot catch its return.
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
 * The reader's own feed, as `loadHomeFeed` gates it.
 *
 * `leads` is the newest matched event ids; the gate is transcribed from `gateHomeFeed`
 * (`briefing.ts`) because that function is module-private and a second implementation is what this
 * instrument must not be. Ruling #9's two title classes belong to the same gate and are asked here
 * with the readiness check, in the same order, or the audit would report cards a reader never gets.
 *
 * The card's delivered line is the reader's newest artifact for the event, which is what
 * `loadMatchedStories` passes to `hydrateEvents` — the same call the story page makes.
 */
async function feedRows(): Promise<{ rows: Row[]; unmatched: number }> {
  const client = db();
  const { data: matches, error } = await client
    .from("user_events")
    .select("user_id, event_id, matched_at")
    .order("matched_at", { ascending: false })
    .limit(LIMIT * 10);
  if (error) throw new Error(`user_events: ${error.message}`);
  const ids: string[] = [];
  const readerOf = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of matches ?? []) {
    if (seen.has(row.event_id)) continue;
    seen.add(row.event_id);
    ids.push(row.event_id);
    readerOf.set(row.event_id, row.user_id);
    if (ids.length >= LIMIT) break;
  }
  if (ids.length === 0) return { rows: [], unmatched: 0 };

  const events = await loadCorpusEvents(ids.length, undefined, undefined, ids);
  const byId = new Map(events.map((event) => [event.id, event] as const));
  const artifacts = await newestArtifacts(
    ids.map((id) => ({ userId: readerOf.get(id) ?? "", eventId: id })),
  );
  const rows: Row[] = [];
  let unmatched = 0;
  ids.forEach((id, index) => {
    const event = byId.get(id);
    if (!event) {
      unmatched += 1;
      return;
    }
    const readiness = assessReadiness({ title: event.title, whatHappened: event.what });
    const onFeed =
      readiness.ready &&
      !isReaderDealTitle(event.title) &&
      !isReaderModTitle(event.title) &&
      !isCouponPageTitle(event.title);
    if (!onFeed) {
      unmatched += 1;
      return;
    }
    const artifact = artifacts.get(artifactKey(readerOf.get(id) ?? "", id)) ?? null;
    rows.push(classifyCard(`${`${index + 1}`.padStart(3, "0")}`, event, artifact, artifact));
  });
  return { rows, unmatched };
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
  const results: Result[] = [];

  if (WANT("feed")) {
    heading(`The feed — the newest ${LIMIT} events, as a card renders them`);
    const { rows, unmatched } = await feedRows();
    const { checked, agree, withheld, defects } = tally(rows);
    reportSurvivors("feed", rows);
    say();
    say(rowLine("cards a reader is shown", checked));
    say(rowLine("  gated off the feed before the card (never seen)", unmatched));
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
