/**
 * Prints the strings `normalizeRelativeTime` writes for a small set of inputs
 * at the publish moment around which the timezone difference shows up. Used by
 * the timezone-determinism test in `reader-prose-rules.test.ts`, which runs
 * the same script under `TZ=UTC` and `TZ=America/New_York` (and a few others)
 * and asserts the outputs are identical.
 *
 * `at` is 2026-10-21T01:00:00Z: in `America/New_York` (UTC-4 in October) that is
 * 2026-10-20T21:00 local, so a host using local-time getters would write
 * `20 October 2026` rather than `21 October 2026`. This is the failure the
 * shipped briefing `3fcbb21c` exposed on a laptop with `TZ=America/New_York`.
 */
import process from "node:process";
import { normalizeRelativeTime } from "../src/lib/reader-evidence";

const at = new Date("2026-10-21T01:00:00Z");

const cases: { name: string; text: string }[] = [
  { name: "yesterday", text: "Yesterday the plant closed." },
  { name: "today", text: "Today the plant reopens." },
  { name: "tomorrow", text: "Tomorrow the plant closes." },
  { name: "thisMonth", text: "The pattern turned up this month." },
  { name: "lastMonth", text: "Sales fell last month." },
  { name: "nextYear", text: "First quarter of next year." },
  { name: "yearShiftedByFeb", text: "The campaign closed last year." },
];

const zone = process.env["TZ"] ?? "host-default";
const out: Record<string, string | null> = {};
for (const c of cases) {
  const result = normalizeRelativeTime(c.text, at);
  out[c.name] = result?.text ?? null;
}
console.log(JSON.stringify({ zone, at: at.toISOString(), ...out }));
