import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
import { Button, Chip } from "@/components/kit";
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
import { SPEND_WINDOW_LABELS } from "@/lib/ai/credit";
import {
  COST_PROVIDERS,
  type CostProvider,
  type PlanEconomics,
  type UnitEconomics,
} from "@/lib/unit-economics";

export const Route = createFileRoute("/admin/cost")({ component: CostPage });

const WINDOWS = [7, 30, 90] as const;

/**
 * What the pipeline costs, counted (docs/plan2.md phase 10).
 *
 * Every number on this page is a row count or a sum of recorded spend. There
 * is no "estimated saving" and no projected monthly bill: the honest version
 * of either needs to know what work that never happened *would* have cost,
 * and this project does not display figures nobody computed.
 *
 * The flags panel is at the top rather than the bottom because without it
 * every number below is ambiguous — a low skip count could mean the gate is
 * working well or simply switched off.
 */
function CostPage() {
  const [days, setDays] = useState<number>(30);

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
  // Not windowed: the ceiling resets on the calendar month, so a 7- or 90-day
  // view of it would answer a question nobody is asking.
  const spend = useQuery({
    queryKey: ["admin", "ai-spend"],
    queryFn: () => getAiSpend(),
    staleTime: 60_000,
  });
  // Not windowed either: a prepaid balance is a running total, not a period.
  const creditView = useQuery({
    queryKey: ["admin", "ai-credit"],
    queryFn: () => getAiCredit(),
    staleTime: 60_000,
  });

  const data = cost.data;

  return (
    <>
      <ConsoleHeader
        title="Cost"
        sub="What the pipeline is spending, and what the demand-driven work measurably changed. Everything here is counted from rows — there are no projections on this page, and no figure appears that nobody computed."
      />

      <ErrorNote error={cost.error} />
      <ErrorNote error={unit.error} />
      <ErrorNote error={spend.error} />
      <ErrorNote error={creditView.error} />

      {creditView.data ? <AiCreditPanel data={creditView.data} /> : null}

      {!creditView.isLoading && creditView.data === null ? (
        <Panel className="mb-5">
          <p className="text-[13.5px] leading-relaxed text-signal">
            Apply migration 0048 to record credit top-ups and see the balance, burn rate and spend
            by window. Until then the ledger measures spend but nothing measures what was paid in.
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
            and operating costs. No margin is guessed before the ledgers exist.
          </p>
        </Panel>
      ) : null}

      {unit.data ? <UnitEconomicsPanel data={unit.data} /> : null}

      {!cost.isLoading && data === null ? (
        <Panel>
          <p className="text-[13.5px] leading-relaxed text-signal">
            <code className="font-mono">admin_cost_intelligence()</code> is not in this database.
            Apply migration 0035 to see these numbers. Nothing is estimated in its absence.
          </p>
        </Panel>
      ) : null}

      {data ? (
        <div className="space-y-5">
          <Panel title="What is switched on">
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.flags).map(([key, enabled]) => (
                <Pill key={key} tone={enabled ? "signal" : "outline"}>
                  {key} · {enabled ? "on" : "off"}
                </Pill>
              ))}
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Read this first. A low skip count means one thing when the gate is on and something
              entirely different when it is off.
            </p>
          </Panel>

          <Panel title="Sources">
            <StatGrid>
              <Stat label="Active" value={formatNumber(data.sources.active)} />
              <Stat
                label="Core"
                value={formatNumber(data.sources.core)}
                hint="Collected regardless of demand"
              />
              <Stat
                label="Demand"
                value={formatNumber(data.sources.demand)}
                hint="Collected because somebody wants them"
              />
              <Stat
                label="No demand"
                value={formatNumber(data.sources.no_demand)}
                hint="Past the grace period"
              />
            </StatGrid>
            <div className="mt-4 flex flex-wrap gap-2">
              <Pill tone="outline">hot {data.sources.hot}</Pill>
              <Pill tone="outline">normal {data.sources.normal}</Pill>
              <Pill tone="outline">low {data.sources.low}</Pill>
              <Pill tone="outline">cold {data.sources.cold}</Pill>
              <Pill tone="outline">paused {data.sources.paused_tier}</Pill>
            </div>
          </Panel>

          <Panel title="Events and analysis">
            <StatGrid>
              <Stat label="Analysed" value={formatNumber(data.events.analysed)} />
              <Stat
                label="Awaiting"
                value={formatNumber(data.events.awaiting)}
                hint="Pending, not lost"
              />
              <Stat label="Analysis tokens" value={formatNumber(data.events.analysis_tokens)} />
              <Stat
                label="Tokens per event"
                value={
                  data.events.tokens_per_event === null
                    ? "—"
                    : formatNumber(data.events.tokens_per_event)
                }
                hint="Measured mean, charged once each"
              />
            </StatGrid>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              {formatNumber(data.articles.unclustered)} articles are still unclustered, of{" "}
              {formatNumber(data.articles.total)} stored.
            </p>
          </Panel>

          <Panel title="Shared impacts">
            <StatGrid>
              <Stat label="Written" value={formatNumber(data.impacts.complete)} />
              <Stat label="Failed" value={formatNumber(data.impacts.failed)} />
              <Stat label="Tokens" value={formatNumber(data.impacts.tokens)} />
              <Stat
                label="Briefing appearances"
                value={formatNumber(data.digest_items_total)}
                hint="Served by the impacts above"
              />
            </StatGrid>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Before phase 2 each of those appearances was its own model call. Now they are served
              by {formatNumber(data.impacts.complete)} shared explanations
              {data.impacts.complete > 0 && data.digest_items_total > 0
                ? ` — ${(data.digest_items_total / data.impacts.complete).toFixed(1)} appearances per explanation`
                : ""}
              .
            </p>
          </Panel>

          <Panel title="Translation">
            <StatGrid>
              <Stat label="Cached" value={formatNumber(data.translations.complete)} />
              <Stat label="Languages" value={formatNumber(data.translations.languages)} />
              <Stat label="Failed" value={formatNumber(data.translations.failed)} />
              <Stat label="Tokens" value={formatNumber(data.translations.tokens)} />
            </StatGrid>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              One row per event per language, however many readers see it.
            </p>
          </Panel>

          <Panel title="Cluster v2 agreement">
            {data.cluster_shadow.decided === 0 ? (
              <p className="text-[13.5px] leading-relaxed text-muted-foreground">
                Not measured yet. Nothing has been clustered with shadow mode on in this window, so
                there is no agreement rate to report — and no basis for enabling the skip.
              </p>
            ) : (
              <>
                <StatGrid>
                  <Stat
                    label="Same — agreed"
                    value={`${data.cluster_shadow.same_agreed}/${data.cluster_shadow.same_decided}`}
                    hint="Wrong here merges unrelated stories"
                  />
                  <Stat
                    label="Different — agreed"
                    value={`${data.cluster_shadow.diff_agreed}/${data.cluster_shadow.diff_decided}`}
                    hint="Wrong here splits one story"
                  />
                  <Stat label="Decided" value={formatNumber(data.cluster_shadow.decided)} />
                  <Stat label="Agreed" value={formatNumber(data.cluster_shadow.agreed)} />
                </StatGrid>
                <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  Split deliberately: a wrong &ldquo;different&rdquo; costs one extra analysis and
                  shows up as a duplicate. A wrong &ldquo;same&rdquo; merges two unrelated stories
                  and is invisible to the reader who receives it. The two need different standards
                  of proof before the skip goes on.
                </p>
              </>
            )}
          </Panel>

          <Panel title={`AI ledger · last ${data.window_days} days`}>
            {Object.keys(data.ai_usage).length === 0 ? (
              <p className="text-[13.5px] text-muted-foreground">
                No recorded usage in this window.
              </p>
            ) : (
              <StatGrid>
                {Object.entries(data.ai_usage).map(([capability, tokens]) => (
                  <Stat key={capability} label={capability} value={formatNumber(tokens)} />
                ))}
              </StatGrid>
            )}
          </Panel>
        </div>
      ) : null}
    </>
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

/**
 * Month-to-date AI spend against the ceiling that stops the pipeline.
 *
 * The projection is the point of the panel. A balance answers "how much have I
 * spent", which is reassuring right up until it isn't; the projection answers
 * "does this month finish", which is the question whose answer can still be
 * acted on. So the warning tone keys off the forecast crossing the ceiling, not
 * off the percentage used — 40% on the 4th is worse than 80% on the 28th.
 */
function AiSpendPanel({ data }: { data: AiSpend }) {
  const willExhaust = data.exhaustionDate !== null;
  const exhausted = data.spentUsd >= data.ceilingUsd;

  return (
    <div className="mb-5">
      <Panel
        title="AI spend · this month"
        note="The pipeline refuses new model calls once the ceiling is reached, so this is the number that decides whether briefings keep being produced. Set it with AI_MONTHLY_COST_USD."
      >
        <StatGrid>
          <Stat
            label="Spent"
            value={usd(data.spentUsd)}
            hint={
              data.ceilingResolved
                ? `${data.usedPct.toFixed(1)}% of the ${usd(data.ceilingUsd)} ceiling`
                : `${data.usedPct.toFixed(1)}% of the built-in ${usd(data.ceilingUsd)} default`
            }
          />
          <Stat
            label="Projected month end"
            value={usd(data.projectedUsd)}
            hint={
              exhausted
                ? "Ceiling reached — model calls are being refused"
                : willExhaust
                  ? `Ceiling reached ${new Date(data.exhaustionDate as string).toLocaleDateString()}`
                  : "Stays inside the ceiling at the current rate"
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
            value={usd(data.inFlightUsd)}
            hint="Reserved at estimate, not yet settled"
          />
        </StatGrid>

        {exhausted || willExhaust || data.unpricedCalls > 0 || !data.ceilingResolved ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {exhausted ? (
              <Pill tone="signal">Ceiling reached — raise AI_MONTHLY_COST_USD to resume</Pill>
            ) : willExhaust ? (
              <Pill tone="signal">On track to stop before month end</Pill>
            ) : null}
            {!data.ceilingResolved ? (
              <Pill tone="outline">
                AI_MONTHLY_COST_USD not readable here — showing the built-in default
              </Pill>
            ) : null}
            {data.unpricedCalls > 0 ? (
              <Pill tone="outline">
                {formatNumber(data.unpricedCalls)} calls have no rate card — spend is understated
              </Pill>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function UnitEconomicsPanel({ data }: { data: UnitEconomics }) {
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

  return (
    <div className="mb-5 space-y-5">
      <Panel
        title={`Unit economics · last ${data.windowDays} days`}
        note="Revenue, refunds and Stripe fees are prorated over each subscription's service period. Annual sales therefore appear as earned monthly value, not a one-day windfall."
      >
        <StatGrid>
          <Stat label="Paying customers" value={formatNumber(data.payingCustomersAllTime)} />
          <Stat
            label="Next evidence check"
            value={data.nextMilestone ? `${data.nextMilestone} customers` : "100 reached"}
          />
          <Stat label="Monthly overhead" value={usd(data.overheadMonthlyUsd)} />
          <Stat label="Shared AI in window" value={usd(data.sharedAiUsd)} />
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
        note="Enter the monthly equivalent from each real invoice. For a $10 annual domain, enter $0.83. Zero is valid for a free plan; blank means unknown and keeps margin hidden."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {COST_PROVIDERS.map((provider) => (
            <Field key={provider} label={PROVIDER_LABELS[provider]}>
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
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save overhead"}
          </Button>
          {save.isSuccess ? <span className="text-[12px] text-muted-foreground">Saved</span> : null}
        </div>
        <ErrorNote error={save.error} />
      </Panel>
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

/**
 * The prepaid balance, and the date it runs out.
 *
 * Placed above month-to-date spend because it answers the earlier question. The
 * monthly ceiling asks "does this month finish"; the balance asks "do I need to
 * buy more credit", and no answer to the first is worth much when the provider
 * account is empty. Both stay on the page: the ceiling is what refuses a call
 * locally, the balance is what the provider refuses on.
 *
 * The runway, not the remaining dollars, carries the warning tone. "$3.20 left"
 * reads as fine and is fine at ten cents a day; at two dollars a day it is a
 * weekend away from stopping the pipeline, and only the rate can tell them apart.
 */
function AiCreditPanel({ data }: { data: AiCreditView }) {
  const { credit, windows } = data;
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const add = useConsoleMutation(addAiTopup, [
    ["admin", "ai-credit"],
    ["admin", "ai-topups"],
  ]);

  const submit = () => {
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(amount.trim())) return;
    add.mutate({ data: { amountUsd: amount.trim(), note: note.trim() || undefined } });
    setAmount("");
    setNote("");
  };

  const runway =
    credit.daysRemaining === null
      ? "Not measured yet"
      : credit.daysRemaining < 1
        ? "Under a day"
        : `${credit.daysRemaining.toFixed(credit.daysRemaining < 10 ? 1 : 0)} days`;

  return (
    <div className="mb-5 space-y-5">
      <Panel
        title="AI credit · balance"
        note="What you have topped up, minus what the pipeline has spent since. Every figure is counted from the ledger; the runway is the one projection here and it is withheld until there is an hour of history behind it."
      >
        <StatGrid>
          <Stat
            label="Remaining"
            value={credit.topups === 0 ? "—" : usd(credit.remainingUsd)}
            hint={
              credit.topups === 0
                ? "No top-up recorded yet"
                : `${usd(credit.spentUsd)} of ${usd(credit.toppedUpUsd)} used`
            }
          />
          <Stat
            label="Runs out in"
            value={runway}
            hint={
              credit.runsOutAt
                ? `Around ${new Date(credit.runsOutAt).toLocaleDateString()}`
                : credit.burnUsdPerDay === 0
                  ? "Nothing spent in the last 7 days"
                  : "Needs an hour of history"
            }
            estimate={credit.runsOutAt !== null}
          />
          <Stat
            label="Burn"
            value={credit.burnUsdPerDay === null ? "—" : `${usd(credit.burnUsdPerDay)}/day`}
            hint="Measured over the last 7 days"
          />
          <Stat
            label="In flight"
            value={usd(credit.inFlightUsd)}
            hint="Reserved at estimate, not yet settled"
          />
        </StatGrid>

        {credit.status !== "ok" || credit.unfundedSpentUsd > 0 || credit.unpricedCalls > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {credit.status === "exhausted" ? (
              <Pill tone="signal">Credit spent — top up before the provider refuses calls</Pill>
            ) : null}
            {credit.status === "low" ? (
              <Pill tone="signal">Running low — recharge soon</Pill>
            ) : null}
            {credit.status === "unrecorded" ? (
              <Pill tone="outline">
                No top-up recorded — add one below to start tracking the balance
              </Pill>
            ) : null}
            {credit.unfundedSpentUsd > 0 ? (
              <Pill tone="outline">
                {usd(credit.unfundedSpentUsd)} spent before the first top-up, not counted here
              </Pill>
            ) : null}
            {credit.unpricedCalls > 0 ? (
              <Pill tone="outline">
                {formatNumber(credit.unpricedCalls)} calls have no rate card — spend is understated
              </Pill>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {/* Absent when the window aggregate failed. An empty grid would read as
          "nothing spent", which is a different claim from "not measured". */}
      {windows.length > 0 ? (
        <Panel
          title="Spend by window"
          note="The same ledger, sliced by how recently it was spent. Settled figures are measured token counts; in-flight is what open reservations authorized."
        >
          <StatGrid>
            {windows.map((w) => (
              <Stat
                key={w.key}
                label={SPEND_WINDOW_LABELS[w.key]}
                value={usd(w.spentUsd)}
                hint={`${formatNumber(w.calls)} calls · ${formatNumber(w.tokens)} tokens`}
              />
            ))}
          </StatGrid>
        </Panel>
      ) : null}

      <Panel
        title="Record a top-up"
        note="Enter what the provider actually charged you, not the balance it advertised. A $5 purchase is 5."
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
            <Button onClick={submit} disabled={add.isPending || amount.trim() === ""}>
              {add.isPending ? "Recording…" : "Record top-up"}
            </Button>
          </div>
        </div>
        <ErrorNote error={add.error} />
      </Panel>

      <TopupHistory />
    </div>
  );
}

/**
 * Every deposit, most recent first.
 *
 * Deleting is a hard delete rather than a reversing entry: this table records
 * what was paid, and a mistyped amount was never paid. The audit log keeps it.
 */
function TopupHistory() {
  const confirm = useConfirm();
  const topups = useQuery({
    queryKey: ["admin", "ai-topups"],
    queryFn: () => listAiTopups(),
    staleTime: 60_000,
  });
  const remove = useConsoleMutation(deleteAiTopup, [
    ["admin", "ai-credit"],
    ["admin", "ai-topups"],
  ]);

  if (!topups.data || topups.data.length === 0) return null;

  return (
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
  );
}
