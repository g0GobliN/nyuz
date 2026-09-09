import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Info } from "lucide-react";
import { useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/admin")({
  component: Admin,
  head: () => ({ meta: [{ title: "Pipeline — nyuz" }] }),
});

const UNMEASURED = [
  "Open rate",
  "Click rate",
  "Unsubscribe rate",
  "AI cost per active user",
  "Gross margin estimate",
];

function Admin() {
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
        sub="Counts below are live table totals, not a local fixture set."
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

function PipelineTab({ data }: { data: Overview }) {
  const funnel: [string, number][] = [
    ["Articles collected", data.content.articles],
    ["Events detected", data.content.events],
    ["Events in the last day", data.content.events24h],
    ["Awaiting analysis", data.content.pendingEvents],
    ["Failed events", data.content.failedEvents],
    ["Briefings sent", data.delivery.digestsByStatus.sent],
  ];
  const max = Math.max(1, ...funnel.map(([, n]) => n));

  const queues = [
    {
      name: "Analysis",
      depth: data.content.pendingEvents,
      detail: `${data.content.failedEvents} failed`,
      state:
        data.content.pendingEvents > 40
          ? "degraded"
          : data.content.pendingEvents > 0
            ? "healthy"
            : "idle",
    },
    {
      name: "Digest slots",
      depth: data.delivery.digestsByStatus.scheduled + data.delivery.digestsByStatus.generating,
      detail: `${data.delivery.digestsByStatus.ready} ready`,
      state:
        data.delivery.digestsByStatus.failed > 0
          ? "degraded"
          : data.delivery.digestsByStatus.scheduled > 0
            ? "healthy"
            : "idle",
    },
    {
      name: "Email delivery",
      depth: data.delivery.deliveriesByStatus.queued,
      detail: `${data.delivery.deliveriesByStatus.sent} sent`,
      state:
        data.delivery.deliveriesByStatus.failed > 0
          ? "degraded"
          : data.delivery.deliveriesByStatus.queued > 0
            ? "healthy"
            : "idle",
    },
  ] as const;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Corpus
        </h2>
        <div className="mt-6 space-y-1">
          {funnel.map(([label, value], i) => (
            <div key={label} className="flex items-center gap-4">
              <span className="w-44 shrink-0 text-[13.5px]">{label}</span>
              <span className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                <span
                  className="block h-full rounded-md transition-[width] duration-1000"
                  style={{
                    width: `${Math.max(4, (value / max) * 100)}%`,
                    background: i > 3 ? "var(--signal)" : "var(--muted)",
                  }}
                />
              </span>
              <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
                {value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
          {data.content.articles.toLocaleString()} articles collapsed into{" "}
          {data.content.events.toLocaleString()} events. Analysis ran{" "}
          {data.ai.analysedEvents.toLocaleString()} times, not once per article — that ratio is the
          cost model.
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
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-surface-2 px-5 py-3.5"
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  q.state === "healthy"
                    ? "bg-signal"
                    : q.state === "degraded"
                      ? "bg-foreground"
                      : "bg-border",
                )}
              />
              <span className="flex-1 text-[14px]">{q.name}</span>
              <span className="text-[12.5px] tabular-nums text-muted-foreground">
                depth {q.depth}
              </span>
              <span className="w-28 text-right text-[12.5px] text-muted-foreground">
                {q.detail}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Failed jobs
        </h2>
        {data.delivery.deliveriesByStatus.failed === 0 && data.content.failedEvents === 0 ? (
          <p className="mt-5 flex items-center gap-2 text-[14px]">
            <Check className="h-4 w-4 text-signal" /> No failed deliveries or events.
          </p>
        ) : (
          <div className="mt-5 space-y-3 text-[14px]">
            {data.delivery.deliveriesByStatus.failed > 0 ? (
              <p>
                {data.delivery.deliveriesByStatus.failed} email{" "}
                {data.delivery.deliveriesByStatus.failed === 1 ? "delivery" : "deliveries"} failed.
                The digest cron retries queued rows up to five times.
              </p>
            ) : null}
            {data.content.failedEvents > 0 ? (
              <p className="text-muted-foreground">
                {data.content.failedEvents} events are marked failed and will not be retried
                automatically.
              </p>
            ) : null}
          </div>
        )}
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
  if (loading) return <Loading label="Reading recent events" />;

  return (
    <div>
      <PipelineFreshness refreshing={refreshing} updatedAt={updatedAt} />
      {!events || events.length === 0 ? (
        <p className="mt-5 text-[13px] text-muted-foreground">No events yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {events.map((e) => (
            <article key={e.id} className="rounded-3xl border border-hairline bg-surface p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  {e.id.slice(0, 8)}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px]",
                    e.status === "complete"
                      ? "border-signal/40 text-signal"
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
                  Importance {e.importance.toFixed(1)}
                </span>
              </div>

              <p className="mt-3 text-[16px] font-medium leading-snug">{e.title}</p>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-muted-foreground">
                <span className="tabular-nums">{e.sources} sources clustered</span>
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

function PipelineFreshness({ refreshing, updatedAt }: { refreshing: boolean; updatedAt: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const secondsAgo = updatedAt > 0 ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1_000)) : 0;
  const updatedLabel = secondsAgo < 2 ? "Updated just now" : `Updated ${secondsAgo}s ago`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <span
          className={cn("h-2 w-2 rounded-full bg-signal", refreshing && "animate-pulse")}
          aria-hidden
        />
        Live
      </span>
      <span aria-live="polite">{refreshing ? "Checking for changes…" : updatedLabel}</span>
      <span>Refreshes every 10 seconds while this tab is open.</span>
    </div>
  );
}

function statusLabel(status: EventStatus): string {
  if (status === "complete") return "Complete";
  if (status === "analysing") return "Analysing";
  if (status === "failed") return "Failed";
  return "Pending";
}

function EconomicsTab({ data }: { data: Overview }) {
  const layers = [
    {
      tier: "Measured",
      label: "Shared event intelligence",
      note: "Tokens spent understanding an event once, for everybody.",
      value: data.ai.analysisTokens.toLocaleString(),
    },
    {
      tier: "Measured",
      label: "Personal digest generation",
      note: "Tokens spent writing why_it_matters. Grows with readers, not with coverage.",
      value: data.ai.generationTokens.toLocaleString(),
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
      </section>

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-[var(--hairline)] sm:grid-cols-3">
          {[
            ["Total users", data.users.total.toLocaleString()],
            ["Active in 7 days", data.users.active7.toLocaleString()],
            ["Paid", data.revenue.paid.toLocaleString()],
          ].map(([label, value]) => (
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
          These stay empty until real metering exists. A plausible-looking figure here would be
          worse than none.
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
