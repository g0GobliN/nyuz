/** Read-only. Actual AI ledger mix, for the launch cost audit. */
import { createAdminClient } from "@/lib/supabase/admin";

const db = createAdminClient(process.env as Record<string, string | undefined>);

const { data, error } = await db
  .from("ai_usage_ledger")
  .select("capability, model, prompt_tokens, completion_tokens, reserved_tokens, created_at")
  .order("created_at", { ascending: false })
  .limit(1000);

if (error) {
  console.error("ledger read failed:", error.message);
  process.exit(1);
}

const rows = (data ?? []).reverse();
console.log(`rows: ${rows.length}`);
if (rows.length === 0) process.exit(0);

console.log(`window: ${rows[0]!.created_at} .. ${rows[rows.length - 1]!.created_at}`);
const unsettled = rows.filter(
  (row) => row.reserved_tokens > 0 && row.prompt_tokens === 0 && row.completion_tokens === 0,
).length;
console.log(`unsettled reservations in window: ${unsettled}`);
const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
const currentUnsettled = rows.filter(
  (row) =>
    Date.parse(row.created_at) >= monthStart &&
    row.reserved_tokens > 0 &&
    row.prompt_tokens === 0 &&
    row.completion_tokens === 0,
);
console.log(
  `current-month unsettled: ${currentUnsettled.length} calls, ${currentUnsettled.reduce((sum, row) => sum + row.reserved_tokens, 0)} reserved tokens`,
);

type Agg = { calls: number; prompt: number; completion: number; settled: number };
const byCap = new Map<string, Agg>();
for (const r of rows) {
  const key = `${r.capability} / ${r.model}`;
  const a = byCap.get(key) ?? { calls: 0, prompt: 0, completion: 0, settled: 0 };
  a.calls++;
  a.prompt += r.prompt_tokens ?? 0;
  a.completion += r.completion_tokens ?? 0;
  if ((r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0) > 0) a.settled++;
  byCap.set(key, a);
}

console.log(
  "\ncapability / model            calls  settled   prompt-tok  compl-tok   out:in  tok/call",
);
for (const [key, a] of [...byCap].sort((x, y) => y[1].calls - x[1].calls)) {
  const per = a.settled > 0 ? (a.prompt + a.completion) / a.settled : 0;
  const ratio = a.prompt > 0 ? (a.completion / a.prompt).toFixed(2) : "n/a";
  console.log(
    key.padEnd(28) +
      String(a.calls).padStart(6) +
      String(a.settled).padStart(9) +
      String(a.prompt).padStart(13) +
      String(a.completion).padStart(11) +
      ratio.padStart(9) +
      per.toFixed(0).padStart(10),
  );
}

// Hourly distribution, to see how much traffic lands in DeepSeek's peak window.
let peak = 0;
for (const r of rows) {
  const d = new Date(r.created_at);
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day !== 0 && day !== 6 && ((h >= 1 && h < 4) || (h >= 6 && h < 10))) peak++;
}
console.log(
  `\ncalls inside DeepSeek peak window: ${peak}/${rows.length} (${((peak / rows.length) * 100).toFixed(1)}%)`,
);
