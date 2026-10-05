import { isJunkSubject } from "./subject-input";
import { isAllStopwords } from "./topics";

export const MAX_EXCLUSION_LABEL = 80;
export const MAX_EXCLUSIONS = 20;

export type ExclusionRejection = "empty" | "too-long" | "too-short" | "unusable" | "limit";

export type ValidatedExclusion = {
  label: string;
  key: string;
};

export function normaliseExclusionLabel(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function exclusionKey(label: string): string {
  return normaliseExclusionLabel(label).toLowerCase();
}

export function validateExclusionLabel(
  raw: string,
): ValidatedExclusion | { rejected: ExclusionRejection } {
  const label = normaliseExclusionLabel(raw);
  if (label === "") return { rejected: "empty" };
  if ([...label].length > MAX_EXCLUSION_LABEL) return { rejected: "too-long" };
  if ([...label].length < 2) return { rejected: "too-short" };
  if (isJunkSubject(raw)) return { rejected: "unusable" };
  // "Never send me the" is the mirror of the topic firehose, and it is silent.
  // `related` floors a two-character term out, but "the" is three, so it is a
  // plain substring test over the whole signal and vetoes every event the
  // matcher produces. The reader's next briefing is empty and the reason is
  // never shown. A subject with no subject in it is not something to exclude.
  if (isAllStopwords(label)) return { rejected: "unusable" };
  return { label, key: exclusionKey(label) };
}

export function isValidExclusion(
  result: ValidatedExclusion | { rejected: ExclusionRejection },
): result is ValidatedExclusion {
  return !("rejected" in result);
}

export function keepUsableExclusions(labels: string[]): {
  kept: string[];
  refused: { label: string; reason: ExclusionRejection }[];
} {
  const kept: string[] = [];
  const refused: { label: string; reason: ExclusionRejection }[] = [];
  const seen = new Set<string>();

  for (const raw of labels) {
    const validated = validateExclusionLabel(raw);
    if (!isValidExclusion(validated)) {
      refused.push({ label: raw, reason: validated.rejected });
      continue;
    }
    if (seen.has(validated.key)) continue;
    if (kept.length >= MAX_EXCLUSIONS) {
      refused.push({ label: raw, reason: "limit" });
      continue;
    }
    seen.add(validated.key);
    kept.push(validated.label);
  }

  return { kept, refused };
}

export function addExclusion(selected: string[], raw: string): string[] {
  if (selected.length >= MAX_EXCLUSIONS) return selected;
  const validated = validateExclusionLabel(raw);
  if (!isValidExclusion(validated)) return selected;
  return keepUsableExclusions([...selected, validated.label]).kept;
}

export function removeExclusion(selected: string[], raw: string): string[] {
  const key = exclusionKey(raw);
  return selected.filter((label) => exclusionKey(label) !== key);
}

export function toggleExclusion(selected: string[], raw: string): string[] {
  const validated = validateExclusionLabel(raw);
  if (!isValidExclusion(validated)) return selected;
  return selected.some((label) => exclusionKey(label) === validated.key)
    ? removeExclusion(selected, validated.label)
    : addExclusion(selected, validated.label);
}
