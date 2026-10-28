/**
 * The Leg A funnel: where a delivered "Why it matters" line dies.
 *
 * Task `t_27cc9ccb` (Significance Leg A) asks the measurement to classify every
 * delivered item into where the line died, in mutually exclusive buckets, and
 * print counts rather than prose:
 *
 *   composed       a rung other than coverage justified a line out of the
 *                  event's own stored facts
 *   no-evidence    nothing is stored for the ladder to quote — zero enriched
 *                  evidence units, no stored impact, no before/after state
 *   no-shape       evidence (or stored fields) is present but nothing in it
 *                  carries a shape the ladder may print (including money with
 *                  nothing saying what it does — the removed figure rungs)
 *   rung-refused   a shape exists in the stored evidence but the ladder's own
 *                  guards refused it (fragment, short clause, prose gates,
 *                  standalone guards, relative clause) or the why-vs-what gate
 *                  blanked it (it restated the paragraph)
 *
 * Two properties are kept separate, because the funnel measures both and
 * conflating them is how the audited edition's "Four publishers reported
 * this." got counted as a significance line:
 *
 *   justified       a story-specific line the ladder produces now
 *   coverageEligible the coverage rung can fire (≥2 publishers)
 *
 * The classification only ever reads what the digest build read — the same
 * fields `reasonFor` takes — plus the delivered row's own line. It never
 * changes what the ladder prints: `reasonFor` is called as-is, and the
 * instruments are the ladder's own split-out steps (`instrumentConsequence`,
 * `instrumentBinding`, `storyNames`, all living beside the rungs they mirror).
 */

import {
  instrumentBinding,
  instrumentConsequence,
  normalizeForCompare,
  reasonFor,
  storyNames,
  type InclusionReason,
} from "./inclusion";

export const LEG_A_STORY_RUNGS = [
  "stored",
  "change",
  "after-state",
  "consequence",
  "binding",
] as const satisfies readonly Exclude<InclusionReason["source"], "coverage" | "none">[];

export type SignificanceStage = "composed" | "no-evidence" | "no-shape" | "rung-refused";

/** The refusals that mean a ruled shape reached a guard and lost. */
const REFUSED_CODES = new Set([
  "fragment",
  "short-clause",
  "too-short-prose",
  "standalone-guards",
  "relative-clause",
  "restates-the-paragraph",
]);
/** Shapes the ruled ladder cannot print at all — present, but not lost. */
const NOT_RULED_CODES = new Set(["figure-only"]);

export type LegAItemInput = {
  storedImpact?: string | null;
  beforeState?: string | null;
  afterState?: string | null;
  evidence?: readonly string[] | undefined;
  sourceCount: number;
  title?: string | null;
  whatHappened?: string | null;
  /** `digest_items.why_it_matters`, what the delivered row actually carried. */
  deliveredLine?: string | null;
};

export type LegAClassification = {
  stage: SignificanceStage;
  /** The rung the ladder produces now, on the same inputs the build read. */
  rung: InclusionReason["source"];
  ladderLine: string;
  /** What the delivered row carried, trimmed. */
  deliveredLine: string;
  deliveredCarried: boolean;
  /**
   * Whether the delivered row equals the line the ladder produces now. Null
   * when nothing was delivered — an empty row agrees with nothing, and the
   * window audit's `storedState` already reads that as `empty`.
   */
  deliveredAgrees: boolean | null;
  /** A story-specific (non-coverage) line is justified by stored facts. */
  justified: boolean;
  /** Enriched evidence units the ladder could read. */
  evidenceUnits: number;
  coverageEligible: boolean;
  storedFields: { impact: boolean; beforeState: boolean; afterState: boolean };
  /** A shape found in the stored evidence and where it died, per rung. */
  candidates: { rung: "consequence" | "binding"; text: string; refusal: string | null }[];
};

const isPresent = (value: string | null | undefined): boolean => (value ?? "").trim() !== "";

export function classifySignificanceItem(input: LegAItemInput): LegAClassification {
  const evidence = (input.evidence ?? [])
    .map((unit) => (unit ?? "").trim())
    .filter((unit) => unit !== "");

  const ladder = reasonFor({
    storedImpact: input.storedImpact ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    sourceCount: input.sourceCount,
    evidence,
    title: input.title ?? null,
    whatHappened: input.whatHappened ?? null,
  });

  const storyRung = ladder.source !== "none" && ladder.source !== "coverage";
  const coverageEligible = input.sourceCount >= 2;
  const storedFields = {
    impact: isPresent(input.storedImpact),
    beforeState: isPresent(input.beforeState),
    afterState: isPresent(input.afterState),
  };

  // The instruments only run where the story-specific slot is open anyway:
  // once a rung above them has produced the line, nothing died further down.
  const candidates: LegAClassification["candidates"] = [];
  if (!storyRung) {
    const consequence = instrumentConsequence({
      evidence,
      whatHappened: input.whatHappened ?? null,
    });
    if (consequence !== null)
      candidates.push({
        rung: "consequence",
        text: consequence.text,
        refusal: consequence.refusal,
      });
    const binding = instrumentBinding({
      evidence,
      names: storyNames({
        storedImpact: input.storedImpact ?? null,
        beforeState: input.beforeState ?? null,
        afterState: input.afterState ?? null,
        sourceCount: input.sourceCount,
        evidence,
        title: input.title ?? null,
        whatHappened: input.whatHappened ?? null,
      }),
      whatHappened: input.whatHappened ?? null,
    });
    if (binding !== null)
      candidates.push({ rung: "binding", text: binding.text, refusal: binding.refusal });
  }

  const refusals = candidates
    .map((candidate) => candidate.refusal)
    .filter((refusal): refusal is string => refusal !== null);
  const ruledRefusals = refusals.filter((refusal) => !NOT_RULED_CODES.has(refusal));
  const guarded = ruledRefusals.some((refusal) => REFUSED_CODES.has(refusal));

  let stage: SignificanceStage;
  if (storyRung) {
    stage = "composed";
  } else if (
    evidence.length === 0 &&
    !storedFields.impact &&
    !storedFields.beforeState &&
    !storedFields.afterState
  ) {
    // Nothing stored anywhere: the line died at the input, before any rung ran.
    stage = "no-evidence";
  } else if (guarded) {
    stage = "rung-refused";
  } else {
    // Stored material exists but no ruled shape lives in it — or only shapes
    // the ladder was ruled (ruling #10) not to print.
    stage = "no-shape";
  }

  const deliveredLine = (input.deliveredLine ?? "").trim();
  const ladderLine = ladder.text.trim();

  return {
    stage,
    rung: ladder.source,
    ladderLine,
    deliveredLine,
    deliveredCarried: deliveredLine !== "",
    deliveredAgrees: deliveredLine === "" ? null : deliveredLine === ladderLine,
    justified: stage === "composed",
    evidenceUnits: evidence.length,
    coverageEligible,
    storedFields,
    candidates,
  };
}

/**
 * Why-vs-what equivalence, re-exported for the audit script so the delivered
 * comparison and the classification gate read the same normalizer.
 */
export { normalizeForCompare };
