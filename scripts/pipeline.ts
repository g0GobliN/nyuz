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
 *
 * The same functions the scheduled Worker calls, with the same arguments. There is
 * no separate code path for running it manually, because a manual run whose
 * behaviour differed from the cron would prove nothing about the cron.
 *
 * **`cluster` spends money.** Every article it looks at may cost a model call, so
 * it defaults to a small batch and `--limit` is the only way to make it large. A
 * `--dry-run` still calls the model — it is the writes that are skipped, not the
 * spend — because a dry run that skipped the model would tell you nothing about
 * what the model would decide.
 *
 * This holds the service-role key and bypasses row-level security. Nothing in
 * scripts/ may be imported from application code.
 */

import { cluster, type ArticleOutcome, type ClusterReport } from "@/lib/pipeline/cluster";
import { ingest, type IngestReport, type SourceOutcome } from "@/lib/pipeline/ingest";
import { db, fail, heading, main, row, say } from "./lib/db.ts";

const STAGES = ["ingest", "cluster"] as const;
type Stage = (typeof STAGES)[number];

/**
 * What a bare `npm run pipeline` runs.
 *
 * Not every stage. A stage that spends model tokens has to be asked for by name,
 * because the alternative is that someone runs the pipeline to check a feed change
 * and is billed for it. So `cluster` is available but never implicit.
 */
const DEFAULT_STAGES: readonly Stage[] = ["ingest"];

/** Flags that take the next argument as their value, so it is not a stage name. */
const VALUED = new Set(["--limit", "--article", "--window", "--shortlist"]);

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
