import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { DeliveryHealth } from "@/components/admin/delivery-health";
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
  inputClass,
} from "@/components/admin/shell";
import {
  getOperationsDiagnostics,
  getPipelineRunHistory,
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
        <ConsoleHeader title="Diagnostics" sub="Deep technical inspection of current behavior." />
        <ErrorNote error={query.error} />
      </>
    );
  if (!query.data) return <Loading label="Reading diagnostics" />;
  const d = query.data;
  return (
    <>
      <ConsoleHeader
        title="Diagnostics"
        sub="Deep inspection for explaining unusual Reads, enrichment, delivery and pipeline behavior."
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
        <Delivery data={d} />
        <div className="grid gap-5 lg:grid-cols-2">
          <Scheduler data={d} />
          <Failures data={d} />
        </div>
        <RunHistory data={d} />
        <StoryIndex data={d} />
        <p className="text-[11.5px] text-muted-foreground">
          Snapshot generated {formatDateTime(d.generatedAt)}. All samples and windows are shown in
          their section labels.
        </p>
      </div>
    </>
  );
}

function ReadQuality({ data }: { data: OperationsDiagnostics }) {
  const q = data.readQuality;
  return (
    <Panel
      title="Reader diagnostics"
      note={`${q.scope}. This is a bounded composition sample, not an all-time history.`}
    >
      <StatGrid>
        <Stat label="Sampled" value={formatNumber(q.sampleSize)} />
        <Stat label="Average words" value={display(q.averageWords)} />
        <Stat label="Median words" value={display(q.medianWords)} />
        <Stat label="P90 words" value={display(q.p90Words)} />
      </StatGrid>
      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        <MetricList title="Reader mode" rows={Object.entries(q.modes)} />
        <MetricList title="Quality" rows={Object.entries(q.quality)} />
        <MetricList title="Word bands" rows={Object.entries(q.words)} />
      </div>
      <div className="mt-4 grid gap-3 rounded-xl border border-hairline p-4 text-[12px] sm:grid-cols-4">
        <span>
          Enriched stories <strong>{formatNumber(q.evidence.enrichedStories)}</strong>
        </span>
        <span>
          Evidence units <strong>{formatNumber(q.evidence.rawUnits)}</strong>
        </span>
        <span>
          Units / enriched story <strong>{display(q.evidence.averageUnitsPerEnrichedStory)}</strong>
        </span>
        <span>
          Source words{" "}
          <strong>
            {q.evidence.sourceWords === null ? "—" : formatNumber(q.evidence.sourceWords)}
          </strong>
        </span>
      </div>
      <div className="mt-3 grid gap-3 rounded-xl border border-hairline p-4 text-[12px] sm:grid-cols-4">
        <span>
          Metadata fields removed{" "}
          <strong>{formatNumber(q.sourceNormalization.removedMetadataFields)}</strong>
        </span>
        <span>
          Metadata-only evidence dropped{" "}
          <strong>{formatNumber(q.sourceNormalization.rejectedMetadataOnly)}</strong>
        </span>
        <span>
          Duplicate facts merged{" "}
          <strong>{formatNumber(q.dedupe.duplicateGroups + q.dedupe.nearDuplicateMerges)}</strong>
          {q.dedupe.restatements > 0 ? (
            <> ({formatNumber(q.dedupe.restatements)} restated)</>
          ) : null}
        </span>
        <span>
          Cleaner variant kept <strong>{formatNumber(q.dedupe.preferredCleanVariant)}</strong>
        </span>
      </div>
      <div className="mt-3 grid gap-3 rounded-xl border border-hairline p-4 text-[12px] sm:grid-cols-4">
        <span>
          Facts published{" "}
          <strong>
            {formatNumber(q.composition.factsRendered)} of{" "}
            {formatNumber(q.composition.factsSelected)}
          </strong>
        </span>
        <span>
          Facts lost after selection <strong>{formatNumber(q.composition.factsLost)}</strong>
        </span>
        <span>
          Blocks the gate refused <strong>{formatNumber(q.composition.paragraphsRejected)}</strong>
        </span>
        <span>
          Deck-only stories <strong>{formatNumber(q.composition.deckOnly)}</strong>
        </span>
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {formatNumber(q.composition.narrativeStories)} of {formatNumber(q.evaluated)} stories are a
        single repository document and are composed in that document's own order; the rest use the
        news ranking.
      </p>
      <div className="mt-3 grid gap-3 rounded-xl border border-hairline p-4 text-[12px] sm:grid-cols-4">
        <span>
          Paper voice resolved to authors{" "}
          <strong>{formatNumber(q.sourceNormalization.authorialVoiceRewrites)}</strong>
        </span>
        <span>
          Sentences refused <strong>{formatNumber(q.composition.sentencesRefused)}</strong>
        </span>
        <span className="sm:col-span-2">
          {Object.keys(q.composition.refusalReasons).length === 0 ? (
            <span className="text-muted-foreground">No sentence was refused in this sample.</span>
          ) : (
            Object.entries(q.composition.refusalReasons).map(([reason, count]) => (
              <span key={reason} className="mr-3 inline-block">
                {reason.replace(/_/g, " ")} <strong>{formatNumber(count)}</strong>
              </span>
            ))
          )}
        </span>
      </div>
      <div className="mt-3 grid gap-3 rounded-xl border border-hairline p-4 text-[12px] sm:grid-cols-4">
        <span>
          Fallback decks attempted <strong>{formatNumber(q.fallback.attempted)}</strong>
        </span>
        <span>
          Fallback decks published <strong>{formatNumber(q.fallback.accepted)}</strong>
        </span>
        <span>
          Provider furniture refused <strong>{formatNumber(q.fallback.furnitureRejected)}</strong>
        </span>
        <span>
          Headline-only stories <strong>{formatNumber(q.fallback.empty)}</strong>
        </span>
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {formatNumber(q.fallback.candidates)} candidate summary(ies) were judged. A story whose feed
        description was a media credit, a git trailer or a release label publishes its headline and
        sources with no deck, rather than a credit line as prose.
      </p>
      {Object.keys(q.fallback.rejectionReasons).length > 0 ? (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Fallback refusals:{" "}
          {Object.entries(q.fallback.rejectionReasons).map(([reason, count]) => (
            <span key={reason} className="mr-3 inline-block">
              {reason.replace(/_/g, " ")} <strong>{formatNumber(count)}</strong>
            </span>
          ))}
        </p>
      ) : null}
      {q.qualityGate.metadataLeakWarnings +
        q.qualityGate.malformedAttributionWarnings +
        q.qualityGate.deckRefusals >
      0 ? (
        <p className="mt-3 rounded-xl border border-signal/30 p-3 text-[12px]">
          Quality gate blocked {formatNumber(q.qualityGate.metadataLeakWarnings)} metadata leak(s),
          {formatNumber(q.qualityGate.malformedAttributionWarnings)} malformed source attribution(s)
          and {formatNumber(q.qualityGate.deckRefusals)} deck(s) in this sample. Nothing reached a
          reader.
          {Object.keys(q.qualityGate.deckReasons).length > 0 ? (
            <>
              {" "}
              Deck reasons:{" "}
              {Object.entries(q.qualityGate.deckReasons).map(([reason, count]) => (
                <span key={reason} className="mr-3 inline-block">
                  {reason.replace(/_/g, " ")} <strong>{formatNumber(count)}</strong>
                </span>
              ))}
            </>
          ) : null}
        </p>
      ) : null}
      {q.composition.factsLost > 0 ? (
        <p className="mt-3 rounded-xl border border-signal/30 p-3 text-[12px]">
          {formatNumber(q.composition.factsLost)} selected fact(s) reached no block. Each refusal is
          counted above by reason; a fact with no reason is a composition bug.
        </p>
      ) : null}
      <p className="mt-3 text-[11.5px] text-muted-foreground">
        Historical reader quality is not persisted. Values above are derived by composing the latest
        sampled events through the same deterministic Read inputs; unavailable values are shown as
        —.
      </p>
    </Panel>
  );
}

function Enrichment({ data }: { data: OperationsDiagnostics }) {
  const e = data.enrichment;
  return (
    <Panel
      title="Enrichment diagnostics"
      note={`${e.scope}. Current source robots/backoff state is shown only for sources needing attention; full source inspection remains canonical in Sources.`}
    >
      <div className="flex flex-wrap gap-2">
        <Pill tone={e.enabled ? "outline" : "signal"}>Status: {e.enabled ? "on" : "off"}</Pill>
        <Pill tone="outline">Batch limit: {display(e.batchLimit)}</Pill>
        {Object.entries(e.outcomes).map(([key, value]) => (
          <Pill key={key} tone={key === "failed" ? "signal" : "outline"}>
            {key}: {formatNumber(value)}
          </Pill>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4 text-[12px]">
        <span>
          Pending <strong>{display(e.pending)}</strong>
        </span>
        <span>
          Evidence units <strong>{formatNumber(e.evidenceUnits)}</strong>
        </span>
        <span>
          Avg units/article <strong>{display(e.averageEvidencePerEnrichedArticle)}</strong>
        </span>
        <span>
          Success rate{" "}
          <strong>{e.successRate === null ? "—" : `${Math.round(e.successRate * 100)}%`}</strong>
        </span>
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium">Sources needing attention</p>
          <Link
            to="/admin/sources"
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            Inspect all sources →
          </Link>
        </div>
        {e.attention.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            No active source attention signals in this window.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-hairline text-muted-foreground">
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Reason</th>
                  <th className="pb-2">Robots</th>
                  <th className="pb-2">Attempts · enriched</th>
                  <th className="pb-2">Last failure</th>
                </tr>
              </thead>
              <tbody>
                {e.attention.map((row) => (
                  <tr key={row.sourceId} className="border-b border-hairline">
                    <td className="py-2 font-medium">{row.source}</td>
                    <td className="py-2">{row.reason}</td>
                    <td className="py-2">{row.robots}</td>
                    <td className="py-2">
                      {row.recentAttempts} · {row.recentEnriched}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {formatDateTime(row.lastFailure)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Delivery({ data }: { data: OperationsDiagnostics }) {
  const d = data.delivery;
  return (
    <Panel title="Delivery diagnostics" note={d.scope}>
      <DeliveryHealth rows={d.health} />
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
        <Stat label="Expired" value={formatNumber(d.briefings.expired)} />
      </StatGrid>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <MetricList
          title="By channel"
          rows={Object.entries(d.byChannel).map(([channel, row]) => [
            channel,
            `${row.sent} sent · ${row.failed} failed · ${row.queued} queued · ${row.successRate === null ? "—" : `${Math.round(row.successRate * 100)}% success`}`,
          ])}
        />
        <div>
          <p className="text-[12px] font-medium">Grouped failure reasons</p>
          {d.failureGroups.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              No delivery failures in this window.
            </p>
          ) : (
            <div className="mt-2 divide-y divide-[var(--hairline)] text-[12px]">
              {d.failureGroups.slice(0, 12).map((row) => (
                <div key={`${row.channel}-${row.reason}`} className="py-2">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">
                      {row.count} · {row.channel}
                    </span>
                    <span className="text-muted-foreground">{formatDateTime(row.lastAt)}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{row.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Scheduler({ data }: { data: OperationsDiagnostics }) {
  return (
    <Panel
      title="Scheduler health"
      note="Logical names are mapped from the actual cron dispatch code; raw expressions remain secondary."
    >
      {data.scheduler.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No scheduler status recorded.</p>
      ) : (
        <div className="divide-y divide-[var(--hairline)] text-[12px]">
          {data.scheduler.map((row) => (
            <div
              key={`${row.logicalJob}-${row.raw}`}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <span>
                <strong>{row.logicalJob}</strong>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">{row.raw}</span>
              </span>
              <span className="flex items-center gap-2">
                <Pill tone={row.status === "healthy" ? "outline" : "signal"}>{row.status}</Pill>
                {formatDateTime(row.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
      <Link
        to="/admin/operations"
        className="mt-4 inline-block text-[12px] text-muted-foreground hover:text-foreground"
      >
        Open live Operations →
      </Link>
    </Panel>
  );
}

function RunHistory(_props: { data: OperationsDiagnostics }) {
  const query = useInfiniteQuery({
    queryKey: ["admin", "pipeline-runs"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => getPipelineRunHistory({ data: { before: pageParam } }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextBefore : undefined),
    staleTime: 30_000,
  });
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];
  return (
    <Panel
      title="Pipeline run history"
      note="All retained runs, loaded 30 at a time. ‘—’ means the current instrumentation did not record that metric; it is not measured zero."
    >
      {query.isLoading ? (
        <p className="text-[12px] text-muted-foreground">Loading run history…</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No recorded pipeline runs yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-hairline text-muted-foreground">
                  <th className="pb-2">Stage</th>
                  <th className="pb-2">Trigger</th>
                  <th className="pb-2">Started</th>
                  <th className="pb-2">Duration</th>
                  <th className="pb-2">Processed</th>
                  <th className="pb-2">Skipped</th>
                  <th className="pb-2">Failed</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-hairline">
                    <td className="py-2 font-medium">{row.stage}</td>
                    <td className="py-2 text-muted-foreground">{row.trigger}</td>
                    <td className="py-2 text-muted-foreground">{formatDateTime(row.startedAt)}</td>
                    <td className="py-2">{duration(row.startedAt, row.finishedAt)}</td>
                    <td className="py-2">{display(row.processed)}</td>
                    <td className="py-2">{display(row.skipped)}</td>
                    <td className="py-2">{display(row.failed)}</td>
                    <td className="py-2">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-muted-foreground">
              Showing {rows.length} retained runs
            </p>
            {query.hasNextPage ? (
              <button
                type="button"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="text-[12px] text-muted-foreground hover:text-foreground"
              >
                {query.isFetchingNextPage ? "Loading…" : "Load older runs →"}
              </button>
            ) : (
              <span className="text-[11.5px] text-muted-foreground">End of retained history</span>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function Failures({ data }: { data: OperationsDiagnostics }) {
  return (
    <Panel
      title="Recent failures"
      note="Grouped by stage and normalized reason; only up to three example identifiers are retained per group."
    >
      {data.failures.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No recent failures recorded.</p>
      ) : (
        <div className="divide-y divide-[var(--hairline)] text-[12px]">
          {data.failures.map((row) => (
            <div key={`${row.stage}-${row.reason}`} className="py-2">
              <div className="flex justify-between gap-3">
                <span className="font-medium">
                  {row.stage} · {row.count} occurrences
                </span>
                <span className="text-muted-foreground">{formatDateTime(row.lastAt)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{row.reason}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                First {formatDateTime(row.firstAt)} · examples {row.examples.length}
              </p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function StoryIndex({ data }: { data: OperationsDiagnostics }) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [quality, setQuality] = useState<QualityFilter>("all");
  const rows = useMemo(
    () =>
      data.recentStories.filter(
        (row) =>
          (mode === "all" || row.mode === mode) &&
          (quality === "all" || row.quality === quality) &&
          (!search.trim() ||
            `${row.title} ${row.id}`.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    [data.recentStories, mode, quality, search],
  );
  return (
    <Panel
      title="Story diagnostics"
      note="Latest bounded sample. Search matches title or event ID; deep inspection remains on each story detail route."
    >
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or event ID"
            aria-label="Search stories"
            className={`${inputClass} mt-0 pl-9`}
          />
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ModeFilter)}
          className={`${inputClass} mt-0 w-auto`}
        >
          <option value="all">All modes</option>
          <option value="ai_cached">AI cached</option>
          <option value="deterministic_enriched">Enriched</option>
          <option value="deterministic_rss">RSS</option>
          <option value="minimal">Minimal</option>
        </select>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as QualityFilter)}
          className={`${inputClass} mt-0 w-auto`}
        >
          <option value="all">All quality</option>
          <option value="rich">Rich</option>
          <option value="adequate">Adequate</option>
          <option value="thin">Thin</option>
        </select>
      </div>
      {data.suspiciousTitles.length > 0 ? (
        <div className="mt-4 rounded-xl border border-signal/30 p-3 text-[12px]">
          <p className="font-medium">
            Suspicious titles / malformed events: {data.suspiciousTitles.length}+
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.suspiciousTitles.map((row) => (
              <Link
                key={row.id}
                to="/admin/story/$id"
                params={{ id: row.id }}
                className="underline underline-offset-2"
              >
                {row.title || row.reason}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-hairline text-muted-foreground">
              <th className="pb-2">Title</th>
              <th className="pb-2">Mode</th>
              <th className="pb-2">Quality</th>
              <th className="pb-2">Words</th>
              <th className="pb-2">Sources</th>
              <th className="pb-2">Evidence</th>
              <th className="pb-2">Category</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-hairline">
                <td className="max-w-[24rem] truncate py-2 font-medium">{row.title}</td>
                <td className="py-2">{row.mode}</td>
                <td className="py-2">{row.quality}</td>
                <td className="py-2">{row.words}</td>
                <td className="py-2">{row.sources}</td>
                <td className="py-2">{row.evidence}</td>
                <td className="py-2">{row.category ?? "—"}</td>
                <td className="py-2 text-right">
                  <Link
                    to="/admin/story/$id"
                    params={{ id: row.id }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Inspect →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11.5px] text-muted-foreground">
        Showing {rows.length} of {data.recentStories.length} sampled stories.
      </p>
    </Panel>
  );
}

type ModeFilter = "all" | "ai_cached" | "deterministic_enriched" | "deterministic_rss" | "minimal";
type QualityFilter = "all" | "thin" | "adequate" | "rich";
function display(value: number | null): string {
  return value === null ? "—" : formatNumber(Math.round(value));
}
function duration(start: string, finish: string | null): string {
  if (!finish) return "running";
  return `${Math.max(0, (Date.parse(finish) - Date.parse(start)) / 1000).toFixed(1)}s`;
}
function MetricList({ title, rows }: { title: string; rows: [string, string | number][] }) {
  return (
    <div>
      <p className="text-[12px] font-medium">{title}</p>
      <dl className="mt-2 divide-y divide-[var(--hairline)] text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">
              {typeof value === "number" ? formatNumber(value) : value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
