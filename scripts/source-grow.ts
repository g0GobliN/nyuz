/**
 * The wave tool: turns the candidate pool into new English sources, up to a floor.
 *
 *   npm run source:grow                      # the daily floor: 50
 *   npm run source:grow -- --floor 50 --max-probe 240
 *   npm run source:grow -- --dry-run         # probe and report, write nothing
 *
 * ---------------------------------------------------------------------------
 * Why the wave runs this instead of a person with a list
 * ---------------------------------------------------------------------------
 *
 * The wave cards of 2026-10-22 and 2026-10-28 inserted ~200 sources each because
 * whoever ran them typed a list of feed URLs and inserted them. That works until
 * the list runs out, and it has no language check at all: the 2026-10-28 wave
 * put two non-English sources in front of readers and nobody noticed for a day
 * (card t_06bd689e). So insertion here is a tool, not a judgement call:
 *
 *   every insert is a feed the resolver actually fetched with items in it,
 *   every insert passed the one language gate,
 *   every refusal is written back with its reason, and
 *   the count the card closes on is the count this wrote.
 *
 * ---------------------------------------------------------------------------
 * The rules it enforces, in order
 * ---------------------------------------------------------------------------
 *
 *   1. Fetch first. A candidate is probed with `resolveFeed` -- the same
 *      six-request resolver the demand path uses -- and the source row is only
 *      written after the feed returned item titles. Nothing is inserted on the
 *      strength of a URL looking right, which is the difference between "added a
 *      source" and "added a row".
 *
 *   2. Language before insert. `detectTitlesLanguage` reads the feed's own item
 *      titles. Not English, no insert. English of any country passes: the gate
 *      asks what the words are, never where the outlet is.
 *
 *   3. Duplicates are not growth. A feed URL already in the catalogue is a
 *      duplicate, and counts as zero, however new the host looks.
 *
 *   4. Stop at the floor, keep the rest. Unprobed candidates stay `discovered`
 *      in the pool for the afternoon slot or tomorrow, so a crash or a timeout
 *      delays the count instead of losing the work. This is the durability rule
 *      from the card: a failed run must not read as a completed day, and the
 *      pool must not drain because one run died halfway.
 *
 * ---------------------------------------------------------------------------
 * What it writes
 * ---------------------------------------------------------------------------
 *
 *   sources            one row per accepted feed: origin `discovered`, private
 *                      (`listed = false`) until a human promotes it, demand
 *                      coverage, `last_fetched_at` stamped with the probe time --
 *                      the probe IS the first fetch.
 *
 *   source_candidates  `registered` with the new source id, or `rejected` with
 *                      the reason. Language refusals carry `non-english:<why>`
 *                      so the floor report can count them without reading logs.
 *
 *   ledger             one JSON line per run under `~/.hermes/state/`, for the
 *                      alarm's reason class when the DB is unreachable.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { db, fail, heading, main, say } from "./lib/db.ts";
import { resolveFeed } from "@/lib/discovery/feed";
import { hostKey } from "@/lib/discovery/growth";
import { detectTitlesLanguage } from "@/lib/language-detection";
import { DAILY_FLOOR, operatorDay } from "@/lib/source-floor";

const PAGE_SIZE = 1000;
/** Below this many item titles there is not enough text to judge a language. */
const MIN_ITEM_TITLES = 3;

type Args = {
  floor: number;
  maxProbe: number;
  concurrency: number;
  dryRun: boolean;
  json: boolean;
  day: string;
};

type DueCandidate = {
  id: string;
  url: string;
  domain: string;
  probe_attempts: number;
};

type Outcome =
  | { kind: "registered"; candidate: DueCandidate; feedUrl: string; sourceId: string | null }
  | { kind: "language"; candidate: DueCandidate; reason: string }
  | { kind: "rejected"; candidate: DueCandidate; reason: string; retryable: boolean }
  | { kind: "duplicate"; candidate: DueCandidate; feedUrl: string };

main(async () => {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();

  heading(`Source growth — ${args.day}`);
  say(`floor ${args.floor} · probe cap ${args.maxProbe} · concurrency ${args.concurrency}`);

  const due = await dueCandidates(args.maxProbe);
  say(`candidates due ${due.length}`);

  if (due.length === 0) {
    say("");
    say("The pool is empty. That is the discovery stage's failure, not this one:");
    say("run `npm run source:discover` and check its pool line.");
  }

  const knownFeeds = await knownFeedUrls();
  const outcomes: Outcome[] = [];
  let inserted = 0;

  for (const batch of batchOf(due, args.concurrency)) {
    if (inserted >= args.floor) break;
    const results = await Promise.all(batch.map((candidate) => probe(candidate, knownFeeds, args)));
    for (const result of results) {
      outcomes.push(result);
      if (result.kind === "registered") {
        inserted += 1;
        knownFeeds.add(result.feedUrl);
      }
    }
  }

  const language = outcomes.filter((outcome) => outcome.kind === "language");
  const rejected = outcomes.filter((outcome) => outcome.kind === "rejected");
  const duplicates = outcomes.filter((outcome) => outcome.kind === "duplicate");
  const reached = inserted >= args.floor;

  heading("Result");
  say(`probed            ${outcomes.length}`);
  say(`inserted          ${inserted}`);
  say(`refused language  ${language.length}`);
  say(`refused other     ${rejected.length}`);
  say(`duplicates        ${duplicates.length}`);
  say(`floor             ${args.floor} ${reached ? "met" : "NOT met"}`);

  if (!reached) {
    say("");
    say(`Short by ${args.floor - inserted}. The pool keeps the rest: they are still`);
    say("`discovered`, and tomorrow's run picks them up. Do not lower the floor;");
    say("run `npm run source:discover` to widen the walk.");

    say("");
    say("Why candidates were refused (ten, for the card):");
    for (const outcome of [...language, ...rejected].slice(0, 10)) {
      const why = outcome.kind === "language" ? outcome.reason : outcome.reason;
      say(`  ${outcome.candidate.url}  ${why}`);
    }
  }

  if (args.json) {
    say("");
    say(
      JSON.stringify({
        day: args.day,
        floor: args.floor,
        probed: outcomes.length,
        inserted,
        languageRejected: language.length,
        otherRejected: rejected.length,
        duplicates: duplicates.length,
        reached,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        dryRun: args.dryRun,
      }),
    );
  }

  if (!args.dryRun) {
    await writeLedger({
      at: new Date().toISOString(),
      day: args.day,
      floor: args.floor,
      probed: outcomes.length,
      inserted,
      languageRejected: language.length,
      otherRejected: rejected.length,
      duplicates: duplicates.length,
      reached,
    });
  }

  if (!reached && args.floor > 0) process.exitCode = 1;
});

/* ---------------------------------------------------------------------- */
/* One candidate                                                           */
/* ---------------------------------------------------------------------- */

/**
 * Probe one candidate and write what it turned out to be.
 *
 * Order is deliberate: resolve, then language, then duplicate, then insert. A
 * non-English feed that is also a duplicate is reported as non-English, because
 * that is the fact worth fixing in the pool.
 */
async function probe(
  candidate: DueCandidate,
  knownFeeds: ReadonlySet<string>,
  args: Args,
): Promise<Outcome> {
  const resolution = await resolveFeed(candidate.url);

  if (!resolution.ok) {
    return finish(candidate, args, {
      status: resolution.retryable ? "discovered" : "rejected",
      reject_reason: `unresolved: ${resolution.reason}`,
      retryable: resolution.retryable,
    });
  }

  const { feed } = resolution;

  if (feed.itemTitles.length < MIN_ITEM_TITLES) {
    return finish(candidate, args, {
      status: "rejected",
      reject_reason: `empty-feed: ${feed.itemTitles.length} item title(s)`,
      retryable: false,
    });
  }

  const language = detectTitlesLanguage(feed.itemTitles);
  if (!language.english) {
    return finish(candidate, args, {
      status: "rejected",
      reject_reason: `non-english: ${language.reason}`,
      retryable: false,
      feed_url: feed.feedUrl,
      title: feed.title,
    });
  }

  if (knownFeeds.has(feed.feedUrl)) {
    return finish(candidate, args, {
      status: "rejected",
      reject_reason: "duplicate-feed",
      retryable: false,
      feed_url: feed.feedUrl,
      title: feed.title,
    });
  }

  if (args.dryRun) {
    return { kind: "registered", candidate, feedUrl: feed.feedUrl, sourceId: null };
  }

  const name = feed.title?.trim() || hostKey(feed.feedUrl) || candidate.domain;
  const { data, error } = await db()
    .from("sources")
    .insert({
      name,
      feed_url: feed.feedUrl,
      homepage: feed.homepage,
      kind: "rss",
      coverage_mode: "demand",
      listed: false,
      origin: "discovered",
      active: true,
      // The probe fetched this feed and read its items: that is the first
      // successful fetch, and stamping it is what makes the day's count true.
      last_fetched_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505: another run inserted the same feed first. Not a failure of this
    // one, and not a source — the count must not move.
    if (error.code === "23505") {
      return finish(candidate, args, {
        status: "rejected",
        reject_reason: "duplicate-feed",
        retryable: false,
        feed_url: feed.feedUrl,
        title: feed.title,
      });
    }
    // Any other write error leaves the candidate in the pool for the next run:
    // dropping it would quietly shrink the day's supply.
    return {
      kind: "rejected",
      candidate,
      reason: `insert-failed: ${error.message}`,
      retryable: true,
    };
  }

  const sourceId = typeof data?.id === "string" ? data.id : null;
  await db()
    .from("source_candidates")
    .update({
      status: "registered",
      feed_url: feed.feedUrl,
      title: feed.title,
      resolved_source_id: sourceId,
      reject_reason: null,
      retryable: false,
      probe_attempts: candidate.probe_attempts + 1,
      next_attempt_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", candidate.id);

  return { kind: "registered", candidate, feedUrl: feed.feedUrl, sourceId };
}

/** Writes the candidate's verdict back. Returns the outcome for the summary. */
async function finish(
  candidate: DueCandidate,
  args: Args,
  verdict: {
    status: "discovered" | "rejected";
    reject_reason: string;
    retryable: boolean;
    feed_url?: string;
    title?: string | null;
  },
): Promise<Outcome> {
  const language =
    verdict.reject_reason.startsWith("non-english") || verdict.reject_reason === "english"
      ? null
      : null;
  void language;

  if (!args.dryRun) {
    const nextAttempt =
      verdict.status === "discovered"
        ? new Date(Date.now() + retryDelayMs(candidate.probe_attempts)).toISOString()
        : null;
    await db()
      .from("source_candidates")
      .update({
        status: verdict.status,
        reject_reason: verdict.reject_reason,
        retryable: verdict.retryable,
        probe_attempts: candidate.probe_attempts + 1,
        next_attempt_at: nextAttempt,
        feed_url: verdict.feed_url ?? null,
        title: verdict.title ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id);
  }

  if (verdict.reject_reason.startsWith("non-english")) {
    return { kind: "language", candidate, reason: verdict.reject_reason };
  }
  return {
    kind: "rejected",
    candidate,
    reason: verdict.reject_reason,
    retryable: verdict.retryable,
  };
}

/** Backoff for a candidate whose page timed out: a day, then three. */
function retryDelayMs(attempts: number): number {
  return attempts === 0 ? 24 * 60 * 60_000 : 3 * 24 * 60 * 60_000;
}

/* ---------------------------------------------------------------------- */
/* Database reads                                                          */
/* ---------------------------------------------------------------------- */

/** The candidates whose time has come, oldest first. */
async function dueCandidates(limit: number): Promise<DueCandidate[]> {
  const { data, error } = await db()
    .from("source_candidates")
    .select("id,url,domain,probe_attempts")
    .is("first_topic_id", null)
    .is("first_job_id", null)
    .eq("status", "discovered")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) fail(`reading the pool: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    url: row.url,
    domain: row.domain,
    probe_attempts: row.probe_attempts,
  }));
}

/** Every feed URL the catalogue holds, so a duplicate is recognised before insert. */
async function knownFeedUrls(): Promise<Set<string>> {
  const feeds = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db()
      .from("sources")
      .select("feed_url")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) fail(`reading sources: ${error.message}`);
    for (const row of data ?? []) if (typeof row.feed_url === "string") feeds.add(row.feed_url);
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return feeds;
}

/* ---------------------------------------------------------------------- */
/* Ledger                                                                  */
/* ---------------------------------------------------------------------- */

type LedgerLine = {
  at: string;
  day: string;
  floor: number;
  probed: number;
  inserted: number;
  languageRejected: number;
  otherRejected: number;
  duplicates: number;
  reached: boolean;
};

/**
 * One JSON line per run, outside the database.
 *
 * The alarm's reason class must survive a database that is down, so the run
 * record lives on disk too. Append-only and never read back by the product.
 */
async function writeLedger(line: LedgerLine): Promise<void> {
  const dir = join(homedir(), ".hermes", "state", "nyuz-source-growth");
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "ledger.jsonl"), `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    // A missing ledger must not fail a run whose inserts already landed.
  }
}

/* ---------------------------------------------------------------------- */
/* Plumbing                                                                */
/* ---------------------------------------------------------------------- */

function batchOf<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    floor: DAILY_FLOOR,
    maxProbe: 240,
    concurrency: 6,
    dryRun: false,
    json: false,
    day: operatorDay(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--floor":
        args.floor = numberOr(value, args.floor, flag);
        index += 1;
        break;
      case "--max-probe":
        args.maxProbe = numberOr(value, args.maxProbe, flag);
        index += 1;
        break;
      case "--concurrency":
        args.concurrency = numberOr(value, args.concurrency, flag);
        index += 1;
        break;
      case "--day":
        args.day = value ?? args.day;
        index += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        if (flag !== undefined && flag.startsWith("--")) fail(`unknown flag ${flag}`);
    }
  }

  return args;
}

function numberOr(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) fail(`${flag} needs a number, got ${raw}`);
  return parsed;
}
