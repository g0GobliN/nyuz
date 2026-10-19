/**
 * Starts, stops, or reports ruling #12c's bounded source-reactivation experiment.
 *
 *   npm run experiment:sources              # status: granted, running, and the gate's answer
 *   npm run experiment:sources -- --on      # start the 30-day clock
 *   npm run experiment:sources -- --off     # stop it; every row stays granted but off
 *
 * ---------------------------------------------------------------------------
 * Why this exists rather than a SQL snippet in the decision log
 * ---------------------------------------------------------------------------
 *
 * The ruling is a *bounded* experiment, and a bound nobody can read is a bound nobody can trust.
 * Migration 0120 makes the window a database constraint; this command is the one way to start it, so
 * the clock's start is a recorded write and its state is legible from a terminal without opening the
 * SQL editor. `--off` is the same command in reverse: the eight stay exempted in the table, with the
 * reason they were granted, and the gate stops honouring them.
 *
 * The last block is the point of the whole thing: after the write it prints `sources_to_collect`'s own
 * answer for each source -- the same function ingest calls before it fetches anything. An experiment
 * that says "running" in a table while the gate still withholds the feeds has not started, and this
 * is where that would show.
 *
 * It writes one table and reads two. It never flips `demand_driven_sources` (the ruling forbids it)
 * and never touches a reader-facing row.
 */

import type { SourceExemption } from "@/lib/supabase/types";
import { db, fail, heading, main, say } from "./lib/db";

const EXPERIMENT = "12c-30d";
const DAYS = 30;

/** How many days from now the window closes. One place, so `--on` and the doc cannot disagree. */
const WINDOW_MS = DAYS * 24 * 60 * 60 * 1000;

type GateRow = { source_id: string; eligible: boolean; reason: string };

const mode = process.argv.includes("--on")
  ? "on"
  : process.argv.includes("--off")
    ? "off"
    : "status";

async function run(): Promise<void> {
  const client = db();

  const { data: exemptionRows, error: exemptionError } = await client
    .from("source_exemptions")
    .select("source_id, experiment, reason, enabled, starts_at, ends_at, created_at")
    .eq("experiment", EXPERIMENT)
    .order("source_id");
  if (exemptionError) {
    fail(
      `reading source_exemptions: ${exemptionError.message}\n` +
        "Migration 0120 is not applied on this database (or not seeded). Apply it first.",
    );
  }
  const granted = (exemptionRows ?? []) as SourceExemption[];
  if (granted.length === 0) {
    fail(`no ${EXPERIMENT} rows: migration 0120 is applied but seeded nothing. Nothing to start.`);
  }

  // The gate is off before the flag is on, so the exemption would be inert and the experiment would
  // appear to run while no feed moved. The ruling says do not flip the flag, so this refuses instead.
  const { data: flag } = await client
    .from("feature_flags")
    .select("enabled")
    .eq("key", "demand_driven_sources")
    .maybeSingle();
  const gateOn = flag?.enabled === true;

  const now = new Date();
  if (mode === "on") {
    if (!gateOn) {
      fail(
        "demand_driven_sources is off, so the demand gate is not applied at all and an exemption " +
          "changes nothing. Ruling #12c forbids flipping it globally; resolve that before starting.",
      );
    }
    const { error: writeError, data: written } = await client
      .from("source_exemptions")
      .update({
        enabled: true,
        starts_at: now.toISOString(),
        ends_at: new Date(now.getTime() + WINDOW_MS).toISOString(),
      })
      .eq("experiment", EXPERIMENT)
      .select("source_id");
    if (writeError) fail(`starting the experiment: ${writeError.message}`);
    if ((written ?? []).length !== granted.length) {
      fail(
        `started ${(written ?? []).length} of ${granted.length} rows — refusing to report success`,
      );
    }
  } else if (mode === "off") {
    const { error: writeError } = await client
      .from("source_exemptions")
      .update({ enabled: false, starts_at: null, ends_at: null })
      .eq("experiment", EXPERIMENT);
    if (writeError) fail(`stopping the experiment: ${writeError.message}`);
  }

  // Re-read rather than echo what was written: the row is the truth, and a trigger or a constraint
  // that quietly changed it would otherwise be invisible here.
  const { data: after, error: afterError } = await client
    .from("source_exemptions")
    .select("source_id, experiment, reason, enabled, starts_at, ends_at, created_at")
    .eq("experiment", EXPERIMENT)
    .order("source_id");
  if (afterError) fail(`re-reading source_exemptions: ${afterError.message}`);
  const rows = (after ?? []) as SourceExemption[];

  const { data: gate, error: gateError } = await client.rpc("sources_to_collect", {
    p_grace_hours: 72,
  });
  if (gateError) fail(`sources_to_collect: ${gateError.message}`);
  const verdictOf = new Map(
    ((gate ?? []) as GateRow[]).map((row) => [row.source_id, row] as const),
  );

  const { data: sources, error: sourceError } = await client
    .from("sources")
    .select("id, name, last_fetched_at")
    .in(
      "id",
      rows.map((row) => row.source_id),
    );
  if (sourceError) fail(`sources: ${sourceError.message}`);
  const sourceOf = new Map((sources ?? []).map((row) => [row.id, row] as const));

  heading(
    mode === "status"
      ? `Ruling #12c — ${EXPERIMENT}, as the gate answers it`
      : `Ruling #12c — ${EXPERIMENT}, ${mode === "on" ? "started" : "stopped"}`,
  );
  const running = rows.filter((row) => verdictOf.get(row.source_id)?.reason.startsWith("exempt"));
  say(`demand_driven_sources flag      ${gateOn ? "on" : "OFF (exemptions are inert)"}`);
  say(`granted rows                    ${rows.length}`);
  say(`honoured by the gate now        ${running.length}`);
  say();
  for (const row of rows) {
    const name = sourceOf.get(row.source_id)?.name ?? row.source_id;
    const window =
      row.starts_at && row.ends_at
        ? `${row.starts_at.slice(0, 16)} -> ${row.ends_at.slice(0, 16)}`
        : "not started";
    const lastFetched = sourceOf.get(row.source_id)?.last_fetched_at ?? null;
    say(
      `${name.slice(0, 30).padEnd(30)} ` +
        `${(row.enabled ? "on " : "off").padEnd(4)} ${window.padEnd(37)} ` +
        `last fetched ${(lastFetched ?? "never").slice(0, 16).padEnd(17)} ` +
        `${verdictOf.get(row.source_id)?.reason ?? "not in the gate's answer"}`,
    );
  }
  say();
  say(
    running.length === rows.length
      ? "Every granted source is released. `npm run baseline:sources` is the measurement from here."
      : running.length === 0
        ? "No granted source is released: the experiment is present and off, and changes nothing."
        : `WARNING: ${rows.length - running.length} granted rows are not honoured by the gate.`,
  );
}

main(run);
