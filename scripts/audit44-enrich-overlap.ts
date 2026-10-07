/**
 * Audit 44 — concurrent enrich invocations: how often, and what the overlap
 * costs.
 *
 * The arbiter's finding (OPEN, measurement only) came out of the Audit 38
 * observation: two `cron:stages` enrich runs 7.07s apart in minute 08:04, the
 * newer one starting while the older was still walking its batch. `readEvidence`
 * states an assumption in its own comment — "this stage fires on its own cron
 * minutes and walks its batch sequentially, so a pending row seen at the start
 * of a run is not from this run" — and an overlapping invocation falsifies it:
 * the newer run reads the older one's live claims as abandoned, deletes them,
 * and can select the same article again.
 *
 * The three questions, in the arbiter's words: how often do enrich invocations
 * overlap, how often does overlap cause the same article to be selected or
 * re-fetched, and does reclaiming another invocation's pending work produce a
 * wrong terminal state, duplicate evidence, or merely wasted work.
 *
 * What this instrument can answer from existing rows, without touching the
 * pipeline:
 *
 * 1. Frequency and shape of overlaps: every consecutive pair of enrich runs
 *    whose windows intersect, with the started_at gap, the overlap in seconds,
 *    and whether the pair shares a minute (the duplicate-delivery signature)
 *    or the earlier run simply outlived the next scheduled one.
 *
 * 2. Whether a counted enrichment left a row: for each run, the number of
 *    `article_evidence` rows finished inside its window is compared with its
 *    own `processed` (enriched) count. Rows are keyed by article, finished
 *    exactly once per run that concludes an article, and no non-overlapping run
 *    can overwrite another's finished row (a finished row removes its article
 *    from every later selection), so `rows in window < processed` is a genuine
 *    lost finish: the tick counted work whose row is not there.
 *
 * 3. Stale claims: `pending` rows older than the tick that follows them. The
 *    next run reclaims what it can see, so an old pending row is a claim no
 *    later run reclaimed — the residue of a run that died mid-article, or of a
 *    reclaim race.
 *
 * What it cannot answer, and says so rather than inferring it: whether the
 * *same* article was fetched twice. Nothing records a page fetch, and
 * `article_evidence` is keyed by article, so duplicate fetches collapse into one
 * row. The code-level consequences are printed as prose beside the numbers, not
 * measured: a re-fetched article ends with the newer run's outcome (one row, one
 * terminal state — wasted work, not corruption), while a lost failure-counter
 * increment is possible because `recordSourceOutcome` reads the count it then
 * writes.
 *
 * SELECT only, service-role client. Node 22 or later.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/audit44-enrich-overlap.ts [--out file.json] [--limit N]
 */

import { writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

/** Rows per request. Half the server's 1000-row cap, so a lowered cap still pages. */
const PAGE = 500;
/** Runs read before the walk stops; 3000 is about twenty days at six ticks an hour. */
const DEFAULT_RUN_LIMIT = 3000;
/** A pending claim older than this has outlived the ticks that should reclaim it. */
const STALE_CLAIM_MINUTES = 30;

type RunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  considered: number | null;
  processed: number | null;
  skipped: number | null;
  failed: number | null;
};

type EvidenceRow = {
  article_id: string;
  status: string;
  created_at: string;
  extracted_at: string | null;
};

type OverlapPair = {
  earlier: RunRow;
  later: RunRow;
  startGapSeconds: number;
  overlapSeconds: number;
  /** Same started minute: the duplicate-delivery signature, not a long run. */
  sameMinute: boolean;
  earlierRowsInWindow: number;
  laterRowsInWindow: number;
};

main(async () => {
  const args = process.argv.slice(2);
  const argOf = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = argOf("--out");
  const runLimit = Number(argOf("--limit") ?? DEFAULT_RUN_LIMIT);
  const client = db();

  heading("Audit 44 — concurrent enrich invocations: frequency and cost");

  // ---------------------------------------------------------------------------
  // 1. The runs
  // ---------------------------------------------------------------------------
  const runs: RunRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("pipeline_runs")
      .select("id, started_at, finished_at, status, considered, processed, skipped, failed")
      .eq("stage", "enrich")
      .order("started_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`pipeline_runs: ${error.message}`);
    const page = (data ?? []) as RunRow[];
    runs.push(...page);
    if (page.length < PAGE || runs.length >= runLimit) break;
  }
  const chronological = [...runs]
    .slice(0, runLimit)
    .reverse()
    .filter((run) => run.finished_at !== null)
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  const first = chronological[0];
  const last = chronological[chronological.length - 1];
  say(rowLine("enrich runs read", chronological.length));
  if (first && last) {
    say(
      rowLine(
        "window covered",
        `${first.started_at.slice(0, 16)}Z .. ${last.started_at.slice(0, 16)}Z`,
      ),
    );
    const hours = (Date.parse(last.started_at) - Date.parse(first.started_at)) / 3_600_000;
    say(rowLine("hours covered", hours.toFixed(1)));
    say(
      rowLine(
        "runs per hour (whole window)",
        (chronological.length / Math.max(hours, 1)).toFixed(2),
      ),
    );
    // The cadence changed inside the window (the five extra enrichment slots),
    // so the whole-window average understates today's rate; the last day is what
    // a reader of this instrument should hold in mind.
    const dayAgo = Date.now() - 24 * 3_600_000;
    const recent = chronological.filter((run) => Date.parse(run.started_at) >= dayAgo);
    say(rowLine("runs per hour (last 24h)", (recent.length / 24).toFixed(2)));
  }

  // ---------------------------------------------------------------------------
  // 2. Overlaps
  // ---------------------------------------------------------------------------
  const pairs: OverlapPair[] = [];
  for (let i = 1; i < chronological.length; i += 1) {
    const earlier = chronological[i - 1];
    const later = chronological[i];
    if (!earlier?.finished_at || !later?.finished_at) continue;
    const startsAfterEnd = Date.parse(later.started_at) >= Date.parse(earlier.finished_at);
    if (startsAfterEnd) continue;
    pairs.push({
      earlier,
      later,
      startGapSeconds: (Date.parse(later.started_at) - Date.parse(earlier.started_at)) / 1000,
      overlapSeconds: (Date.parse(earlier.finished_at) - Date.parse(later.started_at)) / 1000,
      sameMinute: earlier.started_at.slice(0, 16) === later.started_at.slice(0, 16),
      earlierRowsInWindow: 0,
      laterRowsInWindow: 0,
    });
  }
  const overlappedIds = new Set<string>();
  for (const pair of pairs) {
    overlappedIds.add(pair.earlier.id);
    overlappedIds.add(pair.later.id);
  }
  heading("Overlap frequency");
  say(rowLine("overlapping consecutive pairs", pairs.length));
  say(
    rowLine(
      "pairs per hundred runs",
      ((pairs.length / Math.max(chronological.length, 1)) * 100).toFixed(2),
    ),
  );
  say(rowLine("runs touching an overlap", `${overlappedIds.size} of ${chronological.length}`));
  say(rowLine("same-minute pairs (duplicate delivery)", pairs.filter((p) => p.sameMinute).length));
  say(
    rowLine(
      "cross-minute pairs (run outlived the next)",
      pairs.filter((p) => !p.sameMinute).length,
    ),
  );
  if (pairs.length > 0) {
    const overlaps = pairs.map((p) => p.overlapSeconds).sort((a, b) => a - b);
    const median = overlaps[Math.floor(overlaps.length / 2)] ?? 0;
    say(rowLine("overlap seconds — median", median.toFixed(1)));
    say(rowLine("overlap seconds — longest", (overlaps[overlaps.length - 1] ?? 0).toFixed(1)));
    say();
    say("  every overlapping pair (oldest first)");
    for (const pair of pairs) {
      say(
        `    ${pair.earlier.started_at.slice(5, 23)}Z -> ${(pair.earlier.finished_at ?? "").slice(11, 23)}Z  ` +
          `next +${pair.startGapSeconds.toFixed(1)}s  overlap ${pair.overlapSeconds.toFixed(1)}s${pair.sameMinute ? "  same-minute" : ""}`,
      );
      say(
        `      earlier c=${String(pair.earlier.considered)} p=${String(pair.earlier.processed)} s=${String(pair.earlier.skipped)} f=${String(pair.earlier.failed)}   ` +
          `later c=${String(pair.later.considered)} p=${String(pair.later.processed)} s=${String(pair.later.skipped)} f=${String(pair.later.failed)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Did every counted enrichment leave a row?
  // ---------------------------------------------------------------------------
  // Rows are read once for the whole covered window and attributed by timestamp,
  // because one query per run would be a query per tick for a number the window
  // already contains. `extracted_at` is written by the run that concludes the
  // article, so a row's timestamp sits inside that run's window.
  const windowStart = first?.started_at ?? new Date().toISOString();
  const evidence: EvidenceRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, status, created_at, extracted_at")
      .gte("extracted_at", windowStart)
      .order("extracted_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`article_evidence: ${error.message}`);
    const page = (data ?? []) as EvidenceRow[];
    evidence.push(...page);
    if (page.length < PAGE) break;
  }
  const finishedRows = evidence.filter((row) => row.extracted_at !== null);
  const countRowsIn = (startMs: number, endMs: number): number => {
    let count = 0;
    for (const row of finishedRows) {
      const at = Date.parse(row.extracted_at ?? "");
      if (at >= startMs && at <= endMs) count += 1;
    }
    return count;
  };
  for (const pair of pairs) {
    pair.earlierRowsInWindow = countRowsIn(
      Date.parse(pair.earlier.started_at),
      Date.parse(pair.earlier.finished_at ?? pair.earlier.started_at),
    );
    pair.laterRowsInWindow = countRowsIn(
      Date.parse(pair.later.started_at),
      Date.parse(pair.later.finished_at ?? pair.later.started_at),
    );
  }
  const shortfalls: { run: RunRow; rows: number; overlapped: boolean }[] = [];
  for (const run of chronological) {
    const rows = countRowsIn(
      Date.parse(run.started_at),
      Date.parse(run.finished_at ?? run.started_at),
    );
    if (rows < (run.processed ?? 0)) {
      shortfalls.push({ run, rows, overlapped: overlappedIds.has(run.id) });
    }
  }
  const sumProcessed = chronological.reduce((n, run) => n + (run.processed ?? 0), 0);
  // Only `enriched` rows are comparable with `processed`: a blocked or
  // unavailable conclusion writes a row too and is not counted as processed.
  const enrichedRows = finishedRows.filter((row) => row.status === "enriched").length;
  heading("Counted enrichments that left no row in their own window");
  say(rowLine("all finished rows in the window", finishedRows.length));
  say(rowLine("enriched rows in the window", enrichedRows));
  say(rowLine("sum of processed over the runs", sumProcessed));
  // A surplus (enriched rows > sum) cannot come from this stage's recorded runs:
  // every run's own rows sit inside its own window, so a surplus counts work done
  // by an invocation that never left a run row at all — the silent paths are the
  // killed invocation (nothing runs its catch) and an unchecked insert that
  // `recordScheduled` does not read the result of.
  say(
    `  ${enrichedRows >= sumProcessed ? "orphan enrichments (writer left no run row)" : "counted enrichments with no row (lost work)"}: ${Math.abs(enrichedRows - sumProcessed)}`,
  );
  say(rowLine("runs whose rows < processed", shortfalls.length));
  for (const shortfall of shortfalls) {
    say(
      `  ${shortfall.run.started_at.slice(5, 23)}Z  processed=${String(shortfall.run.processed)} rows=${shortfall.rows}${shortfall.overlapped ? "  OVERLAPPED" : ""}`,
    );
  }
  if (shortfalls.length === 0) {
    say("  none: every enrichment a tick counted has a finished row stamped inside that tick");
  }
  say(
    `  note: a row count above \`processed\` is expected for overlapped windows — a later run's rows land inside the earlier window too`,
  );

  // ---------------------------------------------------------------------------
  // 4. Claims nobody reclaimed
  // ---------------------------------------------------------------------------
  const pending: EvidenceRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("article_evidence")
      .select("article_id, status, created_at, extracted_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`pending claims: ${error.message}`);
    const page = (data ?? []) as EvidenceRow[];
    pending.push(...page);
    if (page.length < PAGE) break;
  }
  const staleCutoff = Date.now() - STALE_CLAIM_MINUTES * 60_000;
  const stale = pending.filter((row) => Date.parse(row.created_at) < staleCutoff);
  heading("Pending claims");
  say(rowLine("pending rows now", pending.length));
  say(rowLine(`older than ${STALE_CLAIM_MINUTES} minutes`, stale.length));
  for (const row of stale.slice(0, 10)) {
    const ageHours = (Date.now() - Date.parse(row.created_at)) / 3_600_000;
    say(
      `  ${row.article_id}  claimed ${row.created_at.slice(5, 23)}Z  age ${ageHours.toFixed(1)}h`,
    );
  }

  heading("What the numbers can and cannot say");
  say(
    "  measured: overlap frequency and shape; whether a counted enrichment left a row; stale claims.",
  );
  say(
    "  not measurable from these rows: a second fetch of the same article — nothing records a fetch,",
  );
  say(
    "  and `article_evidence` is keyed by article, so a re-fetch and a first fetch collapse into one row.",
  );
  say(
    "  code-level consequence, printed as prose rather than inferred from data: a re-fetched article ends",
  );
  say(
    "  with the newer run's outcome — one row, one terminal state, wasted work. `recordSourceOutcome`",
  );
  say(
    "  reads the failure count it then writes, so two overlapping failures on one source can lose an",
  );
  say("  increment; the five-failure latch would arrive later than the evidence alone implies.");

  if (out) {
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          takenAt: new Date().toISOString(),
          runsRead: chronological.length,
          runsPerHour:
            first && last
              ? chronological.length /
                Math.max(
                  (Date.parse(last.started_at) - Date.parse(first.started_at)) / 3_600_000,
                  1,
                )
              : null,
          pairs: pairs.map((pair) => ({
            earlierStartedAt: pair.earlier.started_at,
            earlierFinishedAt: pair.earlier.finished_at,
            laterStartedAt: pair.later.started_at,
            laterFinishedAt: pair.later.finished_at,
            startGapSeconds: pair.startGapSeconds,
            overlapSeconds: pair.overlapSeconds,
            sameMinute: pair.sameMinute,
            earlier: {
              considered: pair.earlier.considered,
              processed: pair.earlier.processed,
              skipped: pair.earlier.skipped,
              failed: pair.earlier.failed,
              rowsInWindow: pair.earlierRowsInWindow,
            },
            later: {
              considered: pair.later.considered,
              processed: pair.later.processed,
              skipped: pair.later.skipped,
              failed: pair.later.failed,
              rowsInWindow: pair.laterRowsInWindow,
            },
          })),
          enrichedRowsInWindow: enrichedRows,
          sumProcessed,
          shortfalls: shortfalls.map((shortfall) => ({
            startedAt: shortfall.run.started_at,
            processed: shortfall.run.processed,
            rowsInWindow: shortfall.rows,
            overlapped: shortfall.overlapped,
          })),
          pendingClaims: pending.length,
          staleClaims: stale.length,
        },
        null,
        1,
      )}\n`,
    );
    say();
    say(`written to ${out}`);
  }
});
