/**
 * Runs the pipeline by hand.
 *
 *   npm run pipeline                          the free stages: ingest only
 *   npm run pipeline -- ingest                one stage
 *   npm run pipeline -- ingest --dry-run      fetch and parse, write nothing
 *   npm run pipeline -- ingest --force        ignore backoff and the fetch interval
 *   npm run pipeline -- ingest --limit 5      the five most neglected feeds
 *   npm run pipeline -- cluster --limit 20    group twenty unclustered articles
 *   npm run pipeline -- cluster --dry-run     decide and print, write nothing
 *   npm run pipeline -- cluster --article ID  one article, for checking a known case
 *   npm run pipeline -- analyse --limit 4     understand four events, once each
 *   npm run pipeline -- analyse --dry-run     analyse and print, write nothing
 *   npm run pipeline -- analyse --event ID    one event, for checking a known case
 *   npm run pipeline -- analyse --retry-failed  include events a run failed on
 *   npm run pipeline -- match                 match every reader against every analysed event
 *   npm run pipeline -- match --dry-run       decide and print, write nothing
 *   npm run pipeline -- match --user ID       one reader, for checking a known case
 *   npm run pipeline -- match --since 72      only events analysed in the last 72 hours
 *   npm run pipeline -- match --paused        include readers who paused their briefings
 *   npm run pipeline -- backfill --user ID    day one for one reader: match, then analyse if empty
 *   npm run pipeline -- backfill --user ID --dry-run   report what day one would do
 *   npm run pipeline -- backfill --user ID --free      never analyse, however empty the result
 *
 * The same functions the scheduled Worker calls, with the same arguments. There is
 * no separate code path for running it manually, because a manual run whose
 * behaviour differed from the cron would prove nothing about the cron.
 *
 * **`cluster` and `analyse` spend money.** Every article or event they look at may
 * cost a model call, so both default to a small batch and `--limit` is the only way
 * to make it large. A `--dry-run` still calls the model — it is the writes that are
 * skipped, not the spend — because a dry run that skipped the model would tell you
 * nothing about what the model would decide.
 *
 * `match` spends nothing, ever, and has no small default for that reason. It is set
 * arithmetic over rows that already exist, and re-running it writes nothing the
 * second time.
 *
 * `analyse` will not analyse an event twice however it is invoked, including with
 * `--event`. That property is the product's cost structure and does not have a flag.
 *
 * This holds the service-role key and bypasses row-level security. Nothing in
 * scripts/ may be imported from application code.
 */

import { analyse, type AnalysisReport, type EventOutcome } from "@/lib/pipeline/analyse";
import { backfill, type BackfillReport } from "@/lib/pipeline/backfill";
import { cluster, type ArticleOutcome, type ClusterReport } from "@/lib/pipeline/cluster";
import { ingest, type IngestReport, type SourceOutcome } from "@/lib/pipeline/ingest";
import { match, type MatchReport, type MissReason } from "@/lib/pipeline/match";
import { db, fail, heading, main, row, say } from "./lib/db.ts";

const STAGES = ["ingest", "cluster", "analyse", "match", "backfill"] as const;
type Stage = (typeof STAGES)[number];

/**
 * What a bare `npm run pipeline` runs.
 *
 * Not every stage. A stage that spends model tokens has to be asked for by name,
 * because the alternative is that someone runs the pipeline to check a feed change
 * and is billed for it. So `cluster` and `analyse` are available but never implicit.
 */
const DEFAULT_STAGES: readonly Stage[] = ["ingest"];

/** Flags that take the next argument as their value, so it is not a stage name. */
const VALUED = new Set([
  "--limit",
  "--article",
  "--event",
  "--window",
  "--shortlist",
  "--articles",
  "--user",
  "--since",
]);

main(async () => {
  const args = process.argv.slice(2);
  const named = stageNames(args);
  const stages = named.length > 0 ? named : [...DEFAULT_STAGES];

  for (const stage of stages) {
    if (!isStage(stage)) {
      fail(`Unknown stage "${stage}". Available: ${STAGES.join(", ")}.`);
    }
  }

  for (const stage of stages as Stage[]) {
    if (stage === "ingest") await runIngest(args);
    if (stage === "cluster") await runCluster(args);
    if (stage === "analyse") await runAnalyse(args);
    if (stage === "match") await runMatch(args);
    if (stage === "backfill") await runBackfill(args);
  }

  say();
});

/**
 * The positional arguments, with flag values skipped.
 *
 * Without this, `--limit 6` reads as a request to run a stage called "6" — which
 * is a confusing enough error message to be worth twelve lines of parsing.
 */
function stageNames(args: string[]): string[] {
  const names: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      if (VALUED.has(arg)) i += 1;
      continue;
    }
    names.push(arg);
  }

  return names;
}

function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

async function runIngest(args: string[]): Promise<void> {
  const limit = numberFlag(args, "--limit");
  const dryRun = args.includes("--dry-run");

  heading(dryRun ? "Ingest (dry run — nothing is written)" : "Ingest");
  const report = await ingest(db(), {
    force: args.includes("--force"),
    dryRun,
    ...(limit === null ? {} : { limit }),
  });

  print(report, dryRun);
}

function numberFlag(args: string[], name: string): number | null {
  const index = args.indexOf(name);
  if (index === -1) return null;

  const raw = args[index + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail(`${name} needs a positive whole number.`);
  return value;
}

function stringFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;

  const raw = args[index + 1];
  if (raw === undefined || raw.startsWith("--")) fail(`${name} needs a value.`);
  return raw;
}

async function runCluster(args: string[]): Promise<void> {
  const limit = numberFlag(args, "--limit");
  const windowDays = numberFlag(args, "--window");
  const shortlistSize = numberFlag(args, "--shortlist");
  const article = stringFlag(args, "--article");
  const dryRun = args.includes("--dry-run");

  heading(dryRun ? "Cluster (dry run — decisions only, nothing written)" : "Cluster");

  const report = await cluster(db(), {
    dryRun,
    ...(limit === null ? {} : { limit }),
    ...(windowDays === null ? {} : { windowDays }),
    ...(shortlistSize === null ? {} : { shortlistSize }),
    ...(article === null ? {} : { articleIds: [article] }),
  });

  printCluster(report, dryRun);
}

const DECISION: Record<ArticleOutcome["decision"], string> = {
  attached: "join  ",
  created: "group ",
  alone: "alone ",
  skipped: "dry   ",
  failed: "FAIL  ",
};

function printCluster(report: ClusterReport, dryRun: boolean): void {
  for (const outcome of report.outcomes) {
    // The candidate count is the only per-article signal of what was spent, so it
    // is printed even when zero — a blank there would read as missing rather than
    // as free.
    const shown = `${String(outcome.candidates).padStart(2)}c`;
    say(`${DECISION[outcome.decision]}${shown}  ${outcome.title.slice(0, 58).padEnd(58)}`);
    say(`             ${outcome.detail}`);
  }

  const seconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;
  const tokens = report.promptTokens + report.completionTokens;

  heading(dryRun ? "Summary (nothing was written)" : "Summary");
  say(row("articles considered", report.considered));
  say(row("joined an event", report.attached));
  say(row("new grouped events", report.created));
  say(row("events of one", report.alone));
  say(row("failed", report.failed));
  say(row("model calls", report.modelCalls));
  say(row("decided for free", report.considered - report.modelCalls));
  say(row("prompt tokens", report.promptTokens));
  say(row("completion tokens", report.completionTokens));
  say(
    row("tokens per article", report.considered === 0 ? 0 : Math.round(tokens / report.considered)),
  );
  say(row("seconds", Math.round(seconds)));
}

async function runAnalyse(args: string[]): Promise<void> {
  const limit = numberFlag(args, "--limit");
  const articleLimit = numberFlag(args, "--articles");
  const event = stringFlag(args, "--event");
  const dryRun = args.includes("--dry-run");

  heading(dryRun ? "Analyse (dry run — analysis printed, nothing written)" : "Analyse");

  const report = await analyse(db(), {
    dryRun,
    retryFailed: args.includes("--retry-failed"),
    ...(limit === null ? {} : { limit }),
    ...(articleLimit === null ? {} : { articleLimit }),
    ...(event === null ? {} : { eventIds: [event] }),
  });

  printAnalysis(report, dryRun);
}

const VERDICT: Record<EventOutcome["decision"], string> = {
  analysed: "read  ",
  skipped: "dry   ",
  claimed: "held  ",
  empty: "empty ",
  failed: "FAIL  ",
};

function printAnalysis(report: AnalysisReport, dryRun: boolean): void {
  for (const outcome of report.outcomes) {
    const scores =
      outcome.importance === null ? "  -  " : `${outcome.importance}/${outcome.novelty}`.padEnd(5);

    say(
      `${VERDICT[outcome.decision]}${String(outcome.articles).padStart(2)}a ${scores} ` +
        outcome.title.slice(0, 52).padEnd(52),
    );
    say(`             ${outcome.detail}`);

    // Printed rather than counted: a slug the model keeps reaching for and cannot
    // use is the clearest evidence there is that the topic list is too narrow, and
    // it is only visible here.
    if (outcome.unknownTopics.length > 0) {
      say(`             wanted topics that do not exist: ${outcome.unknownTopics.join(" ")}`);
    }
  }

  const seconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;
  const tokens = report.promptTokens + report.completionTokens;

  heading(dryRun ? "Summary (nothing was written)" : "Summary");
  say(row("events considered", report.considered));
  say(row(dryRun ? "would be analysed" : "analysed", report.analysed + report.skipped));
  say(row("failed", report.failed));
  say(row("held by another run", report.claimed));
  say(row("model calls", report.modelCalls));
  say(row("prompt tokens", report.promptTokens));
  say(row("completion tokens", report.completionTokens));
  // Per event, not per article: this is the number the cost argument rests on, and
  // dividing by articles would flatter it every time coverage is broad.
  say(
    row("tokens per event", report.modelCalls === 0 ? 0 : Math.round(tokens / report.modelCalls)),
  );
  say(row("seconds", Math.round(seconds)));
}

async function runMatch(args: string[]): Promise<void> {
  const user = stringFlag(args, "--user");
  const since = numberFlag(args, "--since");
  const limit = numberFlag(args, "--limit");
  const dryRun = args.includes("--dry-run");

  heading(dryRun ? "Match (dry run — nothing is written)" : "Match");

  const report = await match(db(), {
    dryRun,
    includePaused: args.includes("--paused"),
    ...(limit === null ? {} : { limit }),
    ...(since === null ? {} : { sinceHours: since }),
    ...(user === null ? {} : { userIds: [user] }),
  });

  printMatch(report, dryRun);
}

/**
 * Day one for one reader.
 *
 * `--user` is required rather than defaulting to everybody, because this is the
 * one stage that is about a person rather than about the corpus — and because the
 * path it may take spends money. A bare `backfill` that quietly ran for every
 * account in the database is not a thing an operator should be able to type by
 * accident.
 */
async function runBackfill(args: string[]): Promise<void> {
  const user = stringFlag(args, "--user");
  if (user === null) fail("backfill needs --user ID. It is one reader's first day, not a batch.");

  const dryRun = args.includes("--dry-run");
  const limit = numberFlag(args, "--limit");
  const since = numberFlag(args, "--since");

  heading(dryRun ? "Backfill (dry run — nothing is written)" : "Backfill");

  const report = await backfill(db(), {
    userId: user,
    dryRun,
    // `--free` is the flag for checking the matching half without risking the
    // analysing half, which is what an operator wants nine times out of ten.
    ...(args.includes("--free") ? { onDemand: false } : {}),
    ...(limit === null ? {} : { analyseLimit: limit }),
    ...(since === null ? {} : { windowHours: since }),
  });

  printBackfill(report);
}

function printBackfill(report: BackfillReport): void {
  const seconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;

  say();
  say(report.detail);

  heading("Summary");
  say(row("window (hours)", report.windowHours));
  say(row("outcome", report.outcome));
  say(row("matched", report.matched));
  say(row("written to user_events", report.inserted));
  say(row("analysed on demand", report.analysed));
  say(row("tokens", report.tokens));
  if (report.spentBefore) say(row("day one", "already paid for this account"));
  say(row("seconds", Math.round(seconds)));
}

/** The miss reasons, in the order a reader would ask about them. */
const MISSES: MissReason[] = [
  "no-topic-match",
  "below-threshold",
  "excluded",
  "all-sources-muted",
  "no-topics",
];

function printMatch(report: MatchReport, dryRun: boolean): void {
  for (const outcome of report.outcomes) {
    say(
      `${String(outcome.matched).padStart(4)}/${String(outcome.considered).padEnd(4)} ` +
        `density ${String(outcome.density).padStart(3)} -> importance >= ${outcome.threshold}  ` +
        `${outcome.follows} topics followed  ${outcome.userId}`,
    );

    // Named individually because they are the only answer to "why is my briefing
    // empty", and that question has five different answers with the same symptom.
    const reasons = MISSES.filter((r) => outcome.misses[r] > 0)
      .map((r) => `${r} ${outcome.misses[r]}`)
      .join(", ");
    if (reasons) say(`             not matched: ${reasons}`);
    if (outcome.known > 0) say(`             ${outcome.known} already matched by an earlier run`);
  }

  const seconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;

  heading(dryRun ? "Summary (nothing was written)" : "Summary");
  say(row("readers", report.readers));
  say(row("paused, skipped", report.paused));
  say(row("events considered", report.candidates));
  say(row("pairs matched", report.matched));
  say(row(dryRun ? "would be written" : "written to user_events", report.inserted));
  // The number that has to stay zero-cost: this stage is the only one whose work
  // grows with the reader count, and it must never appear in a token total.
  say(row("model calls", 0));
  say(row("seconds", Math.round(seconds)));
}

const MARK: Record<SourceOutcome["state"], string> = {
  ingested: "new   ",
  unchanged: "same  ",
  quiet: "quiet ",
  waiting: "wait  ",
  failed: "FAIL  ",
};

function print(report: IngestReport, dryRun: boolean): void {
  // Waiting sources are the majority of a second run and say nothing useful one
  // by one; they are counted in the summary instead.
  for (const outcome of report.outcomes.filter((o) => o.state !== "waiting")) {
    const counts =
      outcome.state === "failed"
        ? "  -"
        : `${String(outcome.inserted).padStart(3)}${outcome.retitled > 0 ? ` +${outcome.retitled}` : ""}`;

    say(`${MARK[outcome.state]}${counts}  ${outcome.name.padEnd(24)} ${outcome.detail}`);
    if (outcome.disabled) say(`         switched off after ${outcome.failureCount} failures`);
  }

  const seconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;

  heading(dryRun ? "Summary (nothing was written)" : "Summary");
  say(row("active sources", report.considered));
  say(row("fetched", report.attempted));
  say(row("waiting", report.considered - report.attempted));
  say(row(dryRun ? "articles storable" : "articles inserted", report.inserted));
  say(row("headlines updated", report.retitled));
  say(row("failed", report.failed));
  say(row("switched off", report.disabled));
  say(row("seconds", Math.round(seconds)));
}
