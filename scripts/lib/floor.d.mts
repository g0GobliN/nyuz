/**
 * Types for `scripts/lib/floor.mjs`.
 *
 * The module is plain JavaScript because `scripts/coverage-ratchet.mjs` runs
 * under bare node (`npm run coverage:ratchet`), where a `.ts` import would need
 * the esbuild launcher the other scripts use. Declaring its shape here lets the
 * test that pins the rule import it without a cast.
 */

/** Percentage points kept under the measurement when a floor is recorded. */
export declare const RECORD_HEADROOM: number;

/**
 * The floor to record for one metric: the measurement minus the headroom, or
 * the floor already committed when that is higher.
 */
export declare function floorUnder(measured: number, previous?: number | null): number;
