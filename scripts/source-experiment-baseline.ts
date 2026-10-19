/**
 * The before-and-after baseline ruling #12c requires, in one reproducible run.
 *
 *   npm run baseline:sources
 *
 * Ruling #12c (arbiter, 2026-10-18) authorises a bounded 30-day experiment: exactly eight dormant
 * sources are exempted from the demand gate, the other 18 stay off, and the global
 * `demand_driven_sources` flag is not flipped. Its last instruction before any exemption is switched on
 * is to *record the baseline* — the source configuration, the 152-event multi-publisher count, the
 * ladder distribution, and the withhold preview — "so we have a defensible before-and-after comparison
 * rather than relying on recollection or changing measurements".
 *
 * This command is that record. It is read-only and prints four blocks, each of which the experiment's
 * acceptance conditions are read against:
 *
 *   sources            every source, its kind, and whether the demand gate currently withholds it;
 *   exemptions         every granted exemption, its window, and the gate's own answer for it — the
 *                      experiment's state, read from the same function the pipeline calls;
 *   coverage           complete events, and events with >= 2 publishers (the 152 baseline);
 *   ladder             which rung explains the newest live events, by rung name and by silence;
 *   withhold preview   a pointer to `npm run briefing:withhold-preview`, whose line is the 0-of-13
 *                      number, because duplicating that computation here would let the two disagree.
 *
 * Re-running it after the experiment is the comparison. Nothing is written, no model is called.
 */

import { reasonFor } from "@/lib/pipeline/inclusion";
import type { SourceExemption } from "@/lib/supabase/types";
import { db, heading, main, row as rowLine, say } from "./lib/db";
import { loadCorpusEvents } from "./lib/corpus";

/** Newest events whose ladder answer is measured; the window the briefing draws from. */
const LADDER_WINDOW = 60;

type SourceRow = {
  id: string;
  name: string | null;
  kind: string | null;
  active: boolean | null;
  coverage_mode: string | null;
  last_demand_at: string | null;
  last_fetched_at: string | null;
};

/** One row of `sources_to_collect`: the gate's own verdict, not a date guessed here. */
type GateRow = { source_id: string; eligible: boolean; reason: string };

main(async () => {
  const client = db();

  heading("1. Sources — the gate's own verdict (`sources_to_collect`, 72h grace)");
  const { data: gate, error: gateError } = await client.rpc("sources_to_collect", {
    p_grace_hours: 72,
  });
  if (gateError) throw new Error(`sources_to_collect: ${gateError.message}`);
  const verdicts = (gate ?? []) as GateRow[];
  const { data: sources, error } = await client
    .from("sources")
    .select("id, name, kind, active, coverage_mode, last_demand_at, last_fetched_at")
    .order("name", { ascending: true });
  if (error) throw new Error(`sources: ${error.message}`);
  const byId = new Map(((sources ?? []) as SourceRow[]).map((row) => [row.id, row] as const));
  // The set the experiment has to draw from, as the gate answers it. The 26-source figure in ruling
  // #12 came from the audit's date ("not fetched since 2026-10-06"); this is the rule the ingest stage
  // actually applies, and a later run of the same command is the like-for-like comparison.
  const withheld = verdicts.filter((row) => !row.eligible);
  say(rowLine("sources (active)", verdicts.length));
  say(
    rowLine("  collected: core, or wanted in the grace window", verdicts.length - withheld.length),
  );
  say(rowLine("  WITHHELD by the demand gate", withheld.length));
  for (const row of withheld) {
    const source = byId.get(row.source_id);
    say(
      `    ${(source?.name ?? row.source_id).slice(0, 40).padEnd(40)} ` +
        `${(source?.kind ?? "-").padEnd(9)} ${(source?.coverage_mode ?? "-").padEnd(11)} ${row.reason}`,
    );
  }
  say(rowLine("  withheld ids", withheld.map((row) => row.source_id.slice(0, 8)).join(" ")));

  // The experiment's own state, in the same run as the number it is measured against. Before 0120 is
  // applied this read fails, and that is reported rather than thrown: a baseline has to be takeable on
  // a database that has never heard of the experiment.
  heading("1b. Exemptions — granted, running, and the gate's answer (`source_exemptions`, 0120)");
  const verdictOf = new Map(verdicts.map((row) => [row.source_id, row] as const));
  const { data: exemptions, error: exemptionError } = await client
    .from("source_exemptions")
    .select("source_id, experiment, enabled, starts_at, ends_at");
  if (exemptionError) {
    say(`  not applied on this database (${exemptionError.message.slice(0, 60)})`);
  } else {
    const granted = (exemptions ?? []) as SourceExemption[];
    const active = granted.filter((row) => {
      const verdict = verdictOf.get(row.source_id);
      return verdict?.reason.startsWith("exempt") === true;
    });
    say(rowLine("granted", granted.length));
    say(rowLine("  running now (gate says `exempt:`)", active.length));
    for (const row of granted) {
      const name = byId.get(row.source_id)?.name ?? row.source_id;
      const verdict = verdictOf.get(row.source_id);
      const window =
        row.starts_at && row.ends_at
          ? `${row.starts_at.slice(0, 16)} -> ${row.ends_at.slice(0, 16)}`
          : "not started";
      say(
        `    ${name.slice(0, 34).padEnd(34)} ${row.experiment.padEnd(8)} ` +
          `${(row.enabled ? "on " : "off").padEnd(4)} ${window.padEnd(37)} ` +
          `${verdict?.reason ?? "not in the gate's answer"}`,
      );
    }
  }

  heading("2. Coverage — the multi-publisher baseline");
  const { count: complete, error: completeError } = await client
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("status", "complete");
  if (completeError) throw new Error(`events: ${completeError.message}`);
  const { count: multi, error: multiError } = await client
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("status", "complete")
    .gte("publisher_count", 2);
  if (multiError) throw new Error(`events (multi): ${multiError.message}`);
  say(rowLine("complete events", complete ?? 0));
  say(rowLine("events with >= 2 publishers (the acceptance baseline)", multi ?? 0));

  heading(`3. Ladder — the newest ${LADDER_WINDOW} live events, by rung`);
  const events = await loadCorpusEvents(LADDER_WINDOW);
  const { data: impacts, error: impactError } = await client
    .from("event_impacts")
    .select("event_id, text")
    .in(
      "event_id",
      events.map((event) => event.id),
    )
    .eq("status", "complete");
  if (impactError) throw new Error(`event_impacts: ${impactError.message}`);
  const impactOf = new Map((impacts ?? []).map((row) => [row.event_id, row.text ?? null] as const));

  const byRung: Record<string, number> = {};
  for (const event of events) {
    const evidence = event.sourceList.flatMap(
      (source) => source.enrichedEvidence?.map((unit) => unit.text) ?? [],
    );
    const reason = reasonFor({
      storedImpact: impactOf.get(event.id) ?? null,
      sourceCount: event.sources,
      evidence,
      title: event.title,
      whatHappened: event.what,
    });
    byRung[reason.source] = (byRung[reason.source] ?? 0) + 1;
  }
  for (const [rung, count] of Object.entries(byRung).sort((a, b) => b[1] - a[1])) {
    say(rowLine(`  ${rung}`, count));
  }

  heading("4. The withhold preview — the same rule applied to the delivered briefing");
  say("  npm run briefing:withhold-preview    (its last line is the count this baseline records)");
});
