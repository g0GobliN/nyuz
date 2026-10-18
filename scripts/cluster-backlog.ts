/**
 * Drain the clustering backlog — the articles no scheduled run can reach.
 *
 * Why this exists, measured 2026-10-18: `priority_articles_to_cluster` reaches a backlog only
 * `backlog_cutoff = now() - interval '7 days'` deep, one sixth of a ≤100 batch, so **24,935 of the
 * live 25,252 unclustered articles (99%) cannot be reached by the matcher at all**. That is the
 * measured reason the coverage rung of the significance ladder is starved — `events with ≥2
 * publishers` was 152 of 12,256 complete ones (1.2%) — and therefore the reason briefings ship with
 * no "why it matters" line (`ladder now: none 13` on the delivered briefing).
 *
 * The arbiter ruled the repair (ruling #12, 2026-10-18, option 1): extend the clustering window from
 * 7 to 45 days and drain the backlog in bounded batches, measuring before scaling — and explicitly:
 * *"do not declare success simply because the backlog shrinks; the objective is to increase the
 * number of correctly explained stories"*, with no material increase in false joins and no change to
 * the free-plan budget. The scheduled-path half of that ruling is
 * `supabase/migrations/0120_cluster_backlog_window.sql`; this script is the drain itself, which runs
 * on the operator's machine (where the CPU is free) instead of in the 10 ms cron budget.
 *
 * It is deliberately conservative:
 *   * **bounded** — `--limit` (default 100, max 200) articles per run, newest of the backlog first;
 *   * **`--dry-run` first** — decisions and prints, writes nothing, so a batch's joins can be read
 *     before any row moves;
 *   * **zero model calls** — the matcher is deterministic (`src/lib/pipeline/cluster.ts`); the script
 *     asserts that and fails loudly if a run ever reports otherwise;
 *   * **measured** — events with ≥2 publishers before and after, the ruling's own acceptance number,
 *     plus every join printed with both titles so a false join is visible rather than inferred.
 *
 * Usage:
 *   npm run cluster:backlog -- --dry-run --limit 40     # read the decisions, write nothing
 *   npm run cluster:backlog -- --limit 100              # drain one bounded batch
 */

import type { SourceKind } from "@/lib/supabase/types";
import { cluster, type ClusterReport } from "@/lib/pipeline/cluster";
import { db, heading, main, row, say } from "./lib/db";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => {
  const value = Number(arg("--limit") ?? 100);
  if (!Number.isFinite(value) || value <= 0) return 100;
  return Math.min(200, Math.floor(value));
})();
/**
 * How deep into the backlog to reach. 45 days is the arbiter's ruling (#12, option 1) and matches the
 * demand-driven source window, so the drain sees the material the queue withheld for the same reason.
 */
const DAYS = (() => {
  const value = Number(arg("--days") ?? 45);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 45;
})();
/**
 * Restrict the batch to sources of one kind (`--kind news`).
 *
 * Measured 2026-10-18, the 7–45 day backlog is 14,657 articles: **10,090 research** (arXiv) against
 * **4,034 news**. A drain that takes the newest rows first therefore spends its batches on papers,
 * which are single-source by construction and are withheld from briefings as `primary-source` anyway —
 * the first 40-article dry run joined nothing at all for exactly that reason. Cross-outlet joins live
 * in the news slice, so that is the slice to measure.
 */
const KIND = (arg("--kind") ?? null) as SourceKind | null;

/** `sources.publisher_count` is not on `events`; this is the same count the ladder's rung reads. */
async function multiPublisherEvents(): Promise<number> {
  const { count, error } = await db()
    .from("events")
    .select("*", { count: "exact", head: true })
    .gte("publisher_count", 2);
  if (error) throw new Error(`counting multi-publisher events: ${error.message}`);
  return count ?? 0;
}

/** The backlog: unclustered, older than the queue's 7-day cutoff, inside the ruled 45-day window. */ async function backlogBatch(): Promise<
  { id: string; title: string; published_at: string | null }[]
> {
  const now = Date.now();
  let query = db()
    .from("articles")
    .select("id, title, published_at")
    .is("event_id", null)
    .lt("published_at", new Date(now - 7 * 86_400_000).toISOString())
    .gte("published_at", new Date(now - DAYS * 86_400_000).toISOString())
    .order("published_at", { ascending: false })
    .limit(LIMIT);
  if (KIND !== null) {
    const { data: sources, error } = await db().from("sources").select("id, kind").eq("kind", KIND);
    if (error) throw new Error(`selecting ${KIND} sources: ${error.message}`);
    const ids = (sources ?? []).map((source) => source.id);
    if (ids.length === 0) return [];
    query = query.in("source_id", ids);
  }
  const { data, error } = await query;
  if (error) throw new Error(`selecting the backlog: ${error.message}`);
  return data ?? [];
}

function printJoin(outcome: ClusterReport["outcomes"][number]): void {
  if (outcome.decision !== "attached" && outcome.decision !== "created") return;
  say(
    `  ${outcome.decision === "attached" ? "joined " : "grouped"} ${String(outcome.siblings).padStart(2)}  ${outcome.title.slice(0, 58)}`,
  );
  say(`          ${outcome.detail}`);
}

main(async () => {
  const before = await multiPublisherEvents();
  const batch = await backlogBatch();
  heading(
    DRY_RUN
      ? `Cluster backlog (dry run — nothing written, ${DAYS}-day window${KIND === null ? "" : `, ${KIND} sources only`})`
      : `Cluster backlog (${DAYS}-day window${KIND === null ? "" : `, ${KIND} sources only`})`,
  );
  if (batch.length === 0) {
    say("nothing to drain: no unclustered article between 7 and " + `${DAYS} days old`);
    return;
  }
  say(`batch                 ${batch.length} articles, newest of the backlog first`);
  say(`oldest in batch       ${batch[batch.length - 1]?.published_at ?? "-"}`);

  const report = await cluster(db(), {
    dryRun: DRY_RUN,
    articleIds: batch.map((article) => article.id),
  });
  const seconds = (Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000;
  const after = DRY_RUN ? before : await multiPublisherEvents();

  if (report.modelCalls !== 0) {
    throw new Error(
      `the matcher is supposed to be deterministic but reported ${report.modelCalls} model call(s)`,
    );
  }

  say();
  say("joins and new groups (what a false join would appear as)");
  const notable = report.outcomes.filter(
    (o) => o.decision === "attached" || o.decision === "created",
  );
  if (notable.length === 0) say("  none — every article in this batch stood alone");
  for (const outcome of notable.slice(0, 12)) printJoin(outcome);
  if (notable.length > 12) say(`  … and ${notable.length - 12} more`);

  heading("Summary");
  say(row("articles considered", report.considered));
  say(row("joined an existing event", report.attached));
  say(row("new grouped events", report.created));
  say(row("events of one", report.alone));
  say(row("failed", report.failed));
  say(row("model calls", report.modelCalls));
  say(row("seconds", seconds.toFixed(1)));
  say(row("events >=2 publishers before", before));
  say(row("events >=2 publishers after", after));
  say(
    DRY_RUN
      ? `backlog drain: ${report.considered} considered, ${report.attached} joined, ${report.created} grouped — nothing written (dry run)`
      : `backlog drain: ${report.considered} considered, ${report.attached} joined, ${report.created} grouped · events >=2 publishers ${before} -> ${after} · model calls 0`,
  );
});
