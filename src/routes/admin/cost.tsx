import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ComparisonBars,
  DonutChart,
  ForecastTimeline,
  RadialGauge,
  WindowLineChart,
} from "@/components/admin/charts";
import {
  ConsoleHeader,
  ErrorNote,
  Field,
  Loading,
  Panel,
  Pill,
  Stat,
  StatGrid,
  formatDateTime,
  formatNumber,
  inputClass,
  useConfirm,
  useConsoleMutation,
} from "@/components/admin/shell";
import { Button, Chip, buttonClass } from "@/components/kit";
import {
  type AiCreditView,
  type AiSpend,
  addAiTopup,
  deleteAiTopup,
  getAiCredit,
  getAiFeatureSpend,
  getAiSpend,
  getCostIntelligence,
  getUnitEconomics,
  listAiTopups,
  saveOperatingCosts,
} from "@/lib/server/cost-intelligence";
import { getAiStatus } from "@/lib/server/ai-status";
import { type AiRuntimeStatus } from "@/lib/server/ai-status";
import { SPEND_WINDOW_LABELS } from "@/lib/ai/credit";
import {
  COST_PROVIDERS,
  type CostProvider,
  type PlanEconomics,
  type UnitEconomics,
} from "@/lib/unit-economics";
import { Activity, AlertTriangle, ArrowRight, Wrench } from "lucide-react";

export const Route = createFileRoute("/admin/cost")({ component: CostPage });

const WINDOWS = [7, 30, 90] as const;

function CostPage() {
  const [days, setDays] = useState<number>(30);
  const [showOverhead, setShowOverhead] = useState(false);

  const cost = useQuery({
    queryKey: ["admin", "cost", days],
    queryFn: () => getCostIntelligence({ data: { days } }),
    staleTime: 60_000,
  });
  const unit = useQuery({
    queryKey: ["admin", "unit-economics", days],
    queryFn: () => getUnitEconomics({ data: { days } }),
    staleTime: 60_000,
  });
  const spend = useQuery({
    queryKey: ["admin", "ai-spend"],
    queryFn: () => getAiSpend(),
    staleTime: 60_000,
  });
  const creditView = useQuery({
    queryKey: ["admin", "ai-credit"],
    queryFn: () => getAiCredit(),
    staleTime: 60_000,
  });
  const aiStatus = useQuery({
    queryKey: ["admin", "ai-status"],
    queryFn: () => getAiStatus(),
    staleTime: 30_000,
  });

  const data = cost.data;

  return (
    <>
      <ConsoleHeader
        title="Cost"
        sub="Estimated provider credit, ledger spend and emergency safety caps."
      />

      {aiStatus.data && !aiStatus.error ? (
        <AiStatusCard data={aiStatus.data} forecast={spend.data ?? undefined} />
      ) : (
        <Panel title="AI status" className="mb-4">
          {aiStatus.isLoading ? "Checking limits…" : "Unknown — could not read runtime limits."}
        </Panel>
      )}

      <ErrorNote error={aiStatus.error} />
      <ErrorNote error={cost.error} />
      <ErrorNote error={unit.error} />
      <ErrorNote error={spend.error} />
      <ErrorNote error={creditView.error} />

      {creditView.data ? <ProviderCreditCard data={creditView.data} /> : null}

      {!creditView.isLoading && creditView.data === null ? (
        <Panel className="mb-4">
          <p className="text-[13.5px] leading-relaxed text-signal">
            Apply migration 0048 to record credit top-ups and see the balance, burn rate and spend
            by window.
          </p>
        </Panel>
      ) : null}

      {spend.data ? <AiSpendPanel data={spend.data} /> : null}
      <div className="mb-4 space-y-4">
        {creditView.data ? <SpendByWindow data={creditView.data} /> : null}
        <SpendByFeature />
      </div>
      {aiStatus.data ? <AiRuntimeCard data={aiStatus.data} /> : null}

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Unit economics
        </span>
        {WINDOWS.map((w) => (
          <Chip key={w} active={days === w} onClick={() => setDays(w)}>
            {w} days
          </Chip>
        ))}
      </div>

      {cost.isLoading || unit.isLoading ? <Loading label="Counting" /> : null}

      {!unit.isLoading && unit.data === null ? (
        <Panel>
          <p className="text-[13.5px] leading-relaxed text-signal">
            Apply migration 0043 to start measuring per-plan revenue, Stripe fees, refunds, AI spend
            and operating costs.
          </p>
        </Panel>
      ) : null}

      {unit.data ? (
        <UnitEconomicsPanel
          data={unit.data}
          showOverhead={showOverhead}
          setShowOverhead={setShowOverhead}
        />
      ) : null}

      {!cost.isLoading && data === null ? (
        <Panel>
          <p className="text-[13.5px] leading-relaxed text-signal">
            <code className="font-mono">admin_cost_intelligence()</code> is not in this database.
            Apply migration 0035 to see these numbers.
          </p>
        </Panel>
      ) : null}

      {data ? <AdvancedDiagnostics data={data} /> : null}
      <TopupSection />
    </>
  );
}

function AiStatusCard({
  data,
  forecast,
}: {
  data: AiRuntimeStatus;
  forecast?: AiSpend | undefined;
}) {
  const isBlocked = data.status === "blocked";
  const isWarning = data.status === "warning" || data.status === "near_limit";

  return (
    <div className="mb-4">
      <Panel
        title="AI status"
        note="Current enforced limits. Each new reservation must also fit within the remaining caps."
      >
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="flex flex-col rounded-2xl bg-surface-2 p-4">
            <p className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Activity className="h-3.5 w-3.5" /> Operating state
            </p>
            <p
              className={`mt-2 text-[24px] font-semibold capitalize tracking-[-0.035em] ${
                isBlocked || isWarning ? "text-signal" : "text-foreground"
              }`}
            >
              {data.status.replace("_", " ")}
            </p>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Credit:{" "}
              {data.credit.status === "unknown"
                ? "Unavailable"
                : data.credit.status === "unrecorded"
                  ? "No top-up recorded"
                  : `${usd(data.credit.remainingUsd)} left`}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              Provider-credit gate:{" "}
              <span className={data.creditGateEnabled ? "text-foreground" : "text-signal"}>
                {data.creditGateEnabled ? "Enforcing" : "Off (advisory only)"}
              </span>
            </p>
            {data.blocker.kind === "none" &&
            (data.credit.status === "low" || data.credit.status === "exhausted") ? (
              <p className="mt-2 text-[11.5px] leading-relaxed text-signal">
                Provider credit is{" "}
                {data.credit.status === "exhausted" ? "exhausted" : "running low"}.
              </p>
            ) : null}
            {data.blocker.kind !== "none" ? (
              <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
                <span>{data.blockerLabel}</span>
              </p>
            ) : null}
            <div className="mt-auto pt-4">
              {data.action ? (
                <Link
                  to="/admin/ai-runtime"
                  search={data.action.settingKey ? { setting: data.action.settingKey } : {}}
                  className={buttonClass("outline", "sm")}
                >
                  {data.action.label}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ) : data.credit.status === "low" ||
                data.credit.status === "exhausted" ||
                data.credit.status === "unrecorded" ? (
                <a href="#record-topup" className={buttonClass("primary", "sm")}>
                  {data.credit.status === "unrecorded" ? "Record first top-up" : "Record top-up"}
                  <ArrowRight className="h-3 w-3" />
                </a>
              ) : (
                <Link to="/admin/ai-runtime" search={{}} className={buttonClass("ghost", "sm")}>
                  View controls <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <RadialGauge
              label="Monthly spend"
              value={data.usage.spentUsd}
              max={data.usage.ceilingUsd}
              valueLabel={`${percent(data.usage.spentUsd, data.usage.ceilingUsd)} used`}
              detail={
                forecast?.exhaustionDate
                  ? `Stops ${shortDate(forecast.exhaustionDate)}`
                  : `${usd(Math.max(data.usage.ceilingUsd - data.usage.spentUsd, 0))} left`
              }
              attention={
                forecast?.exhaustionDate !== null && forecast?.exhaustionDate !== undefined
                  ? true
                  : ratio(data.usage.spentUsd, data.usage.ceilingUsd) >= 0.7
              }
            />
            <RadialGauge
              label="Monthly tokens"
              value={data.usage.tokensUsed}
              max={data.usage.tokensBudget}
              valueLabel={`${percent(data.usage.tokensUsed, data.usage.tokensBudget)} used`}
              detail={`${formatNumber(Math.max(data.usage.tokensBudget - data.usage.tokensUsed, 0))} left`}
              attention={ratio(data.usage.tokensUsed, data.usage.tokensBudget) >= 0.7}
            />
            <RadialGauge
              label="Flash today"
              value={data.usage.daySpentFlash}
              max={data.usage.dayCapFlash}
              valueLabel={`${usd(data.usage.daySpentFlash)} / ${usd(data.usage.dayCapFlash)}`}
              detail={`Resets ${resetLabel("day")}`}
              attention={ratio(data.usage.daySpentFlash, data.usage.dayCapFlash) >= 0.7}
            />
            <RadialGauge
              label="Pro today"
              value={data.usage.daySpentPro}
              max={data.usage.dayCapPro}
              valueLabel={`${usd(data.usage.daySpentPro)} / ${usd(data.usage.dayCapPro)}`}
              detail={`Resets ${resetLabel("day")}`}
              attention={ratio(data.usage.daySpentPro, data.usage.dayCapPro) >= 0.7}
            />
          </div>
        </div>

        {data.blocker.kind === "credit_exhausted" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-signal px-4 py-3 text-[12px]">
            {/* Text comes from the same derivation that decided to block, so
                this can never say something the enforcement logic disagrees
                with. */}
            <p>{data.blockerLabel}</p>
            <a href="#record-topup" className={buttonClass("outline", "sm")}>
              Record top-up
            </a>
          </div>
        ) : data.credit.status === "exhausted" && !data.creditGateEnabled ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-[12px] text-muted-foreground">
            <p>
              Provider credit is exhausted, but the provider-credit gate is off, so this is advisory
              only — no AI call is being refused on this ground. Turn the gate on in AI runtime once
              funded, or record a top-up regardless to keep the balance accurate.
            </p>
            <a href="#record-topup" className={buttonClass("outline", "sm")}>
              Record top-up
            </a>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

/**
 * The way in to the controls, sitting directly under the numbers they set.
 *
 * Deliberately here rather than only in the sidebar. Someone looking at a
 * ceiling they want to change is looking at this page, and a limit shown with no
 * visible way to alter it is what sent people to edit Cloudflare variables by
 * hand in the first place. The source chips are the other half: they answer
 * "will editing this actually change anything, or am I looking at a value some
 * other environment is supplying?" before the operator clicks through.
 */
function AiRuntimeCard({ data }: { data: AiRuntimeStatus }) {
  return (
    <div className="mb-4">
      <Panel
        title="Safety caps and runtime controls"
        note="Maximum nyuz may spend in one calendar month. This is an emergency guard and does not add provider credit. Set it above routine usage; top-ups do not change it."
      >
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            <LimitSummary
              label="Monthly safety cap"
              value={`$${data.usage.ceilingUsd.toFixed(2)}`}
              source={data.ceilingSource}
              settingKey="ai.monthly_cost_usd"
            />
            <LimitSummary
              label="Token safety cap"
              value={formatNumber(data.usage.tokensBudget)}
              source={data.tokenBudgetSource}
              settingKey="ai.monthly_token_budget"
            />
            <LimitSummary
              label="AI kill switch"
              value={data.usage.killSwitchOn ? "On" : "Off"}
              source="database"
              settingKey="flag.ai_kill_switch"
            />
          </dl>

          <Link to="/admin/ai-runtime" search={{}} className={buttonClass("primary", "sm")}>
            <Wrench className="h-3.5 w-3.5" />
            Manage AI runtime
          </Link>
        </div>
        <p className="mt-4 text-[12px] text-muted-foreground">
          Daily model limits (UTC): Flash {usd(data.usage.daySpentFlash)} /{" "}
          {usd(data.usage.dayCapFlash)}; Pro {usd(data.usage.daySpentPro)} /{" "}
          {usd(data.usage.dayCapPro)}. Per-call and other runtime limits are in AI Runtime.
        </p>
      </Panel>
    </div>
  );
}

function LimitSummary({
  label,
  value,
  source,
  settingKey,
}: {
  label: string;
  value: string;
  source: AiRuntimeStatus["ceilingSource"];
  settingKey: string;
}) {
  return (
    <div>
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-serif text-[22px] leading-none tabular-nums">{value}</dd>
      <Link
        to="/admin/ai-runtime"
        search={{ setting: settingKey }}
        className="mt-2 inline-block text-[11px] text-muted-foreground underline-offset-4 hover:underline"
      >
        {source === "database"
          ? "Source: DB"
          : source === "environment"
            ? "Source: environment fallback — set an admin value"
            : "Source: default — set an admin value"}
      </Link>
    </div>
  );
}

function ProviderCreditCard({ data }: { data: AiCreditView }) {
  const { credit } = data;

  return (
    <div className="mb-4">
      <Panel
        title="Provider credit"
        note="Estimated from recorded top-ups minus settled AI spend and in-flight reservations. Informational; nyuz does not gate calls on this estimate."
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[32px] font-semibold tracking-[-0.04em] tabular-nums">
            {credit.topups === 0 ? "No top-up recorded" : `${usd(credit.remainingUsd)} remaining`}
          </p>
          <a href="#record-topup" className={buttonClass("outline", "sm")}>
            Record top-up
          </a>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-center">
          <StatGrid>
            <Stat
              label="Total topped up"
              value={usd(credit.toppedUpUsd)}
              hint={`${credit.topups} top-ups`}
            />
            <Stat
              label="Settled AI spend"
              value={usd(credit.settledUsd)}
              hint="Since the first recorded top-up"
            />
            <Stat
              label="Burn"
              value={
                credit.burnUsdPerDay === null ? "—" : `$${credit.burnUsdPerDay.toFixed(2)}/day`
              }
              hint="Trailing 7 days, or since first top-up if newer; includes reservations"
            />
            <Stat
              label="In flight"
              value={`$${credit.inFlightUsd.toFixed(2)}`}
              hint="Reserved at estimate"
            />
          </StatGrid>

          {credit.topups > 0 ? (
            <div className="rounded-2xl border border-hairline bg-surface-2 p-4">
              <DonutChart
                centerLabel="runway"
                centerValue={
                  credit.daysRemaining === null
                    ? "—"
                    : credit.daysRemaining < 1
                      ? "<1 day"
                      : `${credit.daysRemaining.toFixed(credit.daysRemaining < 10 ? 1 : 0)}d`
                }
                segments={[
                  {
                    label: "Credit left",
                    value: Math.max(credit.remainingUsd, 0),
                    display: usd(Math.max(credit.remainingUsd, 0)),
                  },
                  {
                    label: "Credit used",
                    value: Math.max(credit.toppedUpUsd - credit.remainingUsd, 0),
                    display: usd(Math.max(credit.toppedUpUsd - credit.remainingUsd, 0)),
                  },
                ]}
              />
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                {creditDepletionLabel(credit.daysRemaining)}
              </p>
            </div>
          ) : null}
        </div>

        {credit.status === "exhausted" && (
          <div className="mt-3">
            <Pill tone="signal">Provider credit exhausted · advisory</Pill>
          </div>
        )}
        <p className="mt-3 text-[12px] text-muted-foreground">
          {credit.firstTopupAt
            ? `Balance starts ${formatDateTime(credit.firstTopupAt)}. `
            : "Balance starts with the first recorded top-up. "}
          Earlier ledger spend ({usd(credit.unfundedSpentUsd)}) is excluded from provider credit and
          remains in spend history and applicable monthly safety-cap usage.
        </p>
        {credit.unpricedCalls > 0 ? (
          <p className="mt-2 text-[12px] text-signal">
            {credit.unpricedCalls} calls have no price; the estimated balance may be overstated.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

function AiSpendPanel({ data }: { data: AiSpend }) {
  const willExhaust = data.exhaustionDate !== null;
  const exhausted = data.spentUsd >= data.ceilingUsd;

  return (
    <div className="mb-4">
      <Panel
        title="Monthly safety cap · usage details"
        note={`${data.usedPct.toFixed(1)}% of the $${data.ceilingUsd.toFixed(2)} safety cap; includes settled spend and reservations in this UTC calendar month`}
      >
        <StatGrid>
          <Stat
            label="Spent"
            value={`$${data.spentUsd.toFixed(2)}`}
            hint={exhausted ? "Monthly safety cap reached" : `${data.usedPct.toFixed(1)}% used`}
          />
          <Stat
            label="Projected month end"
            value={data.projectedUsd !== null ? `$${data.projectedUsd.toFixed(2)}` : "—"}
            hint={
              exhausted
                ? "Model calls refused"
                : willExhaust
                  ? `Safety cap ${new Date(data.exhaustionDate as string).toLocaleDateString()}`
                  : "Inside safety cap"
            }
            estimate
          />
          <Stat
            label="Metered calls"
            value={formatNumber(data.calls)}
            hint={`${formatNumber(data.tokens)} tokens`}
          />
          <Stat
            label="In flight"
            value={`$${data.inFlightUsd.toFixed(2)}`}
            hint="Reserved at estimate"
          />
        </StatGrid>
        <div className="mt-5">
          <ForecastTimeline
            label="Cap consumption and forecast"
            value={data.spentUsd}
            max={data.ceilingUsd}
            valueLabel={`${data.usedPct.toFixed(1)}% used`}
            detail={`${usd(Math.max(data.ceilingUsd - data.spentUsd, 0))} available until ${resetLabel("month")}`}
            marker={
              data.projectedUsd === null
                ? undefined
                : {
                    value: data.projectedUsd,
                    label: data.exhaustionDate
                      ? `Projected to stop ${shortDate(data.exhaustionDate)}`
                      : `Month-end projection ${usd(data.projectedUsd)}`,
                  }
            }
            attention={exhausted || willExhaust || data.usedPct >= 70}
          />
        </div>
        {exhausted || willExhaust || data.unpricedCalls > 0 || !data.ceilingResolved ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {exhausted ? (
              <Pill tone="signal">Monthly safety cap reached — increase it in AI Runtime</Pill>
            ) : null}
            {willExhaust ? <Pill tone="signal">On track to stop before month end</Pill> : null}
            {!data.ceilingResolved ? (
              <Pill tone="outline">Using built-in default safety cap — edit in AI Runtime</Pill>
            ) : null}
            {data.unpricedCalls > 0 ? (
              <Pill tone="outline">{formatNumber(data.unpricedCalls)} calls unpriced</Pill>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function UnitEconomicsPanel({
  data,
  showOverhead,
  setShowOverhead,
}: {
  data: UnitEconomics;
  showOverhead: boolean;
  setShowOverhead: (v: boolean) => void;
}) {
  const initial = useMemo(
    () =>
      Object.fromEntries(
        COST_PROVIDERS.map((provider) => {
          const stored = data.operatingCosts.find((row) => row.provider === provider);
          return [provider, stored ? (stored.monthly_cents / 100).toFixed(2) : ""];
        }),
      ) as Record<CostProvider, string>,
    [data.operatingCosts],
  );
  const [costs, setCosts] = useState<Record<CostProvider, string>>(initial);
  const save = useConsoleMutation(saveOperatingCosts, [["admin", "unit-economics"]]);

  useEffect(() => setCosts(initial), [initial]);

  const submit = () => {
    const cents = Object.fromEntries(
      COST_PROVIDERS.map((provider) => [provider, Math.round(Number(costs[provider]) * 100)]),
    ) as Record<CostProvider, number>;
    if (Object.values(cents).some((value) => !Number.isFinite(value) || value < 0)) return;
    save.mutate({ data: { costs: cents } });
  };

  if (data.payingCustomersAllTime === 0) {
    return (
      <div className="mb-5">
        <Panel title="Unit economics">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13.5px] text-muted-foreground">No paying customers yet.</p>
              <p className="text-[12px] text-muted-foreground">
                Detailed unit economics will appear once revenue exists.
              </p>
            </div>
            <div className="flex items-center gap-4 text-[12px]">
              <span>
                Shared AI: <strong>${data.sharedAiUsd.toFixed(2)}</strong>
              </span>
              <span>
                Overhead: <strong>${data.overheadMonthlyUsd.toFixed(2)}</strong>
              </span>
              <Button size="sm" variant="outline" onClick={() => setShowOverhead(!showOverhead)}>
                <Wrench className="mr-1 h-3 w-3" />
                Configure overhead
              </Button>
            </div>
          </div>

          {showOverhead && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {COST_PROVIDERS.map((provider) => (
                <Field key={provider} label={provider}>
                  <div className="relative">
                    <span className="absolute left-3.5 top-[18px] text-[13px] text-muted-foreground">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={costs[provider]}
                      onChange={(event) =>
                        setCosts((current) => ({ ...current, [provider]: event.target.value }))
                      }
                      className={`${inputClass} pl-7`}
                    />
                  </div>
                </Field>
              ))}
              <div className="flex items-end pb-1">
                <Button onClick={submit} disabled={save.isPending} size="sm">
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
              {save.isSuccess ? (
                <span className="text-[12px] text-muted-foreground">Saved</span>
              ) : null}
              <ErrorNote error={save.error} />
            </div>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="mb-5 space-y-5">
      <Panel title={`Unit economics · last ${data.windowDays} days`}>
        <StatGrid>
          <Stat label="Paying customers" value={formatNumber(data.payingCustomersAllTime)} />
          <Stat label="Monthly overhead" value={`$${data.overheadMonthlyUsd.toFixed(2)}`} />
          <Stat label="Shared AI in window" value={`$${data.sharedAiUsd.toFixed(2)}`} />
        </StatGrid>

        {!data.complete ? (
          <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <p className="text-[12.5px] font-semibold">
              Margin withheld until the ledger is complete
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">
              {data.incompleteReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <PlanCard name="Plura · $14.99" data={data.plans.plura} complete={data.complete} />
          <PlanCard name="Omni · $29.99" data={data.plans.omni} complete={data.complete} />
        </div>
      </Panel>

      <Panel
        title="Actual monthly overhead"
        note="Enter the monthly equivalent from each real invoice."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {COST_PROVIDERS.map((provider) => (
            <Field key={provider} label={provider}>
              <div className="relative">
                <span className="absolute left-3.5 top-[18px] text-[13px] text-muted-foreground">
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={costs[provider]}
                  onChange={(event) =>
                    setCosts((current) => ({ ...current, [provider]: event.target.value }))
                  }
                  className={`${inputClass} pl-7`}
                />
              </div>
            </Field>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={submit} disabled={save.isPending} size="sm">
            {save.isPending ? "Saving…" : "Save overhead"}
          </Button>
          {save.isSuccess ? <span className="text-[12px] text-muted-foreground">Saved</span> : null}
        </div>
        <ErrorNote error={save.error} />
      </Panel>
    </div>
  );
}

function AdvancedDiagnostics({
  data,
}: {
  data: Awaited<ReturnType<typeof getCostIntelligence>> | null;
}) {
  const [open, setOpen] = useState(false);

  if (!data) return null;

  return (
    <div className="mb-5">
      <Panel
        title="Advanced diagnostics"
        note={`${Object.keys(data.ai_usage).length > 0 ? `${Object.values(data.ai_usage).reduce((a, b) => a + b, 0)} tokens across features` : "No usage recorded"} · ${data.sources.active} sources active`}
      >
        {!open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Show diagnostics
          </Button>
        ) : (
          <div className="space-y-5">
            <div>
              <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Sources
              </h4>
              <div className="flex flex-wrap gap-2">
                <Pill tone="outline">active {data.sources.active}</Pill>
                <Pill tone="outline">core {data.sources.core}</Pill>
                <Pill tone="outline">demand {data.sources.demand}</Pill>
                <Pill tone="outline">no demand {data.sources.no_demand}</Pill>
                <Pill tone="outline">hot {data.sources.hot}</Pill>
                <Pill tone="outline">normal {data.sources.normal}</Pill>
                <Pill tone="outline">low {data.sources.low}</Pill>
                <Pill tone="outline">cold {data.sources.cold}</Pill>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Events
              </h4>
              <StatGrid>
                <Stat label="Analysed" value={formatNumber(data.events.analysed)} />
                <Stat label="Awaiting" value={formatNumber(data.events.awaiting)} />
                <Stat label="Analysis tokens" value={formatNumber(data.events.analysis_tokens)} />
              </StatGrid>
              {data.articles.unclustered > 0 && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {formatNumber(data.articles.unclustered)} of {formatNumber(data.articles.total)}{" "}
                  articles unclustered
                </p>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Shared impacts
              </h4>
              <StatGrid>
                <Stat label="Written" value={formatNumber(data.impacts.complete)} />
                <Stat label="Failed" value={formatNumber(data.impacts.failed)} />
                <Stat label="Tokens" value={formatNumber(data.impacts.tokens)} />
                <Stat label="Briefing appearances" value={formatNumber(data.digest_items_total)} />
              </StatGrid>
            </div>

            <div>
              <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Translation
              </h4>
              <StatGrid>
                <Stat label="Cached" value={formatNumber(data.translations.complete)} />
                <Stat label="Languages" value={formatNumber(data.translations.languages)} />
                <Stat label="Failed" value={formatNumber(data.translations.failed)} />
                <Stat label="Tokens" value={formatNumber(data.translations.tokens)} />
              </StatGrid>
            </div>

            <div>
              <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Cluster v2 agreement
              </h4>
              {data.cluster_shadow.decided === 0 ? (
                <p className="text-[12px] text-muted-foreground">Not measured yet.</p>
              ) : (
                <StatGrid>
                  <Stat
                    label="Same agreed"
                    value={`${data.cluster_shadow.same_agreed}/${data.cluster_shadow.same_decided}`}
                  />
                  <Stat
                    label="Diff agreed"
                    value={`${data.cluster_shadow.diff_agreed}/${data.cluster_shadow.diff_decided}`}
                  />
                  <Stat label="Decided" value={formatNumber(data.cluster_shadow.decided)} />
                </StatGrid>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Flags
              </h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.flags).map(([key, enabled]) => (
                  <Pill key={key} tone={enabled ? "signal" : "outline"}>
                    {key} · {enabled ? "on" : "off"}
                  </Pill>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Collapse
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function SpendByFeature() {
  const [window, setWindow] = useState("30_days");
  const spend = useQuery({
    queryKey: ["admin", "ai-feature-spend"],
    queryFn: () => getAiFeatureSpend(),
    staleTime: 60_000,
  });
  const featureLabels: Record<string, string> = {
    analyse: "Analyse",
    reason: "Reason",
    digest: "Digest",
    cluster: "Cluster",
    ask: "Ask",
    translation: "Translation",
    translate: "Translation",
    enrich: "Enrichment",
    impact: "Impact",
    unknown: "Unattributed",
  };

  const entries =
    spend.data
      ?.filter((row) => row.window_key === window)
      .sort((a, b) => b.spent_microusd - a.spent_microusd) ?? [];

  return (
    <Panel
      title="Spend by feature"
      note="Ledger cost, including in-flight reservations; token counts reflect reported usage."
    >
      <div className="mb-4 flex gap-2">
        {(
          [
            ["today", "Today (UTC)"],
            ["7_days", "7 days"],
            ["30_days", "30 days"],
          ] as const
        ).map(([key, label]) => (
          <Chip key={key} active={window === key} onClick={() => setWindow(key)}>
            {label}
          </Chip>
        ))}
      </div>
      <ErrorNote error={spend.error} />
      {spend.isLoading ? <Loading label="Counting spend" /> : null}
      <ComparisonBars
        rows={entries.map((row) => ({
          label: featureLabels[row.feature] ?? row.feature,
          value: row.spent_microusd,
          display: usd(row.spent_microusd / 1_000_000),
          note: `${formatNumber(row.calls)} calls · ${formatNumber(row.tokens)} tokens`,
        }))}
        emptyLabel="No spend recorded in this window."
      />
    </Panel>
  );
}

function SpendByWindow({ data }: { data: AiCreditView }) {
  const { windows } = data;
  if (windows.length === 0) return null;

  return (
    <Panel
      title="Recent spend"
      note="Cumulative ledger spend across each lookback window, including in-flight reservations."
    >
      <WindowLineChart
        rows={windows.map((window) => ({
          label: SPEND_WINDOW_LABELS[window.key],
          value: window.spentUsd,
          display: usd(window.spentUsd),
        }))}
      />
      <p className="mt-3 text-[11px] text-muted-foreground">
        Each point is a cumulative window, not an independent period.
      </p>
    </Panel>
  );
}

function ratio(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

function percent(value: number, max: number): string {
  return `${Math.min(Math.max(ratio(value, max) * 100, 0), 100).toFixed(1)}%`;
}

function resetLabel(period: "day" | "month"): string {
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

function creditDepletionLabel(daysRemaining: number | null): string {
  if (daysRemaining === null) return "A depletion date needs measured spend.";
  if (daysRemaining <= 0) return "Estimated credit is depleted.";
  const date = new Date(Date.now() + daysRemaining * 86_400_000);
  return `At the current burn rate, credit lasts until about ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })}.`;
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TopupSection() {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const confirm = useConfirm();
  const add = useConsoleMutation(addAiTopup, [
    ["admin", "ai-credit"],
    ["admin", "ai-topups"],
    ["admin", "ai-status"],
  ]);
  const topups = useQuery({
    queryKey: ["admin", "ai-topups"],
    queryFn: () => listAiTopups(),
    staleTime: 60_000,
  });
  const remove = useConsoleMutation(deleteAiTopup, [
    ["admin", "ai-credit"],
    ["admin", "ai-topups"],
    ["admin", "ai-status"],
  ]);

  const submit = () => {
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(amount.trim())) return;
    add.mutate({ data: { amountUsd: amount.trim(), note: note.trim() || undefined } });
    setAmount("");
    setNote("");
  };

  return (
    <div id="record-topup" className="scroll-mt-5 space-y-4">
      <Panel
        title="Record a top-up"
        note="Enter what the provider actually charged you. A $5 purchase is 5. Recording a top-up does not change the monthly safety cap."
      >
        <div className="grid gap-4 sm:grid-cols-[160px_1fr_auto] sm:items-end">
          <Field label="Amount">
            <div className="relative">
              <span className="absolute left-3.5 top-[18px] text-[13px] text-muted-foreground">
                $
              </span>
              <input
                inputMode="decimal"
                placeholder="5.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={`${inputClass} pl-7`}
              />
            </div>
          </Field>
          <Field label="Note / provider (optional)">
            <input
              placeholder="DeepSeek top-up"
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="pb-1">
            <Button onClick={submit} disabled={add.isPending || amount.trim() === ""} size="sm">
              {add.isPending ? "Recording…" : "Record top-up"}
            </Button>
          </div>
        </div>
        <ErrorNote error={add.error} />
      </Panel>

      {topups.data && topups.data.length > 0 ? (
        <Panel
          title="Top-up history"
          note="Most recent 100 entries. The provider-credit total includes every recorded top-up."
        >
          <ul className="divide-y divide-hairline">
            {topups.data.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <span className="font-serif text-[18px] tabular-nums">
                  {usd(row.amount_microusd / 1_000_000)}
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  {formatDateTime(row.occurred_at)}
                </span>
                {row.note ? <span className="text-[12.5px] text-signal">{row.note}</span> : null}
                <span className="ml-auto flex items-center gap-2">
                  {confirm.is(row.id) ? (
                    <>
                      <Button
                        size="sm"
                        variant="signal"
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate({ data: { id: row.id } });
                          confirm.clear();
                        }}
                      >
                        Remove
                      </Button>
                      <Button size="sm" variant="ghost" onClick={confirm.clear}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => confirm.ask(row.id)}>
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <ErrorNote error={remove.error} />
        </Panel>
      ) : null}
    </div>
  );
}

function PlanCard({
  name,
  data,
  complete,
}: {
  name: string;
  data: PlanEconomics;
  complete: boolean;
}) {
  const rows: [string, string][] = [
    ["Customers in window", formatNumber(data.customers)],
    ["Recognized revenue", usd(data.recognizedRevenueUsd)],
    ["Refunds", usd(data.refundsUsd)],
    ["Stripe fees", usd(data.stripeFeesUsd)],
    ["Direct AI", usd(data.directAiUsd)],
    ["P95 direct AI / customer", usd(data.p95DirectAiUsd)],
    ["Shared AI allocation", usd(data.sharedAiUsd)],
    ["Overhead allocation", usd(data.overheadUsd)],
    [complete ? "Total cost" : "Known cost subtotal", usd(data.totalCostUsd)],
    ["Cost / customer", usd(data.costPerCustomerUsd)],
    [complete ? "Contribution" : "Known contribution subtotal", usd(data.contributionUsd)],
    ["Gross margin", data.marginPct === null ? "—" : `${data.marginPct.toFixed(1)}%`],
  ];

  return (
    <section className="rounded-2xl border border-hairline bg-surface-2 p-4">
      <h3 className="text-[14px] font-semibold">{name}</h3>
      <dl className="mt-3 divide-y divide-[var(--hairline)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2 text-[12.5px]">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const PROVIDER_LABELS: Record<CostProvider, string> = {
  cloudflare: "Cloudflare",
  supabase: "Supabase",
  resend: "Resend / email",
  domain: "Domain",
  other: "Other",
};

function usd(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
