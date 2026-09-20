/* eslint-disable prettier/prettier */

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ConsoleHeader,
  ErrorNote,
  Field,
  Loading,
  Panel,
  Pill,
  Stat,
  StatGrid,
  formatDate,
  formatDateTime,
  formatNumber,
  inputClass,
  useConsoleMutation,
} from "@/components/admin/shell";
import { Button, Chip } from "@/components/kit";
import {
  addEconomicsManualCost,
  getEconomicsHistory,
  getEconomicsOverview,
  listEconomicsManualCosts,
  syncCloudflareBillableUsage,
  syncSupabaseUsage,
} from "@/lib/server/economics";

export const Route = createFileRoute("/admin/economics")({ component: EconomicsPage });

const PERIODS = [7, 30, 90] as const;

function jpy(value: number | null): string {
  return value === null ? "Unavailable" : `¥${Math.round(value / 100).toLocaleString()}`;
}

function usd(value: number | null): string {
  return value === null ? "Unavailable" : `$${value.toFixed(2)}`;
}

function EconomicsPage() {
  const [days, setDays] = useState<number>(30);
  const overview = useQuery({
    queryKey: ["admin", "economics", days],
    queryFn: () => getEconomicsOverview({ data: { days } }),
    staleTime: 60_000,
  });
  const history = useQuery({
    queryKey: ["admin", "economics-history", days],
    queryFn: () => getEconomicsHistory({ data: { days } }),
    staleTime: 60_000,
  });
  const manual = useQuery({
    queryKey: ["admin", "economics-manual"],
    queryFn: () => listEconomicsManualCosts(),
    staleTime: 60_000,
  });
  const sync = useConsoleMutation(syncCloudflareBillableUsage, [
    ["admin", "economics", String(days)],
    ["admin", "economics-manual"],
  ]);
  const syncSupabase = useConsoleMutation(syncSupabaseUsage, [
    ["admin", "economics", String(days)],
  ]);

  return (
    <>
      <ConsoleHeader
        title="Economics"
        sub="Usage-first operating economics. Every figure is labelled by source, scope, and certainty; unavailable provider data is not replaced with a budget guess."
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map((period) => (
            <Chip key={period} active={days === period} onClick={() => setDays(period)}>
              {period} days
            </Chip>
          ))}
          <Button size="sm" variant="outline" onClick={() => sync.mutate({ data: { days } })} disabled={sync.isPending}>
            {sync.isPending ? "Syncing…" : "Sync Cloudflare"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => syncSupabase.mutate({ data: {} })} disabled={syncSupabase.isPending}>
            {syncSupabase.isPending ? "Syncing…" : "Sync Supabase"}
          </Button>
        </div>
      </ConsoleHeader>

      <ErrorNote error={overview.error} />
      <ErrorNote error={history.error} />
      <ErrorNote error={manual.error} />
      <ErrorNote error={sync.error} />
      <ErrorNote error={syncSupabase.error} />
      {overview.isLoading ? <Loading label="Reading economics" /> : null}
      {overview.data ? <Overview data={overview.data} /> : null}
      {history.data ? <Reconciliation data={history.data} /> : null}
      <ManualCosts rows={manual.data ?? []} />
    </>
  );
}

function Overview({ data }: { data: Awaited<ReturnType<typeof getEconomicsOverview>> }) {
  return (
    <div className="space-y-5">
      <Panel
        title={`${formatDate(data.period.from)} – ${formatDate(data.period.to)} · UTC`}
        note={data.foundationReady ? "Provider snapshots and manual fallbacks are available." : "The accounting foundation is not applied yet. Ledger metrics remain visible; provider and manual cost metrics are unavailable."}
      >
        <div className="flex flex-wrap gap-2">
          <Pill tone={data.foundationReady ? "outline" : "signal"}>
            {data.foundationReady ? "Snapshots ready" : "Foundation pending"}
          </Pill>
          <Pill tone="outline">Operating economics</Pill>
          <Pill tone="outline">JPY reporting</Pill>
        </div>
      </Panel>

      <StatGrid>
        <Stat label="Net revenue · JPY" value={jpy(data.revenue.netJpy)} hint={data.revenue.netUsd === 0 ? "Exact zero · Stripe live ledger" : "Stripe live ledger · USD converted at captured rate"} />
        <Stat label="Operating cost · JPY" value={jpy(data.costs.totalOperatingJpy)} hint={data.costs.operatingStatus === "incomplete" ? "Incomplete provider coverage" : "Imported and captured"} />
        <Stat label="Projected month-end · JPY" value={jpy(data.costs.projectedOperatingJpy)} estimate hint="Current-period usage basis" />
        <Stat label="Fully loaded P/L" value="Unavailable" hint="Shared allocation is not defensible yet" />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Revenue and operating cost" note="Revenue is imported from the live Stripe ledger. Operating cost includes captured infrastructure, manual costs, and AI only when a JPY conversion is available.">
          <dl className="divide-y divide-[var(--hairline)] text-[13px]">
            <Row label="Gross revenue" value={usd(data.revenue.grossUsd)} />
            <Row label="Refunds" value={usd(data.revenue.refundsUsd)} />
            <Row label="Stripe fees" value={usd(data.revenue.stripeFeesUsd)} />
            <Row label="Fixed/shared infrastructure" value={jpy(data.costs.fixedJpy)} />
            <Row label="Variable infrastructure" value={jpy(data.costs.variableJpy)} />
            <Row label="Total operating cost" value={jpy(data.costs.totalOperatingJpy)} note={data.costs.operatingStatus} />
          </dl>
        </Panel>

        <Panel title="Usage" note="Operational volume first. These are Nyuz system measures, not AI measures; unavailable telemetry stays unavailable.">
          <dl className="divide-y divide-[var(--hairline)] text-[13px]">
            <Row label="Active users" value={formatNumber(data.usage.activeUsers)} />
            <Row label="Briefings generated" value={data.usage.briefingsGenerated === null ? "Unavailable" : formatNumber(data.usage.briefingsGenerated)} />
            <Row label="Articles ingested" value={data.usage.articlesIngested === null ? "Unavailable" : formatNumber(data.usage.articlesIngested)} />
            <Row label="Events created" value={data.usage.eventsCreated === null ? "Unavailable" : formatNumber(data.usage.eventsCreated)} />
            <Row label="Emails sent / push delivered" value={`${formatNumber(data.usage.deliveries.email)} / ${formatNumber(data.usage.deliveries.push)}`} />
            <Row label="Storage growth" value="Unavailable" note="provider telemetry pending" />
          </dl>
        </Panel>
      </div>

      <Panel title="Cost composition" note="AI is one provider category. Its share is shown explicitly rather than defining the operating model.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {data.providers.filter((provider) => provider.provider !== "Stripe" && provider.provider !== "AI providers").map((provider) => <section key={provider.provider} className="rounded-xl border border-hairline bg-surface-2 p-3"><div className="text-[12px] font-medium capitalize">{provider.provider}</div><div className="mt-1 text-lg tabular-nums">{jpy(provider.actualJpy)}</div><div className="mt-1 text-[11px] text-muted-foreground">{provider.statuses.join(", ")}</div></section>)}
          <section className="rounded-xl border border-hairline bg-surface-2 p-3"><div className="text-[12px] font-medium">AI providers</div><div className="mt-1 text-lg tabular-nums">{jpy(data.costs.aiJpy)}</div><div className="mt-1 text-[11px] text-muted-foreground">{data.costs.aiSharePct === null ? "Share unavailable" : `${data.costs.aiSharePct.toFixed(1)}% of operating cost`} · {formatNumber(data.ai.calls)} calls</div></section>
        </div>
      </Panel>

      <Panel title="Free-user economics" note="Marginal cost is shown by operational category. Unknown infrastructure and delivery attribution stays unavailable rather than being spread across the whole user base.">
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-hairline bg-surface-2 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Free users</h3>
              <Pill tone="outline">{formatNumber(data.users.activeFree)} active / {formatNumber(data.users.freeTotal)} total</Pill>
            </div>
            <dl className="mt-3 divide-y divide-[var(--hairline)] text-[13px]">
              <Row label="Compute" value={jpy(data.users.freeCost.computeJpy)} />
              <Row label="Database" value={jpy(data.users.freeCost.databaseJpy)} />
              <Row label="Storage" value={jpy(data.users.freeCost.storageJpy)} />
              <Row label="Egress" value={jpy(data.users.freeCost.egressJpy)} />
              <Row label="Email / delivery" value={jpy(data.users.freeCost.emailJpy)} />
              <Row label="AI" value={usd(data.users.freeCost.aiUsd)} note="directly attributed" />
              <Row label="Total marginal cost" value={jpy(data.users.freeCost.totalJpy)} note={data.users.freeCost.status} />
            </dl>
          </section>
          <section className="rounded-xl border border-hairline bg-surface-2 p-4">
            <h3 className="font-semibold">What is measured</h3>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">AI usage is attributable to the free cohort where the ledger records plan <code>uno</code>. Compute, database, storage, egress, and delivery need cohort-level telemetry before they can be priced honestly.</p>
            <p className="mt-3 text-[12px] text-muted-foreground">Status: {data.users.freeCost.status}. This is not a fully-loaded allocation.</p>
          </section>
        </div>
      </Panel>

      <Panel title="Plan economics" note="Each paid plan shows revenue, payment fees, infrastructure, delivery, and AI separately. The contribution remains incomplete until non-AI attribution is available.">
        <div className="grid gap-4 md:grid-cols-2">
          {(["plura", "omni"] as const).map((plan) => {
            const row = data.users.plans[plan];
            return (
              <section key={plan} className="rounded-xl border border-hairline bg-surface-2 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold capitalize">{plan}</h3>
                  <Pill tone="outline">{formatNumber(data.users.paid[plan])} active</Pill>
                </div>
                <dl className="mt-3 divide-y divide-[var(--hairline)] text-[13px]">
                  <Row label="Revenue" value={usd(row.revenueUsd)} />
                  <Row label="Stripe fees" value={usd(row.stripeFeesUsd)} />
                  <Row label="Infrastructure usage" value={jpy(row.infrastructureJpy)} />
                  <Row label="Delivery" value={usd(row.deliveryUsd)} />
                  <Row label="AI" value={usd(row.aiUsd)} />
                  <Row label="Known direct costs" value={usd(row.stripeFeesUsd + row.aiUsd)} />
                  <Row label="Marginal contribution" value={usd(row.contributionUsd)} note={row.contributionStatus === "incomplete" ? "incomplete attribution" : row.contributionStatus} />
                </dl>
              </section>
            );
          })}
        </div>
      </Panel>

      <Panel title="Infrastructure providers" note="Cloudflare, Supabase, Resend, domain, other, and AI are shown as operating categories. Scope and latest capture stay visible beside every imported value.">
        {data.providers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No provider snapshots yet. Cloudflare, Supabase, Resend, domain, and other providers require an imported snapshot or explicit manual fallback.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-[12.5px]">
              <thead className="border-b border-hairline text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr><th className="pb-2 pr-4">Provider</th><th className="pb-2 pr-4">Services</th><th className="pb-2 pr-4">Usage</th><th className="pb-2 pr-4">Scope</th><th className="pb-2 pr-4">Actual JPY</th><th className="pb-2 pr-4">Status</th><th className="pb-2">Last sync</th></tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.providers.map((provider) => (
                  <tr key={provider.provider}>
                    <td className="py-3 pr-4 font-medium">{provider.provider}</td>
                    <td className="py-3 pr-4">{provider.services === 0 ? "—" : provider.services}</td>
                    <td className="max-w-xs py-3 pr-4 text-[11px] text-muted-foreground">{Object.entries(provider.usage).map(([key, value]) => `${key}: ${typeof value === "number" ? formatNumber(value) : value ?? "—"}`).join(" · ") || "Unavailable"}</td>
                    <td className="py-3 pr-4">{provider.scope}</td>
                    <td className="py-3 pr-4 tabular-nums">{jpy(provider.actualJpy)}</td>
                    <td className="py-3 pr-4"><Pill tone={provider.statuses.includes("unavailable") ? "signal" : "outline"}>{provider.statuses.join(", ")}</Pill></td>
                    <td className="py-3 text-muted-foreground">{provider.latestSync ? formatDateTime(provider.latestSync) : "Unavailable"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="AI details" note="AI is an operating category, not the product's accounting center. Change its behavior in Admin → AI runtime; Economics only reports its status and usage.">
        <dl className="grid gap-x-6 divide-y divide-[var(--hairline)] text-[13px] sm:grid-cols-2 sm:divide-y-0">
          <Row label="Provider status" value={data.ai.killSwitchOn ? "Blocked" : "Allowed"} />
          <Row label="Calls" value={formatNumber(data.ai.calls)} />
          <Row label="Tokens" value={data.ai.tokens === null ? "Unavailable" : formatNumber(data.ai.tokens)} />
          <Row label="Priced calls" value={formatNumber(data.ai.pricedCalls)} />
          <Row label="Unpriced calls" value={formatNumber(data.costs.unpricedAiCalls)} warn={data.costs.unpricedAiCalls > 0} />
          <Row label="Projected month-end spend" value={usd(data.costs.projectedAiUsd)} note="projected" />
          <Row label="AI cost share" value={data.costs.aiSharePct === null ? "Unavailable" : `${data.costs.aiSharePct.toFixed(1)}%`} />
        </dl>
      </Panel>

      <Panel title="Data quality">
        {data.warnings.length === 0 ? <p className="text-[13px] text-muted-foreground">All displayed metrics have complete source coverage for this period.</p> : <ul className="list-disc space-y-2 pl-5 text-[13px] text-muted-foreground">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </Panel>
    </div>
  );
}

function Reconciliation({ data }: { data: Awaited<ReturnType<typeof getEconomicsHistory>> }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Break-even model" note="Scenario only. Fixed cost and plan contribution are shown with their accounting assumptions; unavailable inputs remain unavailable.">
        <div className="grid gap-4 sm:grid-cols-2">
          {(["plura", "omni"] as const).map((plan) => {
            const model = data.breakEven[plan];
            return <section key={plan} className="rounded-xl border border-hairline bg-surface-2 p-4"><div className="font-semibold capitalize">{plan}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{model.usersNeeded === null ? "Unavailable" : `${model.usersNeeded} users`}</div><p className="mt-1 text-[12px] text-muted-foreground">Fixed captured cost: {jpy(data.breakEven.fixedJpy)} · contribution/user basis: {jpy(model.contributionPerUserMinor)}</p></section>;
          })}
        </div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">{data.breakEven.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
      </Panel>
      <Panel title="Reconciliation history" note="Imported snapshots are immutable and idempotent. Manual costs remain separate; sync runs show freshness and failures.">
        <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-[12.5px]"><thead className="border-b border-hairline text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground"><tr><th className="pb-2 pr-4">Captured</th><th className="pb-2 pr-4">Provider</th><th className="pb-2 pr-4">Scope</th><th className="pb-2 pr-4">JPY</th><th className="pb-2">Status</th></tr></thead><tbody className="divide-y divide-hairline">{data.snapshots.slice(0, 12).map((row) => <tr key={row.id}><td className="py-2 pr-4">{formatDateTime(row.captured_at)}</td><td className="py-2 pr-4">{row.provider} / {row.service}</td><td className="py-2 pr-4">{row.scope}</td><td className="py-2 pr-4 tabular-nums">{jpy(row.jpy_amount_minor)}</td><td className="py-2"><Pill tone={row.status === "unavailable" || row.status === "incomplete" ? "signal" : "outline"}>{row.status}</Pill></td></tr>)}</tbody></table></div>
        <div className="mt-4 border-t border-hairline pt-3 text-[12px] text-muted-foreground">Recent sync attempts: {data.syncRuns.length === 0 ? "none recorded" : data.syncRuns.map((run) => `${run.provider} ${run.status} (${run.imported_count})`).join(" · ")}</div>
      </Panel>
    </div>
  );
}

function ManualCosts({ rows }: { rows: Awaited<ReturnType<typeof listEconomicsManualCosts>> }) {
  const [provider, setProvider] = useState("");
  const [service, setService] = useState("");
  const [currency, setCurrency] = useState("JPY");
  const [amount, setAmount] = useState("");
  const [jpyAmount, setJpyAmount] = useState("");
  const [notes, setNotes] = useState("");
  const add = useConsoleMutation(addEconomicsManualCost, [["admin", "economics"], ["admin", "economics-manual"]]);

  const submit = () => {
    const amountMinor = Math.round(Number(amount) * 100);
    const jpyMinor = jpyAmount.trim() === "" ? null : Math.round(Number(jpyAmount) * 100);
    if (!provider.trim() || !service.trim() || !Number.isFinite(amountMinor) || amountMinor < 0) return;
    add.mutate({
      data: {
        provider: provider.trim(), service: service.trim(), scope: "application",
        periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
        periodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
        amountMinor, currency, jpyAmountMinor: jpyMinor,
        conversionRate: currency === "JPY" ? 1 : null,
        conversionDate: currency === "JPY" ? new Date().toISOString().slice(0, 10) : null,
        conversionSource: currency === "JPY" ? "manual currency-native amount" : null,
        classification: "fixed", reference: null, notes: notes.trim() || null,
      },
    });
    setAmount(""); setJpyAmount(""); setNotes("");
  };

  return (
    <Panel title="Manual fallback" note="Use only where provider billing cannot be imported. Non-JPY entries need an explicit captured JPY conversion before they count in reporting totals.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <Field label="Provider"><input className={inputClass} value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Domain" /></Field>
        <Field label="Service"><input className={inputClass} value={service} onChange={(event) => setService(event.target.value)} placeholder="Registrar" /></Field>
        <Field label="Amount"><input className={inputClass} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1200" inputMode="decimal" /></Field>
        <Field label="Currency"><input className={inputClass} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} /></Field>
        <Field label="JPY amount"><input className={inputClass} value={jpyAmount} onChange={(event) => setJpyAmount(event.target.value)} placeholder="1200" inputMode="decimal" /></Field>
        <Button onClick={submit} disabled={add.isPending}>{add.isPending ? "Saving…" : "Add cost"}</Button>
      </div>
      <Field label="Notes"><input className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Invoice or allocation note" /></Field>
      <ErrorNote error={add.error} />
      {rows && rows.length > 0 ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-[12.5px]"><thead className="border-b border-hairline text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground"><tr><th className="pb-2 pr-4">Provider</th><th className="pb-2 pr-4">Service</th><th className="pb-2 pr-4">Original</th><th className="pb-2 pr-4">JPY</th><th className="pb-2">Period</th></tr></thead><tbody className="divide-y divide-hairline">{rows.map((row) => <tr key={row.id}><td className="py-3 pr-4">{row.provider}</td><td className="py-3 pr-4">{row.service}</td><td className="py-3 pr-4">{(row.amount_minor / 100).toFixed(2)} {row.currency}</td><td className="py-3 pr-4">{jpy(row.jpy_amount_minor)}</td><td className="py-3 text-muted-foreground">{formatDate(row.period_start)} – {formatDate(row.period_end)}</td></tr>)}</tbody></table></div> : null}
    </Panel>
  );
}

function Row({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return <div className="flex items-baseline justify-between gap-4 py-2.5"><dt className="text-muted-foreground">{label}{note ? <span className="ml-2 text-[11px]">{note}</span> : null}</dt><dd className={warn ? "font-semibold text-signal tabular-nums" : "tabular-nums"}>{value}</dd></div>;
}
