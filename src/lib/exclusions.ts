export const MAX_EXCLUSION_LABEL = 80;

export type ExclusionRejection = "empty" | "too-long";

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
    seen.add(validated.key);
    kept.push(validated.label);
  }

  return { kept, refused };
}

export function addExclusion(selected: string[], raw: string): string[] {
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
