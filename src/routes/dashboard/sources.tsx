import { createFileRoute } from "@tanstack/react-router";
import { humanError } from "@/lib/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Plus, Trash2, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Loading } from "@/components/loading";
import { Button } from "@/components/kit";
import { loadWatchedSources, setSourcePref, type WatchedSource } from "@/lib/server/briefing";
import {
  followCustomSource,
  listCustomSources,
  unfollowCustomSource,
} from "@/lib/server/custom-sources";
import type { SourcePref } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/plan-state";
import { PLAN_NAMES, formatTopicLimit } from "@/lib/plans";

export const Route = createFileRoute("/dashboard/sources")({
  component: Sources,
  head: () => ({ meta: [{ title: "Sources — nyuz" }] }),
});

function Sources() {
  const queryClient = useQueryClient();
  const { plan, prioritySourceLimit } = usePlan();
  const [limitError, setLimitError] = useState(false);
  const sources = useQuery({
    queryKey: ["briefing", "sources"],
    queryFn: () => loadWatchedSources(),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (input: { sourceId: string; pref: SourcePref }) => setSourcePref({ data: input }),
    onSuccess: (result) => {
      if (!result.ok) {
        setLimitError(true);
        return;
      }
      setLimitError(false);
      void queryClient.invalidateQueries({ queryKey: ["briefing", "sources"] });
    },
  });

  const groups = sources.data ?? [];
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const priorities = groups.flatMap((g) => g.items).filter((item) => item.priorityActive).length;

  const toggle = (item: WatchedSource, next: SourcePref) => {
    save.mutate({ sourceId: item.id, pref: item.pref === next ? "normal" : next });
  };

  return (
    <DashboardShell title="Sources">
      <PageHeader
        eyebrow={`${total} feeds monitored`}
        title="Sources we're watching for you."
        sub="You never have to touch this. It exists for the times you want a publication weighted differently, or gone."
      />

      <p className="mb-5 text-[12.5px] text-muted-foreground">
        {priorities} of {formatTopicLimit(prioritySourceLimit)} priority sources ·{" "}
        {PLAN_NAMES[plan]} plan. Muting is unlimited.
      </p>
      {limitError ? (
        <p className="mb-5 text-[12.5px] font-medium">
          This plan has no priority slots left. Remove one or upgrade before adding another.
        </p>
      ) : null}

      {sources.isLoading ? <Loading label="Reading your feeds" className="justify-center" /> : null}

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.group}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-medium">{g.group}</h2>
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {g.items.length} feeds
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {g.items.map((item) => (
                <Row
                  key={item.id}
                  name={item.name}
                  state={item.pref}
                  priorityActive={item.priorityActive}
                  onPriority={() => toggle(item, "priority")}
                  onMute={() => toggle(item, "muted")}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 text-[13px] leading-relaxed text-muted-foreground">
        Muting a source does not hide an event. If the same story is reported elsewhere, it still
        reaches you — with the muted publication left out of the source list.
      </p>

      <CustomSources />
    </DashboardShell>
  );
}

/**
 * Feeds this reader asked nyuz to watch.
 *
 * Separate from the list above because they are a different kind of thing: the
 * list above weights coverage nyuz already has, this one adds coverage that
 * did not exist. Below it, because the product's promise is that you never
 * have to curate — a reader who wants to is opting in, not being asked to.
 */
function CustomSources() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const custom = useQuery({
    queryKey: ["custom-sources"],
    queryFn: () => listCustomSources(),
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["custom-sources"] });
    void queryClient.invalidateQueries({ queryKey: ["briefing", "sources"] });
  };

  const follow = useMutation({
    mutationFn: (feedUrl: string) => followCustomSource({ data: { feedUrl } }),
    onSuccess: (result) => {
      if (!result.ok) {
        setError(result.detail);
        setNotice(null);
        return;
      }
      setError(null);
      setUrl("");
      // Worth saying out loud: it is the reason this costs nothing extra and
      // the reason the product gets cheaper as readers overlap.
      setNotice(
        result.shared
          ? `Added ${result.name}. nyuz already watches this one, so it starts immediately.`
          : `Added ${result.name}. It will be read on the next collection run.`,
      );
      invalidate();
    },
    onError: (e: unknown) => setError(humanError(e, "Could not add that feed.")),
  });

  const drop = useMutation({
    mutationFn: (sourceId: string) => unfollowCustomSource({ data: { sourceId } }),
    onSuccess: () => {
      setNotice(null);
      invalidate();
    },
  });

  const data = custom.data;
  const atLimit = data ? data.used >= data.limit : false;
  const canAdd = data ? data.limit > 0 : false;

  return (
    <section className="mt-12 border-t border-hairline pt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-medium">Your own sources</h2>
        {data ? (
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {data.used} of {data.limit} · {PLAN_NAMES[data.plan]}
          </span>
        ) : null}
      </div>

      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
        A company blog, a changelog, a release feed — anything with an RSS or Atom address. Stories
        from it are matched, grouped and briefed exactly like everything else.
      </p>

      {custom.isLoading ? <Loading label="Reading your sources" className="mt-6" /> : null}

      {data && !canAdd ? (
        <p className="mt-5 text-[13px] leading-relaxed">
          Adding your own sources is included on Plura and Omni.
        </p>
      ) : null}

      {canAdd ? (
        <form
          className="mt-6 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = url.trim();
            if (trimmed === "" || atLimit) return;
            follow.mutate(trimmed);
          }}
        >
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://example.com/feed.xml"
            aria-label="Feed address"
            autoComplete="off"
            spellCheck={false}
            disabled={atLimit}
            className="h-11 min-w-[260px] flex-1 rounded-2xl border border-input bg-background px-4 font-mono text-[16px] outline-none focus:border-signal disabled:opacity-50 md:text-[13px]"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={follow.isPending || atLimit || url.trim() === ""}
          >
            <Plus className="h-4 w-4" />
            {follow.isPending ? "Checking…" : "Add source"}
          </Button>
        </form>
      ) : null}

      {atLimit && canAdd ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          You are at your plan&rsquo;s limit. Remove one to add another.
        </p>
      ) : null}

      {error ? <p className="mt-3 max-w-2xl text-[12.5px] font-medium">{error}</p> : null}
      {notice ? (
        <p className="mt-3 max-w-2xl text-[12.5px] text-muted-foreground">{notice}</p>
      ) : null}

      {data && data.sources.length > 0 ? (
        <div className="mt-6 space-y-2">
          {data.sources.map((source) => (
            <div
              key={source.sourceId}
              className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-5 py-3.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{source.name}</span>
                <a
                  href={source.feedUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={source.feedUrl}
                  className="mt-0.5 block truncate font-mono text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {source.feedUrl}
                </a>
              </span>

              {/* Said plainly rather than hidden: a feed that stopped working
                  is something the reader asked for and should know about. */}
              {!source.healthy ? (
                <span className="whitespace-nowrap rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
                  not responding
                </span>
              ) : null}

              <button
                onClick={() => drop.mutate(source.sourceId)}
                disabled={drop.isPending}
                aria-label={`Remove ${source.name}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Row({
  name,
  state,
  priorityActive,
  onPriority,
  onMute,
}: {
  name: string;
  state: SourcePref;
  priorityActive: boolean;
  onPriority: () => void;
  onMute: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-5 py-3.5 transition-colors duration-300",
        state === "muted"
          ? "border-hairline bg-surface-2 opacity-60"
          : state === "priority"
            ? "border-signal/40 bg-surface"
            : "border-hairline bg-surface",
      )}
    >
      <span className={cn("flex-1 text-[14px]", state === "muted" && "line-through")}>{name}</span>

      {state === "priority" ? (
        <span className="rounded-full bg-signal/15 px-2.5 py-0.5 text-[11px] text-signal">
          {priorityActive ? "Prioritised" : "Saved · inactive"}
        </span>
      ) : null}

      <button
        onClick={onPriority}
        aria-label={`Prioritise ${name}`}
        aria-pressed={state === "priority"}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
          state === "priority"
            ? "bg-signal/15 text-signal"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onMute}
        aria-label={`Mute ${name}`}
        aria-pressed={state === "muted"}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {state === "muted" ? (
          <VolumeX className="h-3.5 w-3.5" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
