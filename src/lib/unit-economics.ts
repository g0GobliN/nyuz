import type { PlanTier } from "@/lib/supabase/types";

export const COST_PROVIDERS = ["cloudflare", "supabase", "resend", "domain", "other"] as const;
export type CostProvider = (typeof COST_PROVIDERS)[number];

export type EconomicsBillingRow = {
  user_id: string | null;
  plan: PlanTier;
  currency: string;
  gross_cents: number;
  refunded_cents: number;
  stripe_fee_amount: number;
  stripe_fee_currency: string;
  period_start: string;
  period_end: string;
  livemode: boolean;
};

export type EconomicsAiRow = {
  user_id: string | null;
  plan: PlanTier | null;
  cost_microusd: number | null;
};

export type OperatingCost = {
  provider: CostProvider;
  monthly_cents: number;
  updated_at: string;
};

export type PlanEconomics = {
  customers: number;
  recognizedRevenueUsd: number;
  refundsUsd: number;
  stripeFeesUsd: number;
  directAiUsd: number;
  sharedAiUsd: number;
  overheadUsd: number;
  totalCostUsd: number;
  contributionUsd: number;
  marginPct: number | null;
  revenuePerCustomerUsd: number | null;
  costPerCustomerUsd: number | null;
  p50DirectAiUsd: number | null;
  p95DirectAiUsd: number | null;
  p99DirectAiUsd: number | null;
};

export type UnitEconomics = {
  windowDays: number;
  measuredFrom: string;
  measuredTo: string;
  payingCustomersAllTime: number;
  nextMilestone: 10 | 50 | 100 | null;
  overheadMonthlyUsd: number;
  sharedAiUsd: number;
  complete: boolean;
  incompleteReasons: string[];
  operatingCosts: OperatingCost[];
  plans: Record<"plura" | "omni", PlanEconomics>;
};

const PAID_PLANS = ["plura", "omni"] as const;
type PaidPlan = (typeof PAID_PLANS)[number];

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function emptyPlan(): PlanEconomics {
  return {
    customers: 0,
    recognizedRevenueUsd: 0,
    refundsUsd: 0,
    stripeFeesUsd: 0,
    directAiUsd: 0,
    sharedAiUsd: 0,
    overheadUsd: 0,
    totalCostUsd: 0,
    contributionUsd: 0,
    marginPct: null,
    revenuePerCustomerUsd: null,
    costPerCustomerUsd: null,
    p50DirectAiUsd: null,
    p95DirectAiUsd: null,
    p99DirectAiUsd: null,
  };
}

function paidPlan(value: PlanTier | null): PaidPlan | null {
  return value === "plura" || value === "omni" ? value : null;
}

export function computeUnitEconomics(input: {
  days: number;
  now: Date;
  billing: EconomicsBillingRow[];
  allTimeBilling: Pick<EconomicsBillingRow, "user_id" | "livemode">[];
  ai: EconomicsAiRow[];
  operatingCosts: OperatingCost[];
}): UnitEconomics {
  const to = input.now.getTime();
  const from = to - input.days * 86_400_000;
  const reasons = new Set<string>();
  const plans: Record<PaidPlan, PlanEconomics> = { plura: emptyPlan(), omni: emptyPlan() };
  const customers: Record<PaidPlan, Set<string>> = {
    plura: new Set(),
    omni: new Set(),
  };

  for (const row of input.billing) {
    if (!row.livemode) continue;
    const plan = paidPlan(row.plan);
    if (!plan) continue;
    const start = new Date(row.period_start).getTime();
    const end = new Date(row.period_end).getTime();
    const overlap = Math.max(0, Math.min(end, to) - Math.max(start, from));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || overlap === 0) continue;

    if (row.currency !== "usd") {
      reasons.add("A nyuz payment is not in USD, so its revenue is excluded.");
      continue;
    }
    const fraction = overlap / (end - start);
    plans[plan].recognizedRevenueUsd += (row.gross_cents / 100) * fraction;
    plans[plan].refundsUsd += (row.refunded_cents / 100) * fraction;
    if (row.stripe_fee_currency === row.currency) {
      plans[plan].stripeFeesUsd += (row.stripe_fee_amount / 100) * fraction;
    } else {
      reasons.add("A Stripe fee is in a different currency, so that fee is excluded.");
    }
    if (row.user_id) customers[plan].add(row.user_id);
    else reasons.add("A live payment is not linked to a nyuz user.");
  }

  const directAiByUser = new Map<string, number>();
  let sharedAiUsd = 0;
  for (const row of input.ai) {
    if (row.cost_microusd === null) {
      reasons.add("Some AI calls have no known provider/model price snapshot.");
      continue;
    }
    const cost = row.cost_microusd / 1_000_000;
    const plan = paidPlan(row.plan);
    if (plan && row.user_id) {
      plans[plan].directAiUsd += cost;
      const key = `${plan}:${row.user_id}`;
      directAiByUser.set(key, (directAiByUser.get(key) ?? 0) + cost);
    } else {
      sharedAiUsd += cost;
    }
  }

  const configured = new Map(input.operatingCosts.map((row) => [row.provider, row]));
  const missing = COST_PROVIDERS.filter((provider) => !configured.has(provider));
  if (missing.length > 0) {
    reasons.add(`Monthly operating costs are missing: ${missing.join(", ")}.`);
  }
  const overheadMonthlyUsd = input.operatingCosts.reduce(
    (total, row) => total + row.monthly_cents / 100,
    0,
  );
  const windowOverheadUsd = overheadMonthlyUsd * ((input.days * 12) / 365.2425);
  const totalCustomers = PAID_PLANS.reduce((total, plan) => total + customers[plan].size, 0);
  if (totalCustomers === 0 && (sharedAiUsd > 0 || windowOverheadUsd > 0)) {
    reasons.add("There are no paying customers in this window to allocate shared costs to.");
  }

  for (const plan of PAID_PLANS) {
    const result = plans[plan];
    result.customers = customers[plan].size;
    const share = totalCustomers === 0 ? 0 : result.customers / totalCustomers;
    result.sharedAiUsd = sharedAiUsd * share;
    result.overheadUsd = windowOverheadUsd * share;
    result.totalCostUsd =
      result.refundsUsd +
      result.stripeFeesUsd +
      result.directAiUsd +
      result.sharedAiUsd +
      result.overheadUsd;
    result.contributionUsd = result.recognizedRevenueUsd - result.totalCostUsd;
    if (result.customers > 0) {
      result.revenuePerCustomerUsd = result.recognizedRevenueUsd / result.customers;
      result.costPerCustomerUsd = result.totalCostUsd / result.customers;
    }
    if (reasons.size === 0 && result.recognizedRevenueUsd > 0) {
      result.marginPct = (result.contributionUsd / result.recognizedRevenueUsd) * 100;
    }

    const userCosts = [...customers[plan]].map(
      (userId) => directAiByUser.get(`${plan}:${userId}`) ?? 0,
    );
    result.p50DirectAiUsd = percentile(userCosts, 0.5);
    result.p95DirectAiUsd = percentile(userCosts, 0.95);
    result.p99DirectAiUsd = percentile(userCosts, 0.99);
  }

  const allTimeCustomers = new Set(
    input.allTimeBilling
      .filter((row) => row.livemode && row.user_id)
      .map((row) => row.user_id as string),
  ).size;
  const nextMilestone = ([10, 50, 100] as const).find((value) => value > allTimeCustomers) ?? null;

  return {
    windowDays: input.days,
    measuredFrom: new Date(from).toISOString(),
    measuredTo: input.now.toISOString(),
    payingCustomersAllTime: allTimeCustomers,
    nextMilestone,
    overheadMonthlyUsd,
    sharedAiUsd,
    complete: reasons.size === 0,
    incompleteReasons: [...reasons],
    operatingCosts: input.operatingCosts,
    plans,
  };
}
