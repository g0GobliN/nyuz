/**
 * Helpers shared by the AI hub's tabs.
 *
 * Not a route file — the tab pages were once one `/admin/cost` page, and these
 * formatting functions were the part every section wanted. The leading `-` is
 * TanStack Router's ignore prefix: without it the route generator treats this
 * file as a route and warns that it exports no `Route`.
 */

/** USD with a dash for "unknown" — never a bare 0, which reads as a real price. */
export function usd(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function ratio(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

export function percent(value: number, max: number): string {
  return `${Math.min(Math.max(ratio(value, max) * 100, 0), 100).toFixed(1)}%`;
}

/** When a cap resets — day at UTC midnight, month on the 1st, always labelled. */
export function resetLabel(period: "day" | "month"): string {
  const now = new Date();
  const reset =
    period === "day"
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const label = reset.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${label} UTC`;
}

export function creditDepletionLabel(daysRemaining: number | null): string {
  if (daysRemaining === null) return "A depletion date needs measured spend.";
  if (daysRemaining <= 0) return "Estimated credit is depleted.";
  const date = new Date(Date.now() + daysRemaining * 86_400_000);
  return `At the current burn rate, credit lasts until about ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })}.`;
}

export function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
