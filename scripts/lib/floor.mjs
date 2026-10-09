/**
 * How a coverage measurement becomes a floor.
 *
 * `npm run coverage:ratchet -- --update` records what the runner measured, and
 * the runner does not measure one commit identically twice. On 2026-10-09 the
 * same tree came back with 8899 branch ranges in one run and 8897 in the next —
 * `src/lib/pipeline/duplicates.ts` 86 then 85, `src/lib/pipeline/match.ts` 293
 * then 292 — which is 0.02pp on a group and enough to fail a floor recorded
 * exactly from the first run. That is Audit 42's observation one level down: the
 * range set belongs to the execution, not to the source, and that is as true
 * across two runner runs as it is across two machines.
 *
 * So a floor is recorded just *under* what was measured. 0.05pp is two and a
 * half times the widest drift seen between two runner runs of one tree, and a
 * tenth of the smallest real regression — removing a test file or adding an
 * untested module moves a group by half a point — so nothing a reader would
 * call a regression can hide inside it.
 *
 * The clamp is what keeps the ratchet a ratchet: recording can never move a
 * floor down, headroom or not.
 */

/** Percentage points kept under the measurement. See the note above. */
export const RECORD_HEADROOM = 0.05;

/** The summary rounds to two decimals; floors live at the same precision. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * The floor to record for one metric.
 *
 * `previous` is the floor already committed, when there is one. A measurement
 * that lands below it — inside the noise, or genuinely — keeps the old floor
 * rather than recording a smaller one.
 */
export function floorUnder(measured, previous) {
  const candidate = round(measured - RECORD_HEADROOM);
  if (previous === undefined || previous === null) return candidate;
  return Math.max(previous, candidate);
}
