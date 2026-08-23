import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, Info, Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import { DashboardShell, PageHeader, StaffOnly } from "@/components/dashboard/shell";
import { Button, Chip } from "@/components/kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/admin")({
  component: Admin,
  head: () => ({ meta: [{ title: "Pipeline — nyuz" }] }),
});

/**
 * Operator view of the ingestion pipeline. Volume figures below are sample data
 * from the local fixture set. Business metrics stay unpopulated on purpose —
 * they are wired to instrumentation that does not exist yet, and inventing
 * numbers here would make the dashboard useless for the decision it exists for.
 */

const QUEUES = [
  { name: "Ingestion", depth: 412, rate: "1.2k/hr", state: "healthy" },
  { name: "Deduplication", depth: 88, rate: "980/hr", state: "healthy" },
  { name: "AI analysis", depth: 34, rate: "210/hr", state: "healthy" },
  { name: "Digest generation", depth: 0, rate: "idle", state: "idle" },
  { name: "Email delivery", depth: 0, rate: "idle", state: "idle" },
  { name: "Telegram delivery", depth: 3, rate: "retrying", state: "degraded" },
] as const;

const PIPELINE = [
  ["Articles collected", "8,412"],
  ["After normalisation", "8,120"],
  ["After deduplication", "1,946"],
  ["Events detected", "312"],
  ["Events scored", "312"],
  ["Events above threshold", "47"],
] as const;

const EVENTS = [
  {
    id: "18291",
    title: "OpenAI ships a lower-latency realtime model tier",
    sources: 38,
    importance: 9.4,
    topics: ["AI", "Developer Tools"],
    status: "Complete",
  },
  {
    id: "18288",
    title: "Cursor adds background agents that review pull requests",
    sources: 21,
    importance: 8.4,
    topics: ["Developer Tools", "AI"],
    status: "Complete",
  },
  {
    id: "18284",
    title: "NVIDIA signals shifting allocation for next-gen accelerators",
    sources: 47,
    importance: 8.2,
    topics: ["Chips", "AI"],
    status: "Re-scoring",
  },
] as const;

const UNMEASURED = [
  "Total users",
  "Active users",
  "Paid users",
  "Open rate",
  "Click rate",
  "Unsubscribe rate",
  "AI cost per active user",
  "MRR",
  "Gross margin estimate",
];

function Admin() {
  // Gated at the top rather than inside the body so that no fixture number, queue
  // depth or scoring detail is rendered for a customer even momentarily.
  return (
    <StaffOnly title="Pipeline">
      <PipelineView />
    </StaffOnly>
  );
}

function PipelineView() {
  const [tab, setTab] = useState<"pipeline" | "events" | "economics">("pipeline");
  const [retried, setRetried] = useState(false);

  return (
    <DashboardShell title="Pipeline">
      <PageHeader
        eyebrow="Operator view"
        title="What the pipeline is doing."
        sub="Volumes below come from the local fixture set. Nothing here is a production measurement."
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

      {tab === "pipeline" ? (
        <div className="space-y-5">
          <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Last 24 hours
            </h2>
            <div className="mt-6 space-y-1">
              {PIPELINE.map(([label, value], i) => {
                const pct = 100 - i * 15;
                return (
                  <div key={label} className="flex items-center gap-4">
                    <span className="w-44 shrink-0 text-[13.5px]">{label}</span>
                    <span className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                      <span
                        className="block h-full rounded-md transition-[width] duration-1000"
                        style={{
                          width: `${pct}%`,
                          background: i > 3 ? "var(--signal)" : "var(--muted)",
                        }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
                      {value}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
              8,412 articles collapsed into 312 events. The AI stage ran 312 times, not 8,412 — that
              ratio is the whole cost model.
            </p>
          </section>

          <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Queues
            </h2>
            <div className="mt-5 space-y-2">
              {QUEUES.map((q) => (
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
                          ? "bg-destructive"
                          : "bg-border",
                    )}
                  />
                  <span className="flex-1 text-[14px]">{q.name}</span>
                  <span className="text-[12.5px] tabular-nums text-muted-foreground">
                    depth {q.depth}
                  </span>
                  <span className="w-20 text-right text-[12.5px] text-muted-foreground">
                    {q.rate}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-destructive/30 bg-surface p-6 sm:p-7">
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> Failed jobs
            </h2>
            {retried ? (
              <p className="mt-5 flex items-center gap-2 text-[14px]">
                <Check className="h-4 w-4 text-signal" /> Requeued. No failing jobs.
              </p>
            ) : (
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <div className="flex-1">
                  <p className="text-[14px] font-medium">3 Telegram deliveries failed</p>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Chat unreachable · last attempt 04:12 · 2 retries remaining
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setRetried(true)}>
                  <RotateCw className="h-3.5 w-3.5" /> Requeue
                </Button>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "events" ? (
        <div className="space-y-3">
          {EVENTS.map((e) => (
            <article key={e.id} className="rounded-3xl border border-hairline bg-surface p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  Event #{e.id}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px]",
                    e.status === "Complete"
                      ? "border-signal/40 text-signal"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {e.status === "Complete" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  {e.status}
                </span>
                <span className="ml-auto text-[12.5px] tabular-nums">
                  Importance {e.importance}
                </span>
              </div>

              <p className="mt-3 text-[16px] font-medium leading-snug">{e.title}</p>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-muted-foreground">
                <span className="tabular-nums">{e.sources} sources clustered</span>
                <span className="flex gap-1.5">
                  {e.topics.map((t) => (
                    <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">
                      {t}
                    </span>
                  ))}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-hairline pt-4 text-[12.5px]">
                <span className="text-muted-foreground">
                  Users matched · <span className="text-foreground">not instrumented</span>
                </span>
                <span className="text-muted-foreground">
                  Digests generated · <span className="text-foreground">not instrumented</span>
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {tab === "economics" ? (
        <div className="space-y-5">
          <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Cost layers
            </h2>
            <div className="mt-5 space-y-3">
              {[
                {
                  tier: "Low cost",
                  label: "Database and rules",
                  note: "Topic matching, scheduling, timezone maths, subscription checks. No model involved.",
                  fill: 12,
                },
                {
                  tier: "Medium",
                  label: "Shared event intelligence",
                  note: "Dedup, event extraction, classification, importance. Runs once per event regardless of subscriber count.",
                  fill: 42,
                },
                {
                  tier: "User-variable",
                  label: "Personal digest generation",
                  note: "Short generation per person per briefing. Grows with users.",
                  fill: 68,
                },
                {
                  tier: "Optional premium",
                  label: "Deep explanations",
                  note: "Stronger model, only on explicit request.",
                  fill: 92,
                },
              ].map((l) => (
                <div key={l.tier} className="rounded-2xl border border-hairline bg-surface-2 p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="text-[14px] font-medium">{l.label}</span>
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      {l.tier}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-1">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <span
                        key={i}
                        className="h-5 flex-1 rounded-[3px]"
                        style={{
                          background: i < Math.round(l.fill / 5) ? "var(--signal)" : "var(--muted)",
                          opacity: i < Math.round(l.fill / 5) ? 0.3 + i * 0.035 : 1,
                        }}
                      />
                    ))}
                  </div>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                    {l.note}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Info className="h-3.5 w-3.5" /> Awaiting instrumentation
            </h2>
            <p className="mt-4 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
              These are the numbers that decide whether the product is economically healthy. They
              stay empty until real metering is connected — a plausible-looking figure here would be
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
      ) : null}
    </DashboardShell>
  );
}
