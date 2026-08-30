import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Plus, RotateCcw, Search, Tag } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
  createSource,
  listSources,
  resetSourceFailures,
  setSourceActive,
  setSourceListed,
  type SourceSummary,
} from "@/lib/server/sources";
import {
  listSourceDemand,
  listSourceTopics,
  listTopicsForAdmin,
  removeSourceTopic,
  setSourceTopic,
  type SourceDemand,
} from "@/lib/server/source-topics";
import type { SourceKind, Topic } from "@/lib/supabase/types";

export const Route = createFileRoute("/admin/sources")({ component: SourcesPage });

/**
 * Mirrors `SOURCE_KINDS` in src/lib/server/sources.ts, which is the list zod
 * actually enforces. The annotation catches a value invented here; it cannot
 * catch a kind added there and not here, so the two want reading together.
 */
const KINDS: SourceKind[] = [
  "rss",
  "news",
  "company_blog",
  "github",
  "research",
  "product",
  "other",
];

/** Every write on this page changes one row of one list, so they all invalidate it. */
const INVALIDATE = [["admin", "sources"]];

type Filter = "all" | "failing" | "off" | "healthy";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "failing", label: "Failing" },
  { key: "off", label: "Switched off" },
  { key: "healthy", label: "Healthy" },
];

function SourcesPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingTopicsFor, setEditingTopicsFor] = useState<SourceSummary | null>(null);

  const sources = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: () => listSources(),
    staleTime: 30_000,
  });

  // Two small, whole-table reads rather than a join per source — the same
  // shape as listSources itself, and cheap at this row count.
  const topics = useQuery({
    queryKey: ["admin", "topics"],
    queryFn: () => listTopicsForAdmin(),
    staleTime: 60_000,
  });
  const sourceTopics = useQuery({
    queryKey: ["admin", "source_topics"],
    queryFn: () => listSourceTopics(),
    staleTime: 15_000,
  });
  const demand = useQuery({
    queryKey: ["admin", "source_demand"],
    queryFn: () => listSourceDemand(),
    staleTime: 15_000,
  });
  const demandBySource = useMemo(
    () => new Map((demand.data ?? []).map((row) => [row.source_id, row])),
    [demand.data],
  );
  // null (not an empty array) means 0020 has not been applied yet — same
  // "missing function" distinction listSources already makes for 0007.
  const demandMissing = demand.data === null;

  const topicById = useMemo(
    () => new Map((topics.data ?? []).map((t) => [t.id, t])),
    [topics.data],
  );
  const topicsBySource = useMemo(() => {
    const map = new Map<string, Topic[]>();
    for (const row of sourceTopics.data ?? []) {
      const topic = topicById.get(row.topic_id);
      if (!topic) continue;
      const list = map.get(row.source_id) ?? [];
      list.push(topic);
      map.set(row.source_id, list);
    }
    return map;
  }, [sourceTopics.data, topicById]);

  // Mutations live here rather than in the row so there is one pair of them for
  // the whole table instead of two per feed, and one place for a failure to be
  // reported. The cost is that a write disables every row's buttons, not just
  // the row being written to — which is honest enough, since the list is about
  // to be refetched anyway.
  const toggle = useConsoleMutation(setSourceActive, INVALIDATE);
  const relist = useConsoleMutation(setSourceListed, INVALIDATE);
  const reset = useConsoleMutation(resetSourceFailures, INVALIDATE);
  const busy = toggle.isPending || reset.isPending || relist.isPending;

  const rows = sources.data ?? [];

  /**
   * `article_count` is null for every row or for none of them: the counts come
   * from a single `admin_source_stats()` call, so a null means that function is
   * absent (0007 never ran) rather than a feed with nothing to its name. The
   * difference matters enough to say out loud — a column of zeroes would be an
   * invented measurement.
   */
  const statsMissing = rows.some((row) => row.article_count === null);
  const articleTotal = rows.reduce((total, row) => total + (row.article_count ?? 0), 0);

  const activeCount = rows.filter((row) => row.active).length;
  const failingCount = rows.filter((row) => row.active && row.failure_count > 0).length;
  const offCount = rows.length - activeCount;

  const term = search.trim().toLowerCase();
  const visible = [...rows]
    // The server orders by failure count alone, which floats a feed somebody
    // switched off six months ago above a live one that has failed twice. A
    // disabled feed is a decision already taken; a feed that is on and failing
    // is the one still losing articles, so that group goes first.
    .sort(
      (a, b) =>
        group(a) - group(b) || b.failure_count - a.failure_count || a.name.localeCompare(b.name),
    )
    .filter(
      (row) =>
        inFilter(row, filter) &&
        // Filtering in the browser because the whole list is already here. Every
        // source fits in one response, so a query per keystroke would buy
        // nothing.
        (term === "" || `${row.name} ${row.feed_url}`.toLowerCase().includes(term)),
    );

  return (
    <>
      <ConsoleHeader
        title="Sources"
        sub="The feeds nyuz reads from. Nothing here is ever deleted: an article keeps a reference to the source it came from, so dropping a row would orphan every story that feed contributed. A publication you are finished with is switched off instead, which leaves its history attributable."
      >
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add source
        </Button>
      </ConsoleHeader>

      <ErrorNote error={sources.error} />

      <div className="space-y-5">
        <StatGrid>
          <Stat label="Feeds" value={formatNumber(rows.length)} />
          <Stat
            label="Active"
            value={formatNumber(activeCount)}
            hint={offCount > 0 ? `${formatNumber(offCount)} switched off` : undefined}
          />
          <Stat
            label="Failing"
            value={formatNumber(failingCount)}
            hint="Active, with a failure recorded"
          />
          <Stat
            label="Articles"
            value={statsMissing ? "—" : formatNumber(articleTotal)}
            hint={statsMissing ? "Not counted — see below" : undefined}
          />
        </StatGrid>

        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or feed URL"
                className={`${inputClass} mt-0 pl-10`}
                aria-label="Search sources"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map((f) => (
                <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            A failure count is backoff state, not a verdict — the fetcher raises it and then leaves
            the feed alone for a while. Switching a source back on clears the count, because turning
            it on asserts that whatever was wrong has been fixed. Clearing the count on its own is
            for a feed that recovered without being touched. The overview counts a source as failing
            repeatedly at three; this list shows any count above zero.
          </p>

          {statsMissing ? (
            <p className="mt-3 text-[11.5px] leading-relaxed text-signal">
              Article counts are unavailable:{" "}
              <code className="font-mono">admin_source_stats()</code> is not in this database, so
              Articles and Latest read “—” for every feed. That is a missing measurement rather than
              a count of zero. Apply migration 0007 to get the numbers back.
            </p>
          ) : null}

          {demandMissing ? (
            <p className="mt-3 text-[11.5px] leading-relaxed text-signal">
              Demand is unavailable: <code className="font-mono">admin_source_demand()</code> is not
              in this database. Apply migration 0020 to see how many currently-eligible readers each
              source's topics reach.
            </p>
          ) : (
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              Demand counts readers whose interests match this source's topics — not currently
              paused, banned or auto-paused for inactivity. Nothing is fetched or analysed
              differently based on this number yet; it exists to be checked against reality first.
            </p>
          )}

          <ErrorNote error={toggle.error} />
          <ErrorNote error={reset.error} />

          {sources.isLoading ? (
            <Loading label="Loading sources" />
          ) : rows.length === 0 ? (
            <p className="py-10 text-[13.5px] text-muted-foreground">
              No feeds yet. Migration 0006 seeds the starting list; if it has not run, there is
              nothing here to watch.
            </p>
          ) : visible.length === 0 ? (
            <p className="py-10 text-[13.5px] text-muted-foreground">Nothing matches.</p>
          ) : (
            <>
              <div className="-mx-6 mt-5 overflow-x-auto sm:-mx-7">
                <table className="w-full min-w-[1080px] text-left text-[13.5px]">
                  <thead>
                    <tr className="border-y border-hairline text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      <Th className="pl-6 sm:pl-7">Source</Th>
                      <Th>Kind</Th>
                      <Th>Topics</Th>
                      <Th className="text-right">Demand</Th>
                      <Th className="text-right">Articles</Th>
                      <Th>Latest</Th>
                      <Th>Last fetched</Th>
                      <Th className="text-right">Failures</Th>
                      <Th className="pr-6 text-right sm:pr-7">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <SourceRow
                        key={row.id}
                        source={row}
                        topics={topicsBySource.get(row.id) ?? []}
                        demand={demandBySource.get(row.id) ?? null}
                        demandMissing={demandMissing}
                        busy={busy}
                        onToggle={() =>
                          toggle.mutate({ data: { id: row.id, active: !row.active } })
                        }
                        onReset={() => reset.mutate({ data: { id: row.id } })}
                        onToggleListed={() =>
                          relist.mutate({ data: { id: row.id, listed: !row.listed } })
                        }
                        onEditTopics={() => setEditingTopicsFor(row)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-5 text-[12.5px] tabular-nums text-muted-foreground">
                {visible.length === rows.length
                  ? `${formatNumber(rows.length)} ${rows.length === 1 ? "feed" : "feeds"}`
                  : `${formatNumber(visible.length)} of ${formatNumber(rows.length)} feeds shown`}
              </p>
            </>
          )}
        </Panel>
      </div>

      {adding ? <AddDialog onClose={() => setAdding(false)} /> : null}

      {editingTopicsFor ? (
        <TopicsDialog
          source={editingTopicsFor}
          allTopics={topics.data ?? []}
          current={topicsBySource.get(editingTopicsFor.id) ?? []}
          onClose={() => setEditingTopicsFor(null)}
        />
      ) : null}
    </>
  );
}

/** Failing first, then whatever is switched off, then the feeds behaving themselves. */
function group(source: SourceSummary): number {
  if (source.active && source.failure_count > 0) return 0;
  if (!source.active) return 1;
  return 2;
}

function inFilter(source: SourceSummary, filter: Filter): boolean {
  switch (filter) {
    case "failing":
      return source.active && source.failure_count > 0;
    case "off":
      return !source.active;
    case "healthy":
      return source.active && source.failure_count === 0;
    case "all":
      return true;
  }
}

function Th({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <th className={`py-2.5 pr-4 font-medium ${className ?? ""}`}>{children}</th>;
}

function SourceRow({
  source,
  topics,
  demand,
  demandMissing,
  busy,
  onToggle,
  onReset,
  onToggleListed,
  onEditTopics,
}: {
  source: SourceSummary;
  topics: Topic[];
  demand: SourceDemand | null;
  demandMissing: boolean;
  busy: boolean;
  onToggle: () => void;
  onReset: () => void;
  onToggleListed: () => void;
  onEditTopics: () => void;
}) {
  return (
    <tr className="border-b border-hairline">
      <td className="max-w-[320px] py-3 pl-6 pr-4 sm:pl-7">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {source.name}
          {source.active ? null : <Pill tone="outline">off</Pill>}
          {/* Listing is a separate axis from active and from coverage: crawled
              or not, discoverable or not, core or demand. A reader-submitted
              feed is normally active-and-unlisted, so it is worth showing. */}
          {source.listed ? null : <Pill tone="outline">unlisted</Pill>}
          {source.origin === "user" ? <Pill tone="outline">reader</Pill> : null}
          {source.homepage ? (
            <a
              href={source.homepage}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] font-normal text-muted-foreground transition-colors hover:text-foreground"
            >
              site <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </p>
        {/* The feed URL is the thing that breaks, so it is a link: checking a
            dead feed is the first thing anyone does with this row. */}
        <a
          href={source.feed_url}
          target="_blank"
          rel="noreferrer"
          title={source.feed_url}
          className="mt-0.5 block truncate font-mono text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {source.feed_url}
        </a>
      </td>

      <td className="py-3 pr-4 text-muted-foreground">{source.kind}</td>

      <td className="max-w-[200px] py-3 pr-4">
        <button
          onClick={onEditTopics}
          className="flex flex-wrap items-center gap-1 text-left transition-opacity hover:opacity-70"
          aria-label={`Edit topics for ${source.name}`}
        >
          {topics.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
              <Tag className="h-3 w-3" /> none
            </span>
          ) : (
            <>
              {topics.slice(0, 3).map((t) => (
                <Pill key={t.id} tone="outline">
                  {t.label}
                </Pill>
              ))}
              {topics.length > 3 ? (
                <span className="text-[11px] text-muted-foreground">+{topics.length - 3}</span>
              ) : null}
            </>
          )}
        </button>
      </td>

      <td className="py-3 pr-4 text-right tabular-nums">
        {demandMissing || demand === null ? (
          <span
            className="text-muted-foreground"
            title={demandMissing ? "Apply migration 0020 to compute this" : "No topics mapped yet"}
          >
            —
          </span>
        ) : (
          <span title={`${formatNumber(demand.paid_interested_users)} on a paid plan`}>
            {formatNumber(demand.interested_users)}
          </span>
        )}
      </td>

      <td className="py-3 pr-4 text-right tabular-nums">
        {source.article_count === null ? (
          <span className="text-muted-foreground" title="Article counts are unavailable">
            —
          </span>
        ) : (
          formatNumber(source.article_count)
        )}
      </td>

      <td className="py-3 pr-4 tabular-nums text-muted-foreground">
        {formatDate(source.latest_article_at)}
      </td>

      <td className="py-3 pr-4 tabular-nums text-muted-foreground">
        {source.last_fetched_at === null ? "Never" : formatDateTime(source.last_fetched_at)}
      </td>

      <td className="py-3 pr-4 text-right tabular-nums">
        {source.failure_count === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <span className={source.failure_count >= 3 ? "font-semibold text-signal" : "font-medium"}>
            {formatNumber(source.failure_count)}
          </span>
        )}
      </td>

      <td className="py-3 pr-6 text-right sm:pr-7">
        <div className="flex items-center justify-end gap-1.5">
          {/* Hidden on a switched-off feed: enabling one already clears its
              count, so both buttons would do the same thing to that row. */}
          {source.active && source.failure_count > 0 ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onReset}>
              <RotateCcw className="h-3.5 w-3.5" /> Clear
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onToggleListed}>
            {source.listed ? "Unlist" : "List"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onToggle}>
            {source.active ? "Disable" : "Enable"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ---------------------------------------------------------------------- */
/* Add                                                                    */
/* ---------------------------------------------------------------------- */

function AddDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [feedUrl, setFeedUrl] = useState("https://");
  const [homepage, setHomepage] = useState("");
  const [kind, setKind] = useState<SourceKind>("rss");

  const save = useConsoleMutation(createSource, INVALIDATE);
  const ready = name.trim() !== "" && feedUrl.trim() !== "" && feedUrl.trim() !== "https://";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 bg-foreground/20 backdrop-blur-[2px]"
      />

      <div className="relative w-full max-w-lg rounded-3xl border border-hairline bg-background p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <h2 className="display text-2xl">Add source</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          One feed per row, and the feed URL has to be unique — pasting one that is already on the
          list is refused rather than duplicated.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="Name" hint="How the source is credited wherever its stories appear.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Anthropic News"
            />
          </Field>

          <Field
            label="Feed URL"
            hint="The feed itself, not the page it is linked from. Absolute http or https only — this becomes a server-side fetch target, so other schemes are refused."
          >
            <input
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              className={`${inputClass} font-mono text-[13px]`}
              placeholder="https://www.anthropic.com/news/rss.xml"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field label="Homepage" hint="Optional. Where a reader goes to see the publication.">
            <input
              value={homepage}
              onChange={(e) => setHomepage(e.target.value)}
              className={inputClass}
              placeholder="https://www.anthropic.com"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field
            label="Kind"
            hint="Descriptive. Nothing branches on it — it is here to keep a long list legible."
          >
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SourceKind)}
              className={`${inputClass} cursor-pointer`}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <ErrorNote error={save.error} />

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={save.isPending || !ready}
            onClick={() =>
              save.mutate(
                {
                  data: {
                    name: name.trim(),
                    feedUrl: feedUrl.trim(),
                    kind,
                    // Omitted rather than sent empty, so a blank field lands as
                    // the null the column already means by "no homepage".
                    ...(homepage.trim() === "" ? {} : { homepage: homepage.trim() }),
                  },
                },
                { onSuccess: () => onClose() },
              )
            }
          >
            {save.isPending ? "Adding…" : "Add source"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Topics                                                                 */
/* ---------------------------------------------------------------------- */

const TOPICS_INVALIDATE = [["admin", "source_topics"]];

/**
 * Toggle which topics a source covers. Every topic in the pool is a chip;
 * membership is the whole interaction — confidence is set to a flat 0.8 on
 * add, editable later by SQL or a future refinement, not by this dialog. A
 * first pass at "does this source cover this topic at all" is worth more
 * right now than a confidence slider nobody has data to calibrate yet.
 */
function TopicsDialog({
  source,
  allTopics,
  current,
  onClose,
}: {
  source: SourceSummary;
  allTopics: Topic[];
  current: Topic[];
  onClose: () => void;
}) {
  const currentIds = new Set(current.map((t) => t.id));
  const add = useConsoleMutation(setSourceTopic, TOPICS_INVALIDATE);
  const remove = useConsoleMutation(removeSourceTopic, TOPICS_INVALIDATE);
  const busy = add.isPending || remove.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 bg-foreground/20 backdrop-blur-[2px]"
      />

      <div className="relative w-full max-w-lg rounded-3xl border border-hairline bg-background p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <h2 className="display text-2xl">{source.name}</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          Which topics this source covers. This is the map demand visibility reads from — it does
          not change what gets fetched or analysed yet.
        </p>

        <ErrorNote error={add.error} />
        <ErrorNote error={remove.error} />

        <div className="mt-5 flex flex-wrap gap-2">
          {allTopics.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No topics in the pool yet.</p>
          ) : (
            allTopics.map((topic) => {
              const active = currentIds.has(topic.id);
              return (
                <Chip
                  key={topic.id}
                  active={active}
                  disabled={busy}
                  onClick={() =>
                    active
                      ? remove.mutate({ data: { sourceId: source.id, topicId: topic.id } })
                      : add.mutate({
                          data: { sourceId: source.id, topicId: topic.id, confidence: 0.8 },
                        })
                  }
                >
                  {topic.label}
                </Chip>
              );
            })
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
