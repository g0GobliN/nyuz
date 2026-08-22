import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ConsoleHeader,
  ErrorNote,
  Loading,
  Panel,
  Pill,
  Stat,
  StatGrid,
  formatNumber,
} from "@/components/admin/shell";
import { Chip } from "@/components/kit";
import { getDailyCounts, getOverview, getTopicUptake } from "@/lib/server/analytics";
import type { DailyCount } from "@/lib/supabase/types";

export const Route = createFileRoute("/admin/")({ component: OverviewPage });

const RANGES = [7, 30, 90] as const;
type Metric = keyof Omit<DailyCount, "day">;

const METRICS: { key: Metric; label: string }[] = [
  { key: "signups", label: "Signups" },
  { key: "events", label: "Stories" },
  { key: "digests", label: "Briefings" },
  { key: "deliveries", label: "Deliveries" },
];

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function OverviewPage() {
  const [days, setDays] = useState<number>(30);
  const [metric, setMetric] = useState<Metric>("signups");

  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => getOverview(),
    // The page is a snapshot, not a live monitor. A minute of staleness saves
    // ~30 count queries on every navigation back to this tab.
    staleTime: 60_000,
  });

  const daily = useQuery({
    queryKey: ["admin", "daily", days],
    queryFn: () => getDailyCounts({ data: days }),
    staleTime: 60_000,
  });

  const topics = useQuery({
    queryKey: ["admin", "topics"],
    queryFn: () => getTopicUptake(),
    staleTime: 300_000,
  });

  if (overview.isLoading) return <Loading label="Counting" />;
  if (overview.error) {
    return (
      <>
        <ConsoleHeader title="Overview" />
        <ErrorNote error={overview.error} />
      </>
    );
  }

  const d = overview.data;
  if (!d) return <Loading label="Counting" />;

  return (
    <>
      <ConsoleHeader
        title="Overview"
        sub="Every figure below is counted in Postgres at request time. Nothing here is sampled or cached beyond a minute, except where a number is marked as an estimate."
      />

      <div className="space-y-5">
        <Panel title="People">
          <StatGrid>
            <Stat label="Total accounts" value={formatNumber(d.users.total)} />
            <Stat
              label="New this week"
              value={formatNumber(d.users.new7)}
              hint={`${formatNumber(d.users.new30)} in 30 days`}
            />
            <Stat
              label="Active this week"
              value={formatNumber(d.users.active7)}
              hint={
                d.users.total > 0
                  ? `${pct(d.users.active7 / d.users.total)} of accounts`
                  : undefined
              }
            />
            <Stat
              label="Finished onboarding"
              value={formatNumber(d.users.onboarded)}
              hint={
                d.users.total > 0
                  ? `${formatNumber(d.users.total - d.users.onboarded)} never did`
                  : undefined
              }
            />
          </StatGrid>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <Pill tone="outline">{formatNumber(d.users.admins)} staff</Pill>
            <Pill tone="outline">{formatNumber(d.users.banned)} banned</Pill>
            <Link
              to="/admin/users"
              className="underline decoration-hairline underline-offset-4 hover:text-foreground"
            >
              Manage users
            </Link>
          </div>
        </Panel>

        <Panel
          title="Revenue"
          note="MRR multiplies list price by active paid subscription. It knows nothing about discounts, refunds or failed charges, so treat it as a ceiling rather than a bank balance."
        >
          <StatGrid>
            <Stat
              label="MRR"
              value={`$${formatNumber(d.revenue.mrrEstimate)}`}
              estimate
              hint={d.revenue.pricesOverridden ? "using console price overrides" : "at list price"}
            />
            <Stat
              label="Paying"
              value={formatNumber(d.revenue.paid)}
              hint={`${pct(d.revenue.conversion)} of accounts`}
            />
            <Stat label="Personal" value={formatNumber(d.revenue.byPlan.personal)} />
            <Stat label="Pro" value={formatNumber(d.revenue.byPlan.pro)} />
          </StatGrid>
        </Panel>

        <Panel title="Trend">
          <div className="flex flex-wrap items-center gap-2">
            {METRICS.map((m) => (
              <Chip key={m.key} active={metric === m.key} onClick={() => setMetric(m.key)}>
                {m.label}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
            {RANGES.map((r) => (
              <Chip key={r} active={days === r} onClick={() => setDays(r)}>
                {r}d
              </Chip>
            ))}
          </div>

          <div className="mt-6">
            {daily.isLoading ? (
              <Loading label="Loading trend" />
            ) : daily.error ? (
              <ErrorNote error={daily.error} />
            ) : (
              <BarChart rows={daily.data ?? []} metric={metric} />
            )}
          </div>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Pipeline">
            <dl className="divide-y divide-[var(--hairline)] text-[13.5px]">
              <Row label="Sources" value={formatNumber(d.content.sources)} />
              <Row
                label="Active sources"
                value={formatNumber(d.content.activeSources)}
                warn={d.content.failingSources > 0}
                note={
                  d.content.failingSources > 0
                    ? `${d.content.failingSources} failing repeatedly`
                    : undefined
                }
              />
              <Row label="Articles ingested" value={formatNumber(d.content.articles)} />
              <Row
                label="Stories"
                value={formatNumber(d.content.events)}
                note={`${formatNumber(d.content.events24h)} in the last day`}
              />
              <Row
                label="Awaiting analysis"
                value={formatNumber(d.content.pendingEvents)}
                warn={d.content.pendingEvents > 500}
              />
              <Row
                label="Analysis failed"
                value={formatNumber(d.content.failedEvents)}
                warn={d.content.failedEvents > 0}
              />
            </dl>
          </Panel>

          <Panel title="Delivery">
            <dl className="divide-y divide-[var(--hairline)] text-[13.5px]">
              <Row
                label="Send success"
                value={d.delivery.successRate === null ? "—" : pct(d.delivery.successRate)}
                note={d.delivery.successRate === null ? "nothing sent yet" : undefined}
                warn={d.delivery.successRate !== null && d.delivery.successRate < 0.95}
              />
              <Row label="Sent" value={formatNumber(d.delivery.deliveriesByStatus.sent)} />
              <Row label="Queued" value={formatNumber(d.delivery.deliveriesByStatus.queued)} />
              <Row
                label="Failed"
                value={formatNumber(d.delivery.deliveriesByStatus.failed)}
                warn={d.delivery.deliveriesByStatus.failed > 0}
              />
              <Row
                label="Bounced"
                value={formatNumber(d.delivery.deliveriesByStatus.bounced)}
                warn={d.delivery.deliveriesByStatus.bounced > 0}
              />
              <Row
                label="Briefings ready, unsent"
                value={formatNumber(d.delivery.digestsByStatus.ready)}
              />
              <Row
                label="Briefings failed"
                value={formatNumber(d.delivery.digestsByStatus.failed)}
                warn={d.delivery.digestsByStatus.failed > 0}
              />
            </dl>
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="AI spend"
            note="Token counts recorded by the pipeline. Analysis is paid once per story no matter how many people receive it; generation is paid per briefing. That ratio is the whole cost model — if analysis is not dominant, the dedup step is not working."
          >
            <dl className="divide-y divide-[var(--hairline)] text-[13.5px]">
              <Row label="Analysis tokens" value={formatNumber(d.ai.analysisTokens)} />
              <Row label="Generation tokens" value={formatNumber(d.ai.generationTokens)} />
              <Row label="Stories analysed" value={formatNumber(d.ai.analysedEvents)} />
              <Row
                label="Tokens per story"
                value={
                  d.ai.analysedEvents > 0
                    ? formatNumber(Math.round(d.ai.analysisTokens / d.ai.analysedEvents))
                    : "—"
                }
              />
            </dl>
            <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
              Sums are computed over the most recent 10,000 rows per table, so on a busy project
              these are a floor rather than a total.
            </p>
          </Panel>

          <Panel title="Reader feedback">
            <dl className="divide-y divide-[var(--hairline)] text-[13.5px]">
              <Row label="Useful" value={formatNumber(d.feedback.useful)} />
              <Row label="Not useful" value={formatNumber(d.feedback.not_useful)} />
              <Row label="Not interested" value={formatNumber(d.feedback.not_interested)} />
            </dl>

            <h3 className="mt-7 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Topic uptake
            </h3>
            {topics.isLoading ? (
              <Loading label="Loading topics" />
            ) : (
              <TopicBars rows={topics.data ?? []} />
            )}
          </Panel>
        </div>

        <Panel title="Content">
          <StatGrid>
            <Stat label="Blog posts" value={formatNumber(d.blog.total)} />
            <Stat label="Published" value={formatNumber(d.blog.published)} />
            <Stat label="Drafts" value={formatNumber(d.blog.drafts)} />
            <Stat label="Post views" value={formatNumber(d.blog.views)} />
          </StatGrid>
        </Panel>

        <p className="pt-1 text-[11.5px] text-muted-foreground">
          Counted {new Date(d.generatedAt).toLocaleTimeString()}.
        </p>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  warn?: boolean | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">
        {label}
        {note ? <span className="ml-2 text-[11.5px]">{note}</span> : null}
      </dt>
      {/* A number needing attention gets weight and the accent, not a second
          colour — there is no green/amber/red vocabulary in this design. */}
      <dd className={warn ? "font-semibold tabular-nums text-signal" : "tabular-nums"}>{value}</dd>
    </div>
  );
}

/**
 * Hand-rolled because it is forty lines of SVG and the alternative is shipping a
 * charting library to every console visitor for one bar chart. Bars are drawn as
 * percentages of the container so it reflows without a resize observer.
 */
function BarChart({ rows, metric }: { rows: DailyCount[]; metric: Metric }) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) {
    return (
      <p className="py-8 text-[13px] text-muted-foreground">No activity in this window yet.</p>
    );
  }

  const values = rows.map((r) => r[metric]);
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, v) => sum + v, 0);
  const peak = rows[values.indexOf(max)];

  return (
    <div>
      <div className="flex items-baseline gap-5">
        <p className="font-serif text-[30px] leading-none tabular-nums">{formatNumber(total)}</p>
        <p className="text-[12.5px] text-muted-foreground">
          total · peak {formatNumber(max)}
          {peak ? ` on ${shortDate(peak.day)}` : ""}
        </p>
      </div>

      <div className="mt-5 flex h-40 items-end gap-[2px]">
        {rows.map((row) => {
          const value = row[metric];
          const height = (value / max) * 100;
          return (
            <div
              key={row.day}
              className="group relative h-full flex-1"
              title={`${shortDate(row.day)} — ${formatNumber(value)}`}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-muted transition-colors duration-150 group-hover:bg-signal"
                style={{ height: `${Math.max(height, value > 0 ? 2 : 0.5)}%` }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{shortDate(first.day)}</span>
        <span>{shortDate(last.day)}</span>
      </div>
    </div>
  );
}

function shortDate(day: string): string {
  const d = new Date(day);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TopicBars({ rows }: { rows: { label: string; slug: string; users: number }[] }) {
  if (rows.length === 0) {
    return <p className="mt-4 text-[13px] text-muted-foreground">No topics followed yet.</p>;
  }
  const max = Math.max(...rows.map((r) => r.users), 1);
  return (
    <ul className="mt-4 space-y-2">
      {rows.map((row) => (
        <li key={row.slug} className="flex items-center gap-3 text-[13px]">
          <span className="w-32 shrink-0 truncate text-muted-foreground">{row.label}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-signal"
              style={{ width: `${(row.users / max) * 100}%` }}
            />
          </span>
          <span className="w-10 shrink-0 text-right tabular-nums">{formatNumber(row.users)}</span>
        </li>
      ))}
    </ul>
  );
}
