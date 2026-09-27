import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, AlertTriangle, ArrowRight } from "lucide-react";
import { RadialGauge } from "@/components/admin/charts";
import { ConsoleHeader, ErrorNote, Loading, Panel, formatNumber } from "@/components/admin/shell";
import { buttonClass } from "@/components/kit";
import { getAiStatus, type AiRuntimeStatus } from "@/lib/server/ai-status";
import { getAiSpend, type AiSpend } from "@/lib/server/cost-intelligence";
import { percent, ratio, resetLabel, shortDate, usd } from "./-shared";

/**
 * Status tab — the operating state of the AI subsystem.
 *
 * One card, because this is the tab an operator opens in an incident: is anything
 * blocked, which cap is binding, and is there a control that fixes it. The
 * forecast line comes from the spend query so the gauge can say "stops on the
 * 14th" instead of leaving the operator to do the arithmetic themselves.
 *
 * The runtime-caps summary card the old cost page carried is deliberately gone:
 * Limits is now a sibling tab one click away, and a second read-only copy of
 * the same numbers was one more thing to keep in sync.
 */

export const Route = createFileRoute("/admin/ai/")({ component: StatusTab });

function StatusTab() {
  const aiStatus = useQuery({
    queryKey: ["admin", "ai-status"],
    queryFn: () => getAiStatus(),
    staleTime: 30_000,
  });
  const spend = useQuery({
    queryKey: ["admin", "ai-spend"],
    queryFn: () => getAiSpend(),
    staleTime: 60_000,
  });

  return (
    <>
      <ConsoleHeader
        title="AI status"
        sub="Current enforced limits and operating state. Each new reservation must also fit within the remaining caps."
      />

      <ErrorNote error={aiStatus.error} />
      <ErrorNote error={spend.error} />

      {aiStatus.isLoading || spend.isLoading ? <Loading label="Checking limits" /> : null}

      {aiStatus.data && !aiStatus.error ? (
        <AiStatusCard data={aiStatus.data} forecast={spend.data ?? undefined} />
      ) : !aiStatus.isLoading ? (
        <Panel title="AI status">Unknown — could not read runtime limits.</Panel>
      ) : null}
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
    <Panel
      title="Operating state"
      note="Derived from the caps in Limits and settled ledger spend. Nothing here gates a request directly — the reservation checks the caps at call time."
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
              Provider credit is {data.credit.status === "exhausted" ? "exhausted" : "running low"}.
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
                to="/admin/ai/limits"
                search={data.action.settingKey ? { setting: data.action.settingKey } : {}}
                className={buttonClass("outline", "sm")}
              >
                {data.action.label}
                <ArrowRight className="h-3 w-3" />
              </Link>
            ) : data.credit.status === "low" ||
              data.credit.status === "exhausted" ||
              data.credit.status === "unrecorded" ? (
              <Link
                to="/admin/ai/spend"
                hash="record-topup"
                className={buttonClass("primary", "sm")}
              >
                {data.credit.status === "unrecorded" ? "Record first top-up" : "Record top-up"}
                <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <Link to="/admin/ai/limits" search={{}} className={buttonClass("ghost", "sm")}>
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
          <Link to="/admin/ai/spend" hash="record-topup" className={buttonClass("outline", "sm")}>
            Record top-up
          </Link>
        </div>
      ) : data.credit.status === "exhausted" && !data.creditGateEnabled ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-[12px] text-muted-foreground">
          <p>
            Provider credit is exhausted, but the provider-credit gate is off, so this is advisory
            only — no AI call is being refused on this ground. Turn the gate on in Limits once
            funded, or record a top-up regardless to keep the balance accurate.
          </p>
          <Link to="/admin/ai/spend" hash="record-topup" className={buttonClass("outline", "sm")}>
            Record top-up
          </Link>
        </div>
      ) : null}
    </Panel>
  );
}
