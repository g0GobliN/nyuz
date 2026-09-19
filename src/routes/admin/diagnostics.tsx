import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
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
  getOperationsDiagnostics,
  type OperationsDiagnostics,
} from "@/lib/server/operations-diagnostics";

export const Route = createFileRoute("/admin/diagnostics")({ component: DiagnosticsPage });

function DiagnosticsPage() {
  const query = useQuery({
    queryKey: ["admin", "diagnostics"],
    queryFn: () => getOperationsDiagnostics(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  if (query.isLoading) return <Loading label="Reading diagnostics" />;
  if (query.error)
    return (
      <>
        <ConsoleHeader title="Diagnostics" sub="Detailed deterministic pipeline diagnostics." />
        <ErrorNote error={query.error} />
      </>
    );
  if (!query.data) return <Loading label="Reading diagnostics" />;
  const d = query.data;
  return (
    <>
      <ConsoleHeader
        title="Diagnostics"
        sub="Bounded operational detail for Read quality, enrichment, sources, delivery and scheduler state."
      >
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label="Refresh diagnostics"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </ConsoleHeader>
      <div className="space-y-5">
        <ReadQuality data={d} />
        <Enrichment data={d} />
        <SourceHealth data={d} />
        <Delivery data={d} />
        <div className="grid gap-5 lg:grid-cols-2">
          <Scheduler data={d} />
          <Failures data={d} />
        </div>
        <RunHistory data={d} />
        <StoryIndex data={d} />
        <p className="text-[11.5px] text-muted-foreground">
          Snapshot generated {formatDateTime(d.generatedAt)}. Metrics are bounded to recent
          operational windows.
        </p>
      </div>
    </>
  );
}

function ReadQuality({ data }: { data: OperationsDiagnostics }) {
  const q = data.readQuality;
  return (
    <Panel
      title="Read quality"
      note="Evaluated current complete events. Word count is a supporting signal, not the quality definition."
    >
      <StatGrid>
        <Stat label="Evaluated" value={formatNumber(q.evaluated)} />
        <Stat
          label="Average words"
          value={q.averageWords === null ? "—" : formatNumber(q.averageWords)}
        />
        <Stat
          label="Median words"
          value={q.medianWords === null ? "—" : formatNumber(q.medianWords)}
        />
        <Stat label="P90 words" value={q.p90Words === null ? "—" : formatNumber(q.p90Words)} />
      </StatGrid>
      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        <MetricList title="Read modes" rows={Object.entries(q.modes)} />
        <MetricList title="Quality" rows={Object.entries(q.quality)} />
        <MetricList title="Word distribution" rows={Object.entries(q.words)} />
      </div>
      <div className="mt-4 rounded-xl border border-hairline p-4 text-[12.5px]">
        <p className="font-medium">Evidence visibility</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <span>
            Raw units <strong>{formatNumber(q.evidence.rawUnits)}</strong>
          </span>
          <span>
            Enriched articles <strong>{formatNumber(q.evidence.enrichedArticles)}</strong>
          </span>
          <span>
            Source words <strong>{formatNumber(q.evidence.sourceWords)}</strong>
          </span>
          <span>
            Selected/rejected{" "}
            <strong>
              {q.evidence.selectedUnits === null
                ? "not persisted"
                : `${q.evidence.selectedUnits}/${q.evidence.rejectedUnits ?? 0}`}
            </strong>
          </span>
        </div>
      </div>
    </Panel>
  );
}

function Enrichment({ data }: { data: OperationsDiagnostics }) {
  const e = data.enrichment;
  return (
    <Panel
      title="Enrichment diagnostics"
      note={`Status: ${e.enabled ? "on" : "off"}. Robots-blocked and robots-unknown remain policy outcomes, not generic failures. Batch limit ${e.batchLimit}.`}
    >
      <div className="flex flex-wrap gap-2">
        {Object.entries(e.outcomes).map(([key, value]) => (
          <Pill key={key} tone={key === "failed" ? "signal" : "outline"}>
            {key}: {formatNumber(value)}
          </Pill>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-hairline text-muted-foreground">
              <th className="pb-2">Source</th>
              <th className="pb-2">Robots</th>
              <th className="pb-2">Attempts</th>
              <th className="pb-2">Enriched</th>
              <th className="pb-2">Failed</th>
              <th className="pb-2">Backoff</th>
            </tr>
          </thead>
          <tbody>
            {e.sourceRows.map((row) => (
              <tr key={row.source} className="border-b border-hairline">
                <td className="py-2">{row.source}</td>
                <td className="py-2">
                  {row.allowed === null ? "unknown" : row.allowed ? "allowed" : "blocked"}
                </td>
                <td className="py-2">{row.attempts}</td>
                <td className="py-2">{row.enriched}</td>
                <td className="py-2">{row.failed}</td>
                <td className="py-2">{row.backoff ? <Pill tone="signal">yes</Pill> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SourceHealth({ data }: { data: OperationsDiagnostics }) {
  const s = data.sources;
  return (
    <Panel
      title="Source health"
      note="Thresholds: stale fetch after 48h, repeated failure at three, enrichment backoff at five. No provider calls are made here."
    >
      <StatGrid>
        <Stat label="Sources" value={formatNumber(s.total)} />
        <Stat label="Active" value={formatNumber(s.active)} />
        <Stat
          label="Failing/backed off"
          value={formatNumber(
            s.rows.filter((r) => r.state === "failing" || r.state === "backed_off").length,
          )}
        />
        <Stat
          label="No recent content"
          value={formatNumber(s.rows.filter((r) => r.state === "no_recent_content").length)}
        />
      </StatGrid>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-hairline text-muted-foreground">
              <th className="pb-2">Source</th>
              <th className="pb-2">State</th>
              <th className="pb-2">Last fetch</th>
              <th className="pb-2">Last article</th>
              <th className="pb-2">24h</th>
              <th className="pb-2">7d</th>
              <th className="pb-2">Failures</th>
              <th className="pb-2">Robots</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((row) => (
              <tr key={row.id} className="border-b border-hairline">
                <td className="py-2 font-medium">{row.name}</td>
                <td className="py-2">
                  <Pill tone={row.state === "healthy" ? "outline" : "signal"}>{row.state}</Pill>
                </td>
                <td className="py-2 text-muted-foreground">{formatDateTime(row.lastFetch)}</td>
                <td className="py-2 text-muted-foreground">{formatDateTime(row.lastArticle)}</td>
                <td className="py-2">{row.articles24h}</td>
                <td className="py-2">{row.articles7d}</td>
                <td className="py-2">{row.consecutiveFailures}</td>
                <td className="py-2">
                  {row.enrichmentAllowed === null
                    ? "unknown"
                    : row.enrichmentAllowed
                      ? "allowed"
                      : "blocked"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Delivery({ data }: { data: OperationsDiagnostics }) {
  const d = data.delivery;
  return (
    <Panel
      title="Delivery diagnostics"
      note="Failure reasons are bounded and provider response secrets are not exposed."
    >
      <StatGrid>
        <Stat label="Briefings generated" value={formatNumber(d.briefings.generated)} />
        <Stat
          label="Ready"
          value={formatNumber(d.briefings.ready)}
          hint={
            d.briefings.oldestReady
              ? `oldest ${formatDateTime(d.briefings.oldestReady)}`
              : undefined
          }
        />
        <Stat label="Unsent" value={formatNumber(d.briefings.unsent)} />
        <Stat label="Failed briefings" value={formatNumber(d.briefings.failed)} />
      </StatGrid>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <MetricList
          title="By channel"
          rows={Object.entries(d.byChannel).map(([channel, row]) => [
            channel,
            `${row.sent} sent · ${row.failed} failed · ${row.queued} queued`,
          ])}
        />
        <MetricList
          title="Failure reasons"
          rows={d.failureReasons.map((row) => [row.reason, row.count])}
        />
      </div>
      {d.recentFailures.length > 0 ? (
        <div className="mt-4">
          <p className="text-[12px] font-medium">Recent failures</p>
          <ul className="mt-2 divide-y divide-[var(--hairline)] text-[12px]">
            {d.recentFailures.map((row, i) => (
              <li key={`${row.at}-${i}`} className="flex justify-between gap-3 py-2">
                <span>
                  {row.channel} · {row.reason}
                </span>
                <span className="text-muted-foreground">{formatDateTime(row.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-muted-foreground">No recent delivery failures.</p>
      )}
    </Panel>
  );
}

function Scheduler({ data }: { data: OperationsDiagnostics }) {
  return (
    <Panel
      title="Scheduler health"
      note="Latest logical cron status from ops_status. Full historical run duration requires a bounded run ledger; this view does not invent history."
    >
      <div className="space-y-2 text-[12px]">
        {data.scheduler.length === 0 ? (
          <p className="text-muted-foreground">No scheduler status recorded.</p>
        ) : (
          data.scheduler.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-3 border-b border-hairline py-2"
            >
              <span className="font-mono">{row.key.replace("cron:", "")}</span>
              <span className="flex items-center gap-2">
                <Pill tone={row.status === "healthy" ? "outline" : "signal"}>{row.status}</Pill>
                <span>{formatDateTime(row.updatedAt)}</span>
              </span>
            </div>
          ))
        )}
      </div>
      <Link
        to="/admin/operations"
        className="mt-4 inline-block text-[12px] text-muted-foreground hover:text-foreground"
      >
        Open live Operations →
      </Link>
    </Panel>
  );
}

function RunHistory({ data }: { data: OperationsDiagnostics }) {
  return (
    <Panel
      title="Pipeline run history"
      note="Bounded stage-run ledger. History begins when migration 0092 is applied; it does not reconstruct earlier cron executions."
    >
      {data.runs.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No recorded pipeline runs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-hairline text-muted-foreground">
                <th className="pb-2">Stage</th>
                <th className="pb-2">Trigger</th>
                <th className="pb-2">Started</th>
                <th className="pb-2">Duration</th>
                <th className="pb-2">Processed</th>
                <th className="pb-2">Skipped</th>
                <th className="pb-2">Failed</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((row) => (
                <tr key={row.id} className="border-b border-hairline">
                  <td className="py-2 font-medium">{row.stage}</td>
                  <td className="py-2 text-muted-foreground">{row.trigger}</td>
                  <td className="py-2 text-muted-foreground">{formatDateTime(row.startedAt)}</td>
                  <td className="py-2">{duration(row.startedAt, row.finishedAt)}</td>
                  <td className="py-2">{formatNumber(row.processed)}</td>
                  <td className="py-2">{formatNumber(row.skipped)}</td>
                  <td className="py-2">{formatNumber(row.failed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function StoryIndex({ data }: { data: OperationsDiagnostics }) {
  return (
    <Panel
      title="Recent story diagnostics"
      note="Internal links open the deterministic build path for current complete events."
    >
      {data.recentStories.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No current stories available.</p>
      ) : (
        <ul className="divide-y divide-[var(--hairline)] text-[12px]">
          {data.recentStories.map((story) => (
            <li key={story.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate">{story.title}</span>
              <Link
                to="/admin/story/$id"
                params={{ id: story.id }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                Inspect →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function duration(start: string, finish: string | null): string {
  if (!finish) return "running";
  const seconds = Math.max(0, (Date.parse(finish) - Date.parse(start)) / 1000);
  return `${seconds.toFixed(1)}s`;
}

function Failures({ data }: { data: OperationsDiagnostics }) {
  return (
    <Panel
      title="Recent failures"
      note="Operational summaries only; expand the source logs for technical detail."
    >
      {data.failures.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No recent failures recorded.</p>
      ) : (
        <ul className="divide-y divide-[var(--hairline)] text-[12px]">
          {data.failures.map((row, i) => (
            <li key={`${row.at}-${i}`} className="py-2">
              <div className="flex justify-between gap-3">
                <span className="font-medium">{row.stage}</span>
                <span className="text-muted-foreground">{formatDateTime(row.at)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{row.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MetricList({ title, rows }: { title: string; rows: [string, string | number][] }) {
  return (
    <div>
      <p className="text-[12px] font-medium">{title}</p>
      <dl className="mt-2 divide-y divide-[var(--hairline)] text-[12px]">
        {rows.length === 0 ? (
          <p className="py-2 text-muted-foreground">No data.</p>
        ) : (
          rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right tabular-nums">
                {typeof value === "number" ? formatNumber(value) : value}
              </dd>
            </div>
          ))
        )}
      </dl>
    </div>
  );
}
