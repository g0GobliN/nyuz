import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DashboardShell, PageHeader, StaffOnly } from "@/components/dashboard/shell";
import { Loading, LogoLoader, PanelLoading } from "@/components/loading";
import { Chip } from "@/components/kit";
import {
  getOverview,
  listRecentEvents,
  type Overview,
  type PipelineEvent,
} from "@/lib/server/analytics";
import type { EventStatus } from "@/lib/supabase/types";
import { sourceCount } from "@/lib/story";
import { formatScore } from "@/lib/score-format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/pipeline")({
  component: PipelinePage,
  head: () => ({ meta: [{ title: "Pipeline — nyuz" }] }),
});

/**
 * Email-channel metrics with no metering behind them.
 *
 * This list used to be longer. "AI cost per active user" and "Gross margin
 * estimate" were on it while the operating cost, per-plan economics and
 * break-even model already existed elsewhere in the product, which left staff
 * reading that this page could not measure numbers another page was showing.
 * What remains is only what genuinely has no source: open, click and
 * unsubscribe are pixel-tracked events and nothing here collects them.
 */
const UNMEASURED = ["Open rate", "Click rate", "Unsubscribe rate"];

function PipelinePage() {
  return (
    <StaffOnly title="Pipeline">
      <PipelineView />
    </StaffOnly>
  );
}

function PipelineView() {
  const [tab, setTab] = useState<"pipeline" | "events" | "economics">("pipeline");
  const overviewQ = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => getOverview(),
    staleTime: 30_000,
  });
  const eventsQ = useQuery({
    queryKey: ["admin", "pipeline-events"],
    queryFn: () => listRecentEvents(),
    staleTime: 30_000,
    enabled: tab === "events",
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  return (
    <DashboardShell title="Pipeline">
      <PageHeader
        eyebrow="Operator view"
        title="What the pipeline is doing."
        sub="Live counts. Where a figure is a lifetime total it says so, because a total that never falls cannot tell you whether something was fixed."
      />

      <div className="mb-7 flex flex-wrap gap-2">
        <Chip active={tab === "pipeline"} onClick={() => setTab("pipeline")}>
          Pipeline
        </Chip>
        <Chip active={tab === "events"} onClick={() => setTab("events")}>
          Events
        </Chip>
        <Chip active={tab === "economics"} onClick={() => setTab("economics")}>
          Economics
        </Chip>
      </div>

      {overviewQ.isLoading ? (
        <PanelLoading label="Counting the pipeline" />
      ) : overviewQ.error ? (
        <p className="text-[13px] text-muted-foreground">
          {overviewQ.error instanceof Error
            ? overviewQ.error.message
            : "Could not load pipeline counts."}
        </p>
      ) : overviewQ.data ? (
        <>
          {tab === "pipeline" ? <PipelineTab data={overviewQ.data} /> : null}
          {tab === "events" ? (
            <EventsTab
              events={eventsQ.data}
              loading={eventsQ.isLoading}
              refreshing={eventsQ.isFetching}
              updatedAt={eventsQ.dataUpdatedAt}
            />
          ) : null}
          {tab === "economics" ? <EconomicsTab data={overviewQ.data} /> : null}
        </>
      ) : null}
    </DashboardShell>
  );
}

/**
 * The pipeline, as three questions an operator actually asks.
 *
 * The previous version opened with a six-row "Corpus" funnel built from three
 * different time windows, which read as a 99.6% collapse that was really a
 * lifetime total next to a 24-hour one, and closed with a footnote describing
 * the AI cost model the product had already stopped using.
 *
 * Delivery leads now. It is the only stage whose failure reaches a reader, and
 * the rate was already being computed server-side and then thrown away.
 */
function PipelineTab({ data }: { data: Overview }) {
  const { health } = data;
  const attempted24h = health.sent24h + health.failed24h + health.bounced24h;
  const failing = health.successRate24h !== null && health.successRate24h < 0.95;

  const queues: {
    name: string;
    state: "healthy" | "attention" | "idle";
    primary: string;
    detail: string;
    age: string | null;
  }[] = [
    {
      name: "Analysis",
      state:
        health.pendingLive > 0 ? (health.failedEvents24h > 0 ? "attention" : "healthy") : "idle",
      primary: `${health.pendingLive.toLocaleString()} waiting`,
      detail: `${health.pendingExpired.toLocaleString()} past the 72h horizon and unreachable`,
      age: formatAge(health.oldestPendingMinutes),
    },
    {
      name: "Briefing generation",
      state: data.delivery.digestsByStatus.generating > 0 ? "healthy" : "idle",
      primary: `${data.delivery.digestsByStatus.generating.toLocaleString()} being written`,
      detail: `${data.delivery.digestsByStatus.ready.toLocaleString()} written and awaiting send`,
      age: null,
    },
    {
      name: "Delivery queue",
      state:
        health.failed24h > 0
          ? "attention"
          : data.delivery.deliveriesByStatus.queued > 0
            ? "healthy"
            : "idle",
      primary: `${data.delivery.deliveriesByStatus.queued.toLocaleString()} queued`,
      detail: `${health.failed24h.toLocaleString()} failed in the last 24h`,
      age: formatAge(health.oldestQueuedMinutes),
    },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Briefings reaching readers · last 24 hours
        </h2>

        <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
          <p
            className={cn(
              "font-serif text-[3.25rem] leading-none tabular-nums",
              failing && "text-signal",
            )}
          >
            {health.successRate24h === null ? "—" : `${Math.round(health.successRate24h * 100)}%`}
          </p>
          <p className="max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
            {health.successRate24h === null ? (
              "Nothing was attempted in the last 24 hours, so there is no rate to show yet."
            ) : (
              <>
                {health.sent24h.toLocaleString()} delivered · {health.failed24h.toLocaleString()}{" "}
                failed · {health.bounced24h.toLocaleString()} bounced. A delivery that exhausts its
                five attempts is finished, not queued.
              </>
            )}
          </p>
        </div>

        {health.oldestQueuedMinutes !== null ? (
          <p className="mt-5 text-[13px]">
            Oldest brief still waiting:{" "}
            <span className="tabular-nums">{formatAge(health.oldestQueuedMinutes)}</span>.
          </p>
        ) : null}

        {health.lastDeliveryError ? (
          <p className="mt-5 rounded-2xl border border-hairline bg-surface-2 px-4 py-3 font-mono text-[12px] leading-relaxed break-words">
            <span className="font-sans text-muted-foreground">Most recent failure: </span>
            {health.lastDeliveryError}
          </p>
        ) : null}

        <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
          {data.delivery.deliveriesByStatus.failed.toLocaleString()} deliveries have failed since
          this database was created. That lifetime figure is kept for context and is why the queue
          below judges itself on the last 24 hours instead — a total that never falls would leave
          the delivery queue reading &ldquo;degraded&rdquo; forever, whatever anyone fixed.
        </p>
      </section>

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Queues
        </h2>
        <div className="mt-5 space-y-2">
          {queues.map((q) => (
            <div
              key={q.name}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-hairline bg-surface-2 px-5 py-3.5"
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  q.state === "attention"
                    ? "bg-signal"
                    : q.state === "healthy"
                      ? "bg-foreground"
                      : "bg-border",
                )}
                aria-hidden
              />
              <span className="text-[14px]">{q.name}</span>
              <span className="text-[12.5px] tabular-nums text-muted-foreground">{q.primary}</span>
              {q.age ? (
                <span className="tabular-nums text-[12.5px] text-muted-foreground">
                  oldest {q.age}
                </span>
              ) : null}
              <span className="w-full text-[12px] text-muted-foreground sm:w-auto sm:flex-1 sm:text-right">
                {q.detail}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
          A briefing scheduled for a reader&rsquo;s 07:30 is written ahead of time, so scheduled
          slots are the pipeline working rather than a backlog, and depth alone cannot tell a busy
          queue from a stuck one — which is what the oldest age is for.
        </p>
      </section>

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Failures
        </h2>

        {health.failed24h === 0 &&
        health.failedEvents24h === 0 &&
        data.content.failedEvents === 0 ? (
          <p className="mt-5 flex items-center gap-2 text-[14px]">
            <Check className="h-4 w-4" /> Nothing failed in the last 24 hours.
          </p>
        ) : (
          <div className="mt-5 space-y-4 text-[13.5px] leading-relaxed">
            {health.failed24h > 0 ? (
              <div className="rounded-2xl border border-signal px-5 py-4">
                <p>
                  <span className="font-medium tabular-nums">
                    {health.failed24h.toLocaleString()}
                  </span>{" "}
                  {health.failed24h === 1 ? "delivery" : "deliveries"} failed in the last 24 hours.
                  These are not retried beyond five attempts, so a reader did not receive their
                  briefing.
                </p>
                {health.lastDeliveryError ? (
                  <p className="mt-2 font-mono text-[12px] break-words">
                    {health.lastDeliveryError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {health.failedEvents24h > 0 ? (
              <p>
                <span className="font-medium tabular-nums">
                  {health.failedEvents24h.toLocaleString()}
                </span>{" "}
                {health.failedEvents24h === 1 ? "event" : "events"} failed in the last 24 hours.
              </p>
            ) : null}

            {data.content.failedEvents > 0 ? (
              <p className="text-muted-foreground">
                {data.content.failedEvents.toLocaleString()} events have been abandoned since this
                database was created — a story detected, clustered, then dropped. They are not
                retried automatically, so each one is coverage a reader will never see. The figure
                is a lifetime total and only ever grows.
              </p>
            ) : null}

            {data.delivery.digestsByStatus.failed > 0 ? (
              <p className="text-muted-foreground">
                {data.delivery.digestsByStatus.failed.toLocaleString()} briefings have failed to
                generate (lifetime).
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Corpus · lifetime
        </h2>
        <div className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-hairline bg-[var(--hairline)] sm:grid-cols-3">
          {(
            [
              ["Articles collected", data.content.articles],
              ["Events detected", data.content.events],
              ["Events in the last day", data.content.events24h],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-surface px-5 py-4">
              <p className="text-[12.5px] text-muted-foreground">{label}</p>
              <p className="mt-1 font-serif text-xl tabular-nums">{value.toLocaleString()}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
          {data.content.articles.toLocaleString()} articles collapsed into{" "}
          {data.content.events.toLocaleString()} events. Only the middle row of the three above is a
          lifetime figure that the last-day figure sits inside, which is why they are no longer
          drawn as a sequence.
        </p>
      </section>
    </div>
  );
}

function EventsTab({
  events,
  loading,
  refreshing,
  updatedAt,
}: {
  events: PipelineEvent[] | undefined;
  loading: boolean;
  refreshing: boolean;
  updatedAt: number;
}) {
  const seen = useRef<Set<string>>(new Set());
  const [arrived, setArrived] = useState<Set<string>>(new Set());

  // What changed since the previous poll. Without this a 10-second refresh only
  // tells an operator that the poll ran, never that anything happened, which is
  // the entire question a live view is opened to answer.
  useEffect(() => {
    if (!events) return;
    const before = seen.current;
    const fresh = new Set<string>();
    for (const event of events) if (!before.has(event.id)) fresh.add(event.id);
    // The first load is not news: every row would be "new", which says nothing.
    if (before.size > 0) setArrived(fresh);
    seen.current = new Set(events.map((event) => event.id));
  }, [events]);

  if (loading) return <Loading label="Reading recent events" />;

  return (
    <div>
      <PipelineFreshness refreshing={refreshing} updatedAt={updatedAt} />
      {!events || events.length === 0 ? (
        <p className="mt-5 text-[13px] text-muted-foreground">No events yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {events.map((e) => (
            <article
              key={e.id}
              className={cn(
                "rounded-3xl border bg-surface p-6",
                arrived.has(e.id) ? "border-signal" : "border-hairline",
              )}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  {e.id.slice(0, 8)}
                </span>
                {arrived.has(e.id) ? (
                  <span className="rounded-full bg-signal px-2 py-0.5 text-[10.5px] font-medium text-signal-foreground">
                    New
                  </span>
                ) : null}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px]",
                    e.status === "failed"
                      ? "border-signal text-signal"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {e.status === "analysing" ? (
                    <LogoLoader className="h-3.5 w-3.5" tone="current" label="Analysing" />
                  ) : null}
                  {e.status === "complete" ? <Check className="h-3 w-3" /> : null}
                  {statusLabel(e.status)}
                </span>
                <span className="ml-auto text-[12.5px] tabular-nums">
                  Importance {formatScore(e.importance)}
                </span>
              </div>

              <p className="mt-3 text-[16px] font-medium leading-snug">{e.title}</p>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-muted-foreground">
                <span className="tabular-nums">{sourceCount(e.sources)} clustered</span>
                <span className="flex flex-wrap gap-1.5">
                  {e.topics.map((t) => (
                    <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">
                      {t}
                    </span>
                  ))}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * When the list was last refreshed, as a clock time.
 *
 * This used to run a one-second interval purely to re-render an "Updated Ns
 * ago" label, which meant a timer ticking forever on a page whose whole point is
 * to be left open. The poll already knows when it finished, and a clock time
 * needs no ticking to stay true.
 */
function PipelineFreshness({ refreshing, updatedAt }: { refreshing: boolean; updatedAt: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <span
          className={cn("h-2 w-2 rounded-full bg-foreground", refreshing && "animate-pulse")}
          aria-hidden
        />
        Watching
      </span>
      <span aria-live="polite">
        {refreshing
          ? "Checking for changes…"
          : updatedAt > 0
            ? `Last checked at ${new Date(updatedAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}`
            : "Waiting for the first check"}
      </span>
      <span>Every 10 seconds while this tab is open. New rows are marked.</span>
    </div>
  );
}

function statusLabel(status: EventStatus): string {
  if (status === "complete") return "Complete";
  if (status === "analysing") return "Analysing";
  if (status === "failed") return "Failed";
  return "Pending";
}

function formatAge(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function EconomicsTab({ data }: { data: Overview }) {
  const layers = [
    {
      tier: "Measured",
      label: "Briefings delivered · last 24 hours",
      note: "Deliveries that actually reached a reader in the last day.",
      value: data.health.sent24h.toLocaleString(),
    },
    {
      tier: "Measured",
      label: "Readers",
      note: "Accounts with activity in the last seven days.",
      value: data.users.active7.toLocaleString(),
    },
    {
      tier: "Estimate",
      label: "List-price MRR",
      note: "Active paid subscriptions times catalogue price. Not billed revenue.",
      value: data.revenue.mrrEstimate === 0 ? "—" : `$${data.revenue.mrrEstimate}`,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          What we can count
        </h2>
        <div className="mt-5 space-y-3">
          {layers.map((l) => (
            <div key={l.label} className="rounded-2xl border border-hairline bg-surface-2 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium">{l.label}</span>
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {l.tier}
                </span>
              </div>
              <p className="mt-3 font-serif text-2xl tabular-nums">{l.value}</p>
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">{l.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
          AI token totals used to lead this tab. They are gone because the deterministic pipeline is
          the product&rsquo;s path and AI is an optional enhancement, so tokens are no longer what
          this page is for. Operating cost by provider, per-plan economics and the break-even model
          live in the Console, which is where a real accounting question belongs.
        </p>
      </section>

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-[var(--hairline)] sm:grid-cols-3">
          {(
            [
              ["Total users", data.users.total.toLocaleString()],
              ["Active in 7 days", data.users.active7.toLocaleString()],
              ["Paid", data.revenue.paid.toLocaleString()],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-surface px-5 py-4">
              <p className="text-[12.5px] text-muted-foreground">{label}</p>
              <p className="mt-1 font-serif text-xl tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> Awaiting instrumentation
        </h2>
        <p className="mt-4 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
          Email engagement has no metering behind it, so these stay empty. A plausible-looking
          figure here would be worse than none.
        </p>
        <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-hairline bg-[var(--hairline)] sm:grid-cols-3">
          {UNMEASURED.map((m) => (
            <div key={m} className="bg-surface px-5 py-4">
              <p className="text-[12.5px] text-muted-foreground">{m}</p>
              <p className="mt-1 font-serif text-xl text-muted-foreground">—</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
