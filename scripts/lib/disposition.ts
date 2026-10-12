/**
 * How one delivery leg, and then one digest, is attributed.
 *
 * The 2026-10-12 ruling requires every discarded item to be attributed as
 * correctly refused under policy, lost through execution failure, lost through a
 * scheduling or expiry defect, or another attributable reason — never merged
 * into one count. These two functions are the whole of that judgement, kept out
 * of the audit script so the strings the live database actually writes (the
 * Resend 401 body, the missing-secret message, the schema-cache error) can be
 * pinned in a test rather than only observed once on a laptop.
 *
 * The first draft classified per digest with one regex per class, and filed the
 * two mixed-cause digests under "other": a leg that failed on a Resend 401 and a
 * leg that failed on a missing table are both execution failures, and a digest
 * whose legs failed for *different* execution reasons is still lost through
 * execution failure. The per-leg cause decides; the digest takes the most
 * severe cause any of its legs has.
 */

/** Why one delivery leg ended the way it did. */
export type LegCause =
  /** The product refused by rule: an expired allowance, a plan without the channel. */
  | "policy refusal"
  /** The reader has no endpoint on this channel — nothing to deliver to. */
  | "no reader endpoint"
  /** The machinery failed: a missing secret, a rejected key, a missing table. */
  | "execution failure"
  /** A reason this ruler does not recognise. Named so it is visible, not guessed. */
  | "unattributed";

/** The disposition of one discarded digest, worded in the ruling's classes. */
export type Disposition =
  | "delivered, then mislabelled by expiry"
  | "lost through the expiry defect"
  | "correctly refused under policy"
  | "lost through execution failure"
  | "other attributable reason";

/**
 * One leg's cause. Order matters: a policy refusal is recorded as such even if
 * its message could also read as an error, and "no push subscription" is a
 * reader-state fact, not a failure of the machinery.
 */
export function legCause(error: string): LegCause {
  if (/allowance changed or expired|not included in the current plan/i.test(error)) {
    return "policy refusal";
  }
  if (/no push subscription/i.test(error)) return "no reader endpoint";
  if (
    /secret|401|403|429|5\d\d|fetch|network|timeout|schema cache|could not find the table/i.test(
      error,
    )
  ) {
    return "execution failure";
  }
  return "unattributed";
}

/**
 * The digest's disposition, from its legs and nothing else.
 *
 * A leg that was accepted proves the reader received the briefing, whatever the
 * expiry later said — so that disposition comes first. Without an accepted leg,
 * the most severe cause among the legs decides: any execution failure means the
 * machinery lost the items; refusals and reader-state facts alone mean the
 * product was right not to send; no legs at all means the expiry defect
 * disposed of work that was never attempted.
 */
export function digestDisposition(
  legs: ReadonlyArray<{ status: string; last_error: string | null }>,
): Disposition {
  if (legs.some((leg) => leg.status === "sent")) return "delivered, then mislabelled by expiry";
  if (legs.length === 0) return "lost through the expiry defect";
  const causes = legs.map((leg) => legCause(leg.last_error ?? ""));
  if (causes.some((cause) => cause === "execution failure" || cause === "unattributed")) {
    return causes.some((cause) => cause === "unattributed")
      ? "other attributable reason"
      : "lost through execution failure";
  }
  if (causes.every((cause) => cause === "policy refusal" || cause === "no reader endpoint")) {
    return "correctly refused under policy";
  }
  return "other attributable reason";
}
