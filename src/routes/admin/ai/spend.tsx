import { useIsFetching, useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ComparisonBars,
  DonutChart,
  ForecastTimeline,
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
  listAiTopups,
} from "@/lib/server/cost-intelligence";
import { SPEND_WINDOW_LABELS } from "@/lib/ai/credit";
import { creditDepletionLabel, resetLabel, shortDate, usd } from "./-shared";

/**
 * Spend tab — what the AI subsystem actually cost.
 *
 * Ledger spend against the monthly safety cap, provider credit against recorded
 * top-ups, and the per-feature breakdown. The cap itself is set on the Limits
 * tab; this tab reports what the caps are catching.
 *
 * Unit economics moved to /admin/economics, where the rest of the business P&L
 * lives, and the runtime-caps summary card moved to Status — everything else
 * from the old cost page is here unchanged.
 */

export const Route = createFileRoute("/admin/ai/spend")({ component: SpendTab });

function SpendTab() {
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
  const cost = useQuery({
    queryKey: ["admin", "cost"],
    queryFn: () => getCostIntelligence({ data: { days: 30 } }),
    staleTime: 60_000,
  });

  const data = cost.data;

  // Status and the sidebar card link here as #record-topup. The router scrolls
  // to the hash on arrival, but the panels above the form are still loading
  // then — once they render, the form is pushed two screens down. Scroll again
  // after the first load settles, once, so a later refetch never yanks the page.
  const hash = useLocation({ select: (location) => location.hash });
  // The page's own queries report loading from the first render; useIsFetching
  // then covers the ones children own (spend by feature, top-ups), which have
  // started by the time these finish.
  const fetching = useIsFetching({ queryKey: ["admin"] });
  const settled = !spend.isLoading && !creditView.isLoading && !cost.isLoading && fetching === 0;
  const scrolledToHash = useRef(false);
  useEffect(() => {
    if (!settled || scrolledToHash.current || hash !== "record-topup") return;
    scrolledToHash.current = true;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [settled, hash]);

  return (
    <>
      <ConsoleHeader
        title="AI spend"
        sub="Estimated provider credit, ledger spend and monthly safety-cap consumption."
      />

      <ErrorNote error={cost.error} />
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

      {cost.isLoading ? <Loading label="Counting" /> : null}

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
              <Pill tone="signal">Monthly safety cap reached — increase it in Limits</Pill>
            ) : null}
            {willExhaust ? <Pill tone="signal">On track to stop before month end</Pill> : null}
            {!data.ceilingResolved ? (
              <Pill tone="outline">Using built-in default safety cap — edit in Limits</Pill>
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
      <div className="mb-4 flex flex-wrap gap-2">
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
