/**
 * A 0–10 score as a reader sees it.
 *
 * The product prints one scale, 0–10 (`docs/design-spec-2026-10-21.md`, S9), but
 * a whole number carried a tenth it does not have: the story rail read
 * `8.0 / 10`, the alert rule read `6.0`, and the pipeline read `Importance 6.0`.
 * `8.0` claims a precision the stored score does not carry — the value is
 * rounded to one decimal upstream, so `.0` is padding, not resolution.
 *
 * So: whole numbers print bare, fractions keep one decimal. `8 / 10`,
 * `7.5 / 10`, `5.9 / 10`. The scale does not change, only the trailing zero.
 */
export function formatScore(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
