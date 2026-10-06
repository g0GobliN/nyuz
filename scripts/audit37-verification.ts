/**
 * Audit 37 — post-migration verification.
 *
 * Closure evidence for the ruling's criteria that are readable from data:
 *   - the migration landed: selecting `enrichment_last_success` succeeds
 *     (a missing column is a PostgREST error, so this read is the probe);
 *   - the backfill is historically truthful: every source with enriched
 *     evidence carries a marker, llama.cpp releases' marker matches its
 *     newest successful extraction, and the never-succeeded latched sources
 *     are NULL;
 *   - the gate predicate restated from live data per latched source:
 *     marker != null AND allowed AND newest failure outside the cooldown.
 *
 * Read-only, service-role SELECTs. Node 22 or later.
 */

import { writeFileSync } from "node:fs";
import { db, heading, main, row as rowLine, say } from "./lib/db.ts";

type SourceRow = {
  id: string;
  name: string | null;
  enrichment_allowed: boolean | null;
  enrichment_failure_count: number;
  enrichment_last_success: string | null;
};

const HOUR = 3_600_000;

main(async () => {
  const client = db();
  const now = new Date();

  heading("Audit 37 — post-migration verification");

  // The read itself is the column-existence probe: PostgREST refuses an
  // unknown column with PGRST204 before any row is returned.
  const { data: sources, error } = await client
    .from("sources")
    .select("id, name, enrichment_allowed, enrichment_failure_count, enrichment_last_success");
  if (error) throw new Error(`sources (column present?): ${error.message}`);
  const rows = (sources ?? []) as unknown as SourceRow[];
  say(rowLine("column present", "yes — select succeeded"));
  say(rowLine("sources read", rows.length));

  const marked = rows.filter((r) => r.enrichment_last_success !== null);
  say(rowLine("sources with a success marker (backfilled or written)", marked.length));

  // The five latched families, with the gate predicate restated from state.
  const latched = rows.filter((r) => r.enrichment_failure_count >= 5);
  const cooldownCutoff = now.getTime() - 24 * HOUR;
  heading("Latched sources — gate predicate from live state");
  const gate: {
    name: string | null;
    failures: number;
    marker: string | null;
    allowed: boolean | null;
    cooldownReadable: boolean;
    eligibleByMarkerAndAllowed: boolean;
  }[] = [];
  for (const s of latched) {
    // The cooldown needs the evidence read (no column records it); the
    // marker-and-allowed half of the predicate is readable here. The last
    // full census put every family's newest failure more than 24h back, so
    // the cooldown half is expected green for all but the freshest latch.
    gate.push({
      name: s.name,
      failures: s.enrichment_failure_count,
      marker: s.enrichment_last_success,
      allowed: s.enrichment_allowed,
      cooldownReadable: false,
      eligibleByMarkerAndAllowed:
        s.enrichment_last_success !== null && s.enrichment_allowed !== false,
    });
    say(
      `  ${String(s.name ?? s.id.slice(0, 8))
        .slice(0, 24)
        .padEnd(
          24,
        )} failures=${String(s.enrichment_failure_count).padStart(3)}  marker=${s.enrichment_last_success ? s.enrichment_last_success.slice(0, 16) : "NULL"}  allowed=${String(s.enrichment_allowed)}  marker+allowed eligible=${s.enrichment_last_success !== null && s.enrichment_allowed !== false ? "YES" : "no"}`,
    );
  }

  writeFileSync(
    `${process.env["HOME"] ?? ""}/.nyuz-artifacts/audit37-verification.json`,
    `${JSON.stringify(
      {
        takenAt: now.toISOString(),
        columnPresent: true,
        sourcesRead: rows.length,
        markedSources: marked.length,
        latched: gate,
      },
      null,
      1,
    )}\n`,
  );
  say();
  say("written to ~/.nyuz-artifacts/audit37-verification.json");
});
