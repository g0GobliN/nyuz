/**
 * Provider-agnostic economics primitives.
 *
 * This module is deliberately observational: it contains no provider calls and
 * cannot influence the news pipeline. Provider adapters will write snapshots
 * using this vocabulary; the dashboard can then distinguish facts from models.
 */

export const ECONOMICS_STATUSES = [
  "exact",
  "imported",
  "estimated",
  "projected",
  "allocated",
  "manual",
  "unavailable",
  "incomplete",
  "stale",
] as const;
export type EconomicsStatus = (typeof ECONOMICS_STATUSES)[number];

export type CostClassification = "fixed" | "variable" | "mixed";
export type BillingScope =
  | "account"
  | "organization"
  | "project"
  | "workspace"
  | "application"
  | "allocated"
  | "unallocated";

export type EconomicsSnapshot = {
  provider: string;
  service: string;
  scope: BillingScope;
  periodStart: string;
  periodEnd: string;
  capturedAt: string;
  originalAmountMinor: number | null;
  originalCurrency: string | null;
  jpyAmountMinor: number | null;
  conversionRate: number | null;
  conversionDate: string | null;
  conversionSource: string | null;
  classification: CostClassification;
  status: EconomicsStatus;
  source: string;
  usage: Record<string, number | string | null>;
  allowance: Record<string, number | string | null> | null;
};

export type Projection = {
  amountMinor: number | null;
  status: "projected" | "unavailable";
  basis: "current-period-average" | "trailing-7-day-average" | "insufficient-data";
};

/**
 * Projects a period-end amount from real observed cost only.
 *
 * A partial period with less than one day of data is intentionally unavailable;
 * extrapolating a few hours produces a precise-looking number with no basis.
 */
export function projectPeriodCost(input: {
  actualMinor: number;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
  trailingSevenDayMinor?: number | null;
}): Projection {
  const elapsed = input.now.getTime() - input.periodStart.getTime();
  const period = input.periodEnd.getTime() - input.periodStart.getTime();
  if (elapsed < 86_400_000 || period <= 0 || input.now <= input.periodStart) {
    return { amountMinor: null, status: "unavailable", basis: "insufficient-data" };
  }

  const trailing = input.trailingSevenDayMinor;
  if (trailing !== null && trailing !== undefined && trailing >= 0) {
    const remaining = Math.max(0, input.periodEnd.getTime() - input.now.getTime());
    const projected = input.actualMinor + (trailing / (7 * 86_400_000)) * remaining;
    return {
      amountMinor: Math.round(projected),
      status: "projected",
      basis: "trailing-7-day-average",
    };
  }

  return {
    amountMinor: Math.round((input.actualMinor * period) / elapsed),
    status: "projected",
    basis: "current-period-average",
  };
}

/** Convert a USD amount to JPY minor units without inventing an FX rate for zero. */
export function convertUsdToJpyMinor(usd: number, rate: number | null): number | null {
  if (!Number.isFinite(usd)) return null;
  if (usd === 0) return 0;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(usd * rate * 100);
}

export type Contribution = {
  netRevenueMinor: number;
  marginalContributionMinor: number;
  fullyLoadedContributionMinor: number;
  contributionMarginPct: number | null;
};

export type BreakEvenModel = {
  fixedCostMinor: number;
  contributionPerUserMinor: number | null;
  usersNeeded: number | null;
  status: "modeled" | "unavailable";
};

/** A transparent break-even model; it never treats unknown contribution as zero. */
export function calculateBreakEven(input: {
  fixedCostMinor: number;
  monthlyContributionMinor: number;
  activeUsers?: number;
}): BreakEvenModel {
  if (input.fixedCostMinor < 0 || input.monthlyContributionMinor <= 0) {
    return {
      fixedCostMinor: input.fixedCostMinor,
      contributionPerUserMinor: null,
      usersNeeded: null,
      status: "unavailable",
    };
  }
  return {
    fixedCostMinor: input.fixedCostMinor,
    contributionPerUserMinor: input.monthlyContributionMinor,
    usersNeeded: Math.ceil(input.fixedCostMinor / input.monthlyContributionMinor),
    status: "modeled",
  };
}

export function calculateContribution(input: {
  grossRevenueMinor: number;
  refundsMinor: number;
  stripeFeesMinor: number;
  directVariableCostMinor: number;
  allocatedSharedCostMinor: number;
}): Contribution {
  const netRevenueMinor = input.grossRevenueMinor - input.refundsMinor;
  const marginalContributionMinor =
    netRevenueMinor - input.stripeFeesMinor - input.directVariableCostMinor;
  const fullyLoadedContributionMinor = marginalContributionMinor - input.allocatedSharedCostMinor;
  return {
    netRevenueMinor,
    marginalContributionMinor,
    fullyLoadedContributionMinor,
    contributionMarginPct:
      netRevenueMinor === 0 ? null : (fullyLoadedContributionMinor / netRevenueMinor) * 100,
  };
}
