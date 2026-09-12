/**
 * Read-only. Answers one question: is `feature = 'unknown'` in `ai_usage_ledger`
 * purely historical, or is something still writing unattributed rows?
 *
 * Migration 0053 added the `feature` column and backfilled every pre-existing
 * row to 'unknown' rather than guessing. So an `unknown` bucket whose newest row
 * predates the first labelled call is the backfill and nothing else; an
 * `unknown` row written after it is a live untagged call path and a bug.
 *
 * Writes nothing. Selects only.
 */
import { db, heading, main, say } from "./lib/db";

type Row = {
  feature: string | null;
  created_at: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reserved_tokens: number | null;
  cost_microusd: number | null;
  estimated_cost_microusd: number | null;
  capability: string | null;
  model: string | null;
};

type Agg = {
  calls: number;
  tokens: number;
  microusd: number;
  first: string;
  last: string;
  unsettled: number;
};

/**
 * The cutover is derived, not hardcoded.
 *
 * A calendar date would be a guess about when the migration reached production,
 * and the guess that matters is off by hours: 0053 was committed on 2026-09-04,
 * but the first labelled row lands at 08:10 that morning and unknown rows are
 * still being written at 03:42. Asking the ledger itself when tagging started
 * keeps this script correct after the next deploy too.
 *
 * Rows arrive ordered by `created_at`, so the first labelled one is the earliest.
 */
function taggingLandedAt(rows: Row[]): string | null {
  const labelled = rows.find((r) => r.feature !== null && r.feature !== "unknown");
  return labelled?.created_at ?? null;
}

function tokensOf(r: Row): number {
  return (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
}

/** A reservation that never had real usage written back over it. */
function isUnsettled(r: Row): boolean {
  return tokensOf(r) === 0 && (r.reserved_tokens ?? 0) > 0;
}

function usd(microusd: number): string {
  return `$${(microusd / 1_000_000).toFixed(2)}`;
}

main(async () => {
  const client = db();

  // Paginated: PostgREST caps a single response, and the ledger is the one table
  // that grows with every provider call.
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("ai_usage_ledger")
      .select(
        "feature, created_at, prompt_tokens, completion_tokens, reserved_tokens, cost_microusd, estimated_cost_microusd, capability, model",
      )
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ai_usage_ledger: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  say(`ledger rows: ${rows.length}`);
  if (rows.length === 0) return;
  say(`window: ${rows[0]!.created_at} .. ${rows[rows.length - 1]!.created_at}`);
  const landed = taggingLandedAt(rows);
  say(`first labelled row: ${landed ?? "(none — nothing is tagged)"}`);

  const byFeature = new Map<string, Agg>();
  for (const r of rows) {
    const key = r.feature ?? "(null)";
    const cost = r.cost_microusd ?? r.estimated_cost_microusd ?? 0;
    const a = byFeature.get(key) ?? {
      calls: 0,
      tokens: 0,
      microusd: 0,
      first: r.created_at,
      last: r.created_at,
      unsettled: 0,
    };
    a.calls++;
    a.tokens += tokensOf(r);
    a.microusd += cost;
    if (r.created_at < a.first) a.first = r.created_at;
    if (r.created_at > a.last) a.last = r.created_at;
    if (isUnsettled(r)) a.unsettled++;
    byFeature.set(key, a);
  }

  heading("By feature (all time)");
  say("feature      calls    tokens        cost   unsettled  first                 last");
  for (const [feature, a] of [...byFeature].sort((x, y) => y[1].calls - x[1].calls)) {
    say(
      feature.padEnd(12) +
        String(a.calls).padStart(6) +
        String(a.tokens).padStart(10) +
        usd(a.microusd).padStart(12) +
        String(a.unsettled).padStart(12) +
        "  " +
        a.first.slice(0, 19) +
        "  " +
        a.last.slice(0, 19),
    );
  }

  // Unsettled reservations, by day.
  //
  // A row with a reservation and no reported tokens is a call whose cost was
  // asserted but never confirmed. The ceiling counted the reservation, so this
  // is not spend escaping the cap — but it is spend the ledger cannot put a real
  // number against, which matters for the same reason `feature` does.
  heading("Unsettled reservations by UTC day");
  const byDay = new Map<string, { unsettled: number; total: number }>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    const d = byDay.get(day) ?? { unsettled: 0, total: 0 };
    d.total++;
    if (isUnsettled(r)) d.unsettled++;
    byDay.set(day, d);
  }
  for (const [day, d] of [...byDay].sort()) {
    if (d.unsettled === 0) continue;
    say(`${day}  ${String(d.unsettled).padStart(5)} / ${String(d.total).padStart(5)}`);
  }

  heading("Unattributed verdict");
  const unknown = rows.filter((r) => (r.feature ?? "unknown") === "unknown");
  if (unknown.length === 0) {
    say("No unknown rows at all.");
    return;
  }
  const after = landed === null ? unknown : unknown.filter((r) => r.created_at > landed);
  say(`unknown rows total:              ${unknown.length}`);
  say(`newest unknown row:              ${unknown[unknown.length - 1]!.created_at}`);
  say(`unknown rows after first label:  ${after.length}`);
  if (after.length === 0) {
    say("");
    say("HISTORICAL ONLY. Every unattributed row predates the first labelled call.");
    say("Leave them alone; no live call path is writing unknown.");
  } else {
    say("");
    say("LIVE UNTAGGED PATH. These were written after tagging was in force:");
    const byShape = new Map<string, number>();
    for (const r of after) {
      const key = `${r.capability ?? "?"} / ${r.model ?? "?"}`;
      byShape.set(key, (byShape.get(key) ?? 0) + 1);
    }
    for (const [shape, n] of [...byShape].sort((a, b) => b[1] - a[1])) {
      say(`  ${shape.padEnd(40)} ${n}`);
    }
    say(`  first: ${after[0]!.created_at}`);
    say(`  last:  ${after[after.length - 1]!.created_at}`);
  }
});
