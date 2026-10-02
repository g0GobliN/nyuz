/**
 * Re-finalize the events a recent briefing window drew from.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/refresh-latest-brief.ts --hours 48
 *   node --env-file=.env scripts/tsrun.mjs scripts/refresh-latest-brief.ts --hours 48 --apply
 *
 * Finalization only ever revisits events whose row is `metadata_dirty` or still
 * pending, so a change to the deterministic scoring, the summary shaping or the
 * readiness signals reaches new events but leaves the ones already analysed
 * holding yesterday's numbers. This marks every event first seen inside the
 * window dirty and runs `analyse` over exactly those ids — pinned, so the
 * queue's live/re-entry lanes cannot drag unrelated rows into the run.
 *
 * Dry run by default. Slices are small because `analyse` reads every covered
 * article per event; a 48h window is a few hundred events and finishes in
 * minutes, where whole-corpus invocations have timed out.
 */

import { analyse } from "../src/lib/pipeline/analyse";
import { db, heading, main, row, say } from "./lib/db.ts";

/** Events per pinned `analyse` call. Kept small enough to see progress. */
const SLICE = 50;

main(async () => {
  const apply = process.argv.includes("--apply");
  const flagIndex = process.argv.indexOf("--hours");
  const hours = Math.max(1, Number(process.argv[flagIndex + 1]) || 48);
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  heading(`Re-finalize events first seen in the last ${hours}h${apply ? "" : " — dry run"}`);

  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("events")
      .select("id, metadata_dirty, status")
      .gte("first_seen_at", since)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { id: string; metadata_dirty: boolean | null; status: string }[];
    ids.push(...batch.map((row) => row.id));
    if (batch.length < 1000) break;
  }
  say(row("  ", `${ids.length} events in window`, 110));
  if (ids.length === 0) return;

  if (!apply) {
    say(row("  ", "dry run — pass --apply to mark and re-finalize", 110));
    return;
  }

  for (let from = 0; from < ids.length; from += 500) {
    const { error } = await db()
      .from("events")
      .update({ metadata_dirty: true })
      .in("id", ids.slice(from, from + 500));
    if (error) throw new Error(`marking dirty: ${error.message}`);
  }
  say(row("  ", `${ids.length} events marked metadata_dirty`, 110));

  const decisions = new Map<string, number>();
  let importance = 0;
  let n = 0;
  for (let from = 0; from < ids.length; from += SLICE) {
    const slice = ids.slice(from, from + SLICE);
    const report = await analyse(db(), { eventIds: slice, limit: SLICE });
    for (const outcome of report.outcomes) {
      decisions.set(outcome.decision, (decisions.get(outcome.decision) ?? 0) + 1);
      if (typeof outcome.importance === "number") importance += outcome.importance;
      if (outcome.decision === "failed") {
        say(row(" FAIL ", `${outcome.eventId.slice(0, 8)} ${outcome.detail.slice(0, 90)}`, 110));
      }
    }
    n += slice.length;
    say(row("  ", `… ${n}/${ids.length} finalized`, 110));
  }

  heading("Decisions");
  for (const [decision, count] of [...decisions.entries()].sort())
    say(row(`  ${decision}`, count, 110));
  say(
    row(
      "  ",
      `mean importance ${(
        importance /
        Math.max(
          1,
          [...decisions.values()].reduce((a, b) => a + b, 0),
        )
      ).toFixed(2)}`,
      110,
    ),
  );
  say();
  say(row("  ", "run `npm run pipeline match` so re-scored events re-match readers", 110));
});
