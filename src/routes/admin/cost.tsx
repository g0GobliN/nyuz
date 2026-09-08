import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { AlertTriangle, ArrowRight, Wrench } from "lucide-react";

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
        sub="What the pipeline is spending, and what the demand-driven work measurably changed. Everything here is counted from rows."
      />

      {aiStatus.data ? <AiStatusCard data={aiStatus.data} /> : null}
      {aiStatus.data ? <AiRuntimeCard data={aiStatus.data} /> : null}

      <ErrorNote error={cost.error} />
      <ErrorNote error={unit.error} />
      <ErrorNote error={spend.error} />
      <ErrorNote error={creditView.error} />

      {creditView.data ? <ProviderCreditCard data={creditView.data} /> : null}

      {!creditView.isLoading && creditView.data === null ? (
        <Panel className="mb-5">
          <p className="text-[13.5px] leading-relaxed text-signal">
            Apply migration 0048 to record credit top-ups and see the balance, burn rate and spend
            by window.
          </p>
        </Panel>
      ) : null}

      {spend.data ? <AiSpendPanel data={spend.data} /> : null}

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
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

      {creditView.data ? <SpendByWindow data={creditView.data} /> : null}
      {data ? <SpendByFeature data={data} /> : null}

      <TopupSection />
    </>
  );
}

function AiStatusCard({ data }: { data: AiRuntimeStatus }) {
  const isBlocked = data.status === "blocked";
  const isWarning = data.status === "warning" || data.status === "near_limit";
  const progressPct = Math.min(data.usage.usedPct, 100);

  return (
    <div className="mb-5">
      <Panel
        title="AI status"
        note="Derived from the same checks as the pipeline's reserve_ai_tokens."
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-semibold capitalize ${
              isBlocked
                ? "bg-signal/10 text-signal"
                : isWarning
                  ? "bg-yellow-500/10 text-yellow-500"
                  : "bg-emerald-500/10 text-emerald-500"
            }`}
          >
            {data.status.replace("_", " ")}
          </span>
          {data.action ? (
            // Deep-links to the control that clears the blocker. It used to be
            // an inert button next to prose naming an environment variable,
            // which was both a dead end and — since the budgets moved into the
            // database — the wrong instruction.
            <Link
              to="/admin/ai-runtime"
              search={data.action.settingKey ? { setting: data.action.settingKey } : {}}
              className={buttonClass("outline", "sm")}
            >
              {data.action.label}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>

        {data.blocker.kind !== "none" && (
          <div className="mt-2 flex items-start gap-2 text-[12.5px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
            <span>{data.blockerLabel}</span>
          </div>
        )}

        <div className="mt-3">
          <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
            <span>Monthly spend</span>
            <span>{data.usage.usedPct.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progressPct >= 90
                  ? "bg-signal"
                  : progressPct >= 70
                    ? "bg-yellow-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
            <span>0%</span>
            <span className="text-yellow-500">70%</span>
            <span className="text-signal">90%</span>
            <span>100%</span>
          </div>
        </div>
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
    <div className="mb-5">
      <Panel
        title="AI runtime controls"
        note="Budgets, token ceilings and switches, stored in the database and read by both the local pipeline and the deployed Worker."
      >
        <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            <LimitSummary
              label="Monthly AI budget"
              value={`$${data.usage.ceilingUsd.toFixed(2)}`}
              source={data.ceilingSource}
              settingKey="ai.monthly_cost_usd"
            />
            <LimitSummary
              label="Monthly token budget"
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
  const runway =
    credit.daysRemaining === null
      ? "Not measured yet"
      : credit.daysRemaining < 1
        ? "Under a day"
        : `${credit.daysRemaining.toFixed(credit.daysRemaining < 10 ? 1 : 0)} days`;

  return (
    <div className="mb-5">
      <Panel
        title="Provider credit"
        note={`${credit.toppedUpUsd > 0 ? `${credit.spentUsd} of ${credit.toppedUpUsd} used` : "No top-up recorded yet"} · ${runway} runway`}
      >
        <StatGrid>
          <Stat
            label="Remaining"
            value={credit.topups === 0 ? "—" : `$${credit.remainingUsd.toFixed(2)}`}
            hint={credit.daysRemaining !== null ? `${credit.daysRemaining} days` : "Not measured"}
          />
          <Stat
            label="Burn"
            value={credit.burnUsdPerDay === null ? "—" : `$${credit.burnUsdPerDay.toFixed(2)}/day`}
            hint="Trailing 7 days"
          />
          <Stat
            label="In flight"
            value={`$${credit.inFlightUsd.toFixed(2)}`}
            hint="Reserved at estimate"
          />
          <Stat
            label="Topped up"
            value={`$${credit.toppedUpUsd.toFixed(2)}`}
            hint={`${credit.topups} top-ups`}
          />
        </StatGrid>

        {credit.status === "exhausted" && (
          <div className="mt-3">
            <Pill tone="signal">Credit exhausted — top up</Pill>
          </div>
        )}
      </Panel>
    </div>
  );
}

function AiSpendPanel({ data }: { data: AiSpend }) {
  const willExhaust = data.exhaustionDate !== null;
  const exhausted = data.spentUsd >= data.ceilingUsd;

  return (
    <div className="mb-5">
      <Panel
        title="AI spend · this month"
        note={`${data.usedPct.toFixed(1)}% of the ${data.ceilingUsd > 0 ? `$${data.ceilingUsd.toFixed(2)}` : "default"} ceiling`}
      >
        <StatGrid>
          <Stat
            label="Spent"
            value={`$${data.spentUsd.toFixed(2)}`}
            hint={exhausted ? "Ceiling reached" : `${data.usedPct.toFixed(1)}% used`}
          />
          <Stat
            label="Projected month end"
            value={data.projectedUsd !== null ? `$${data.projectedUsd.toFixed(2)}` : "—"}
            hint={
              exhausted
                ? "Model calls refused"
                : willExhaust
                  ? `Ceiling ${new Date(data.exhaustionDate as string).toLocaleDateString()}`
                  : "Inside ceiling"
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
        {exhausted || willExhaust || data.unpricedCalls > 0 || !data.ceilingResolved ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {exhausted ? (
              <Pill tone="signal">Ceiling reached — adjust the monthly AI budget</Pill>
            ) : null}
            {willExhaust ? <Pill tone="signal">On track to stop before month end</Pill> : null}
            {!data.ceilingResolved ? (
              <Pill tone="outline">Using built-in default ceiling — set one in AI runtime</Pill>
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

function SpendByFeature({
  data,
}: {
  data: Awaited<ReturnType<typeof getCostIntelligence>> | null;
}) {
  const featureLabels: Record<string, string> = {
    analyse: "Analyse",
    reason: "Reason",
    digest: "Digest",
    cluster: "Cluster",
    ask: "Ask",
    translation: "Translation",
  };

  if (!data) return null;

  const entries = Object.entries(data.ai_usage);
  if (entries.length === 0) return null;

  return (
    <div className="mb-5">
      <Panel title="Spend by feature" note="Dollar spend first, tokens and calls as secondary.">
        <StatGrid>
          {entries.map(([feature, tokens]) => (
            <Stat
              key={feature}
              label={featureLabels[feature] ?? feature}
              value={formatNumber(tokens)}
              hint={`${tokens.toLocaleString()} tokens`}
            />
          ))}
        </StatGrid>
      </Panel>
    </div>
  );
}

function SpendByWindow({ data }: { data: AiCreditView }) {
  const { windows } = data;
  if (windows.length === 0) return null;

  return (
    <div className="mb-5">
      <Panel title="Spend by window" note="The same ledger, sliced by how recently it was spent.">
        <StatGrid>
          {windows.map((w) => (
            <Stat
              key={w.key}
              label={SPEND_WINDOW_LABELS[w.key]}
              value={`$${w.spentUsd.toFixed(2)}`}
              hint={`${formatNumber(w.calls)} calls · ${formatNumber(w.tokens)} tokens`}
            />
          ))}
        </StatGrid>
      </Panel>
    </div>
  );
}

function TopupSection() {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const confirm = useConfirm();
  const add = useConsoleMutation(addAiTopup, [
    ["admin", "ai-credit"],
    ["admin", "ai-topups"],
  ]);
  const topups = useQuery({
    queryKey: ["admin", "ai-topups"],
    queryFn: () => listAiTopups(),
    staleTime: 60_000,
  });
  const remove = useConsoleMutation(deleteAiTopup, [
    ["admin", "ai-credit"],
    ["admin", "ai-topups"],
  ]);

  const submit = () => {
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(amount.trim())) return;
    add.mutate({ data: { amountUsd: amount.trim(), note: note.trim() || undefined } });
    setAmount("");
    setNote("");
  };

  return (
    <div className="mb-5 space-y-5">
      <Panel
        title="Record a top-up"
        note="Enter what the provider actually charged you. A $5 purchase is 5."
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
          <Field label="Note (optional)">
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
        <Panel title="Top-up history">
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
