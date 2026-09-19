import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Clock3, Radio, RefreshCw, ShieldAlert, Truck } from "lucide-react";
import {
  ConsoleHeader,
  ErrorNote,
  Loading,
  Panel,
  Pill,
  Stat,
  StatGrid,
  formatDateTime,
  formatNumber,
} from "@/components/admin/shell";
import {
  getOperationsSnapshot,
  type OperationsStage,
  type OperationsState,
} from "@/lib/server/operations";

export const Route = createFileRoute("/admin/operations")({ component: OperationsPage });

function OperationsPage() {
  const query = useQuery({
    queryKey: ["admin", "operations"],
    queryFn: () => getOperationsSnapshot(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (query.isLoading) return <Loading label="Reading pipeline health" />;
  if (query.error) {
    return (
      <>
        <ConsoleHeader title="Operations" sub="Current deterministic pipeline health." />
        <ErrorNote error={query.error} />
      </>
    );
  }
  if (!query.data) return <Loading label="Reading pipeline health" />;
  const d = query.data;

  return (
    <>
      <ConsoleHeader
        title="Operations"
        sub="The deterministic pipeline first. Counts are bounded operational snapshots from Postgres; AI is an optional subsystem, not the health signal."
      >
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <Pill tone={d.state === "healthy" ? "outline" : "signal"}>{stateLabel(d.state)}</Pill>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Refresh operations"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </ConsoleHeader>

      <div className="space-y-5">
        <Panel title={stateLabel(d.state)} note={d.stateReason}>
          <div className="grid gap-4 sm:grid-cols-3">
            <ActivityItem
              icon={Activity}
              label="Last successful pipeline"
              value={formatDateTime(d.activity.lastSuccessfulPipeline)}
            />
            <ActivityItem
              icon={Clock3}
              label="Last cron tick"
              value={formatDateTime(d.activity.lastCronTick)}
              detail={d.activity.lastCronStage ?? "No stage recorded"}
            />
            <ActivityItem
              icon={ShieldAlert}
              label="Oldest unprocessed"
              value={formatDateTime(d.activity.oldestUnprocessed)}
              detail={ageLabel(d.activity.oldestUnprocessed)}
            />
          </div>
        </Panel>

        <StatGrid>
          <Stat
            label="Articles in"
            value={formatNumber(d.throughput.incomingHour)}
            hint="last hour"
          />
          <Stat
            label="Articles processed"
            value={formatNumber(d.throughput.processedHour)}
            hint={
              d.throughput.keepingUp === null
                ? "no input measured"
                : d.throughput.keepingUp
                  ? "keeping up this hour"
                  : "behind input this hour"
            }
          />
          <Stat
            label="Fresh backlog"
            value={formatNumber(totalBacklog(d))}
            hint={ageLabel(d.activity.oldestUnprocessed)}
          />
          <Stat label="Stale retained" value={formatNumber(totalStale(d))} hint="not active work" />
          <Stat
            label="Active sources"
            value={formatNumber(d.sources.active)}
            hint={
              d.sources.failing > 0
                ? `${d.sources.failing} repeatedly failing`
                : `${d.sources.total} total`
            }
          />
        </StatGrid>

        <Panel
          title="Pipeline flow"
          note="These are lifecycle queues, not invented funnel states. The counts show where content is accumulating right now."
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <FlowItem label="Articles" value={d.throughput.incomingDay} />
            <FlowItem
              label="Fresh unclustered"
              value={d.backlog.unclusteredArticles.count}
              age={d.backlog.unclusteredArticles.ageMinutes ?? null}
            />
            <FlowItem
              label="Fresh events"
              value={d.backlog.pendingEvents.count}
              age={d.backlog.pendingEvents.ageMinutes ?? null}
            />
            <FlowItem
              label="Enrichment pending"
              value={d.backlog.enrichmentPending.count}
              age={d.backlog.enrichmentPending.ageMinutes ?? null}
            />
            <FlowItem label="Reads ready" value={d.readers.deterministicAvailable} />
            <FlowItem label="Matched" value={d.readers.understood} />
            <FlowItem
              label="Briefings ready"
              value={d.delivery.readyBriefings}
              age={d.backlog.readyBriefings.ageMinutes ?? null}
            />
            <FlowItem
              label="Deliveries queued"
              value={d.delivery.unsentDeliveries}
              age={d.backlog.failedDeliveries.ageMinutes ?? null}
            />
          </div>
        </Panel>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,1fr)]">
          <Panel
            title="Logical pipeline stages"
            note="Cron shares physical triggers, so this table shows the stage actually dispatched at the latest tick."
          >
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-hairline text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="pb-2 font-medium">Stage</th>
                    <th className="pb-2 font-medium">State</th>
                    <th className="pb-2 font-medium">Last run</th>
                    <th className="pb-2 text-right font-medium">/ hour</th>
                    <th className="pb-2 text-right font-medium">Backlog</th>
                    <th className="pb-2 text-right font-medium">Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {d.stages.map((stage) => (
                    <StageRow key={stage.key} stage={stage} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {d.stages.map((stage) => (
                <MobileStageCard key={stage.key} stage={stage} />
              ))}
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel
              title="Throughput"
              note="A direct comparison for the current hour and the last 24 hours."
            >
              <div className="space-y-3 text-[13px]">
                <Compare
                  label="Articles arriving"
                  value={d.throughput.incomingHour}
                  note="last hour"
                />
                <Compare
                  label="Articles attached to events"
                  value={d.throughput.processedHour}
                  note="last hour"
                />
                <div className="border-t border-hairline pt-3">
                  <Compare
                    label="Articles arriving"
                    value={d.throughput.incomingDay}
                    note="24 hours"
                  />
                  <Compare
                    label="Articles attached to events"
                    value={d.throughput.processedDay}
                    note="24 hours"
                  />
                </div>
              </div>
              <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
                {d.throughput.keepingUp === null
                  ? "There is not enough recent input to judge the rate yet."
                  : d.throughput.keepingUp
                    ? "Processing is at least matching this hour's incoming article rate."
                    : "Processing is slower than incoming articles this hour; watch the unclustered age."}
              </p>
            </Panel>
            <Panel title="Processing flags">
              <div className="space-y-2 text-[12.5px]">
                {d.flags.length === 0 ? (
                  <p className="text-muted-foreground">No processing flags are installed.</p>
                ) : (
                  d.flags.map((flag) => (
                    <div key={flag.key} className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px]">{flag.key}</span>
                      <Pill tone={flag.enabled ? "outline" : "neutral"}>
                        {flag.enabled ? "On" : "Off"}
                      </Pill>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Panel
            title="Enrichment"
            note={`Batch limit: ${d.enrichment.batchLimit}. Robots-blocked is policy, not a failure.`}
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline">
              <Stat label="Status" value={d.enrichment.enabled ? "On" : "Off"} />
              <Stat label="Pending" value={formatNumber(d.enrichment.pending)} />
              <Stat label="Enriched" value={formatNumber(d.enrichment.enriched24h)} hint="24h" />
              <Stat
                label="Evidence units"
                value={formatNumber(d.enrichment.evidenceUnits24h)}
                hint="24h"
              />
              <Stat label="Blocked" value={formatNumber(d.enrichment.blocked24h)} hint="24h" />
              <Stat label="Failed" value={formatNumber(d.enrichment.failed24h)} hint="24h" />
            </div>
            <Link
              to="/admin/sources"
              className="mt-4 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Inspect sources <ArrowRight className="h-3 w-3" />
            </Link>
          </Panel>
          <Panel
            title="Read quality"
            note="Current cached Understand rows and deterministic fallback availability. Detailed distributions are queued for the next slice."
          >
            <div className="space-y-2 text-[13px]">
              <Compare
                label="Deterministic reads available"
                value={d.readers.deterministicAvailable}
              />
              <Compare label="Cached Understand ready" value={d.readers.understood} />
              <Compare label="Awaiting Understand" value={d.readers.awaiting} />
              <Compare label="Understand failed" value={d.readers.failed} />
            </div>
            <Link
              to="/admin/operations"
              className="mt-4 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Reader diagnostics <ArrowRight className="h-3 w-3" />
            </Link>
          </Panel>
          <Panel
            title="Delivery"
            note="A ready briefing and a queued delivery are different queues; both can age independently."
          >
            <div className="space-y-2 text-[13px]">
              <Compare label="Briefings ready" value={d.delivery.readyBriefings} />
              <Compare label="Deliveries queued" value={d.delivery.unsentDeliveries} />
              <Compare label="Sent" value={d.delivery.sent24h} note="24h" />
              <Compare label="Failed" value={d.delivery.failed24h} note="24h" />
              <Compare
                label="Success rate"
                value={
                  d.delivery.successRate24h === null
                    ? "—"
                    : `${(d.delivery.successRate24h * 100).toFixed(1)}%`
                }
              />
            </div>
            <Link
              to="/admin/users"
              className="mt-4 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Inspect user delivery history <ArrowRight className="h-3 w-3" />
            </Link>
          </Panel>
        </div>

        <Panel
          title="Stale retained work"
          note="Historical rows remain available for history, dedupe and related context, but are excluded from active processing after the 72h horizon."
        >
          <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-2 lg:grid-cols-5">
            <StaleStat label="Unclustered articles" metric={d.backlog.unclusteredArticles} />
            <StaleStat label="Pending events" metric={d.backlog.pendingEvents} />
            <StaleStat label="Enrichment candidates" metric={d.backlog.enrichmentPending} />
            <StaleStat label="Ready briefings" metric={d.backlog.readyBriefings} />
            <StaleStat label="Queued deliveries" metric={d.backlog.failedDeliveries} />
          </div>
        </Panel>

        <Panel
          title="Cron status"
          note="Latest status only. Full execution history needs bounded run persistence and is planned next."
        >
          {d.cron.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No cron status has been recorded yet.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {d.cron.map((row) => (
                <div key={row.key} className="rounded-xl border border-hairline p-3">
                  <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                    {row.key.replace("cron:", "")}
                  </p>
                  <p className="mt-2 text-[13px] font-medium capitalize">{row.status}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatDateTime(row.updatedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <Radio className="h-3.5 w-3.5" /> Snapshot generated {formatDateTime(d.generatedAt)}.{" "}
          <Truck className="ml-2 h-3.5 w-3.5" />{" "}
          <Link to="/admin/sources" className="hover:text-foreground">
            Source health
          </Link>
        </p>
      </div>
    </>
  );
}

function ActivityItem({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-2 p-4">
      <p className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-2 text-[14px] font-medium tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-[11.5px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function FlowItem({ label, value, age }: { label: string; value: number; age?: number | null }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-2 p-3">
      <p className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-[19px] font-semibold tabular-nums">{formatNumber(value)}</p>
      {age !== undefined && age !== null ? (
        <p className="mt-1 text-[11px] text-muted-foreground">oldest {formatAge(age)}</p>
      ) : null}
    </div>
  );
}

function MobileStageCard({ stage }: { stage: OperationsStage }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[13px] font-medium">{stage.label}</p>
        <Pill
          tone={
            stage.state === "healthy" ? "outline" : stage.state === "idle" ? "neutral" : "signal"
          }
        >
          {stage.state}
        </Pill>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px]">
        <div>
          <p className="text-muted-foreground">Last run</p>
          <p className="mt-0.5">{formatDateTime(stage.lastRun)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Oldest</p>
          <p className="mt-0.5">{ageLabel(stage.oldestWaiting)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Processed / hour</p>
          <p className="mt-0.5 tabular-nums">{formatNumber(stage.processedHour)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Backlog</p>
          <p className="mt-0.5 tabular-nums">{formatNumber(stage.backlog)}</p>
        </div>
      </div>
    </div>
  );
}

function StageRow({ stage }: { stage: OperationsStage }) {
  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="py-2.5 font-medium">{stage.label}</td>
      <td className="py-2.5">
        <Pill
          tone={
            stage.state === "healthy" ? "outline" : stage.state === "idle" ? "neutral" : "signal"
          }
        >
          {stage.state}
        </Pill>
      </td>
      <td className="py-2.5 text-muted-foreground">{formatDateTime(stage.lastRun)}</td>
      <td className="py-2.5 text-right tabular-nums">{formatNumber(stage.processedHour)}</td>
      <td className="py-2.5 text-right tabular-nums">{formatNumber(stage.backlog)}</td>
      <td className="py-2.5 text-right text-muted-foreground">{ageLabel(stage.oldestWaiting)}</td>
    </tr>
  );
}

function Compare({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">
        {label}
        {note ? <span className="ml-1 text-[11px]">· {note}</span> : null}
      </span>
      <span className="font-medium tabular-nums">
        {typeof value === "number" ? formatNumber(value) : value}
      </span>
    </div>
  );
}

function totalBacklog(data: {
  backlog: {
    unclusteredArticles: { count: number };
    pendingEvents: { count: number };
    enrichmentPending: { count: number };
    readyBriefings: { count: number };
    failedDeliveries: { count: number };
  };
}): number {
  return Object.values(data.backlog).reduce((sum, item) => sum + item.count, 0);
}

function totalStale(data: { backlog: Record<string, { staleCount: number }> }): number {
  return Object.values(data.backlog).reduce((sum, item) => sum + item.staleCount, 0);
}

function StaleStat({
  label,
  metric,
}: {
  label: string;
  metric: { staleCount: number; staleAgeMinutes: number | null };
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-2 p-3">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">{formatNumber(metric.staleCount)}</p>
      <p className="text-[11px] text-muted-foreground">
        {metric.staleAgeMinutes === null
          ? "no stale rows"
          : `oldest ${formatAge(metric.staleAgeMinutes)}`}
      </p>
    </div>
  );
}

function stateLabel(state: OperationsState): string {
  return state === "partial_outage"
    ? "Partial outage"
    : state.charAt(0).toUpperCase() + state.slice(1);
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1_440)}d`;
}

function ageLabel(value: string | null): string {
  if (!value) return "No waiting item";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? `waiting ${formatAge(Math.max(0, Math.round((Date.now() - parsed) / 60_000)))}`
    : "Age unavailable";
}
