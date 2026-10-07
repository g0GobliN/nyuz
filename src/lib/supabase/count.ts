/**
 * Counting through PostgREST without ever guessing.
 *
 * An exact count asked with the `HEAD` method is how almost every count in
 * this codebase used to be requested, and it has a failure mode that is worse
 * than an error: a *missing relation* comes back as a success. `postgrest-js`
 * cannot read the body of a `HEAD` response, so PostgREST's 404 arrives as
 * `body === ""`, and the library's error branch rewrites exactly that shape
 * as `{ status: 204, count: null, error: null }`. Measured against the live
 * project on 2026-10-07:
 *
 *   ops_status            status 200  count 16    error null
 *   sources, no rows      status 200  count 0     error null
 *   missing relation      status 204  count null  error null   <- reads as "0"
 *   missing column        status 400  count null  error ""     <- message lost
 *
 * So the old idiom `const { count } = await query; return count ?? 0` reported
 * a table that does not exist as an empty one, everywhere it appeared. That is
 * not a theoretical concern here: `active_custom_sources` was missing from the
 * live project, nothing read it from TypeScript, and the checks that were
 * supposed to notice were asking this way.
 *
 * `countOrThrow` is the seam. A successful count query always answers 200 with
 * the total in Content-Range, so `count === null` with no error means the read
 * did not really succeed and there is nothing honest to return. A relation that
 * exists and holds no rows still counts 0, which is a real answer.
 *
 * This is deliberately *not* used for existence probes. "Does this relation
 * exist" and "how many rows does it hold" are different questions, and zero is
 * a legitimate answer to the second; `scripts/verify-live.ts` asks the first
 * with a real read so the server's own message survives.
 */

/** The slice of a PostgREST response a counted read produces. */
export type CountProbe = {
  count: number | null;
  error: { message: string } | null;
};

/** Raised when a count cannot be read, so callers can tell it from a real zero. */
export class CountUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CountUnreadableError";
  }
}

/** Explains the null-on-success case wherever it is thrown. */
const UNREADABLE =
  "the server returned no count. A relation that does not exist answers an " +
  "exact `HEAD` count as an empty success (status 204, error null), so this " +
  "is not a zero";

/** The count, or a thrown error. Never a substituted zero. */
export function countOrThrow(label: string, probe: CountProbe): number {
  if (probe.error) throw new CountUnreadableError(`count(${label}): ${probe.error.message}`);
  if (probe.count === null) throw new CountUnreadableError(`count(${label}): ${UNREADABLE}`);
  return probe.count;
}

/** `countOrThrow` for a query that has not been awaited yet. */
export async function readCount(label: string, query: PromiseLike<CountProbe>): Promise<number> {
  return countOrThrow(label, await query);
}

/**
 * The count, or zero when it cannot be read.
 *
 * This exists for the one place where zero is already the written-down safe
 * answer and failing would be worse than being wrong in the safe direction:
 * the daily custom-subject allowance in `preferences.ts`, whose neighbour a
 * few lines up already decides that "a brake that cannot be read must not be
 * treated as zero room". Spelling it as a named function rather than writing
 * `?? 0` keeps that a decision instead of a habit, and keeps the invariant
 * test below able to see the difference.
 *
 * Everywhere else a substituted zero is a lie, so use `countOrThrow`.
 */
export function countOrZero(label: string, probe: CountProbe): number {
  if (probe.error || probe.count === null) {
    console.warn(`count(${label}): ${probe.error?.message ?? UNREADABLE} — reading this as zero`);
    return 0;
  }
  return probe.count;
}
