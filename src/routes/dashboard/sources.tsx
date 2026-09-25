import { createFileRoute } from "@tanstack/react-router";
import { humanError } from "@/lib/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Plus, Trash2, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { LoadState } from "@/components/dashboard/load-state";
import { Loading } from "@/components/loading";
import { Button } from "@/components/kit";
import { loadPhase } from "@/lib/load-state";
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
  // Both counts are claims about the reader's watched feeds, so neither is
  // printed from a request that has not answered: a zero beside "feeds
  // monitored" is the same false answer as an empty list, in a smaller size.
  // Same function, same inputs as the panel below draws from.
  const phase = loadPhase(sources, { hasContent: groups.length > 0 });
  const eye =
    phase === "waiting"
      ? "Reading your feeds"
      : phase === "failed"
        ? "We couldn't read your feeds"
        : `${total} feeds monitored`;

  const toggle = (item: WatchedSource, next: SourcePref) => {
    save.mutate({ sourceId: item.id, pref: item.pref === next ? "normal" : next });
  };

  return (
    <DashboardShell title="Sources">
      <PageHeader
        eyebrow={eye}
        title="Sources we're watching for you."
        sub="You never have to touch this. It exists for the times you want a publication weighted differently, or gone."
      />

      <p className="mb-5 text-[12.5px] text-muted-foreground">
        {sources.data ? (
          <>
            {priorities} of {formatTopicLimit(prioritySourceLimit)} priority sources ·{" "}
          </>
        ) : null}
        {PLAN_NAMES[plan]} plan. You can mute any source.
      </p>
      {limitError ? (
        <p className="mb-5 text-[12.5px] font-medium">
          This plan has no priority slots left. Remove one or upgrade before adding another.
        </p>
      ) : null}

      {/*
        Three states, decided once, in src/lib/load-state.ts. This list maps over
        `groups`, which is the same empty array whether the request died or the
        reader follows nothing — so a failure used to draw an empty page under
        "Sources we're watching for you.", which reads as "nyuz watches nothing
        for me". There is no `empty` slot here: a successful read with no groups
        draws no list, and the copy around the panel is the section's own.
      */}
      <LoadState
        query={sources}
        hasContent={groups.length > 0}
        content={
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
        }
        loading={<Loading label="Reading your feeds" className="justify-center" />}
        failed="We couldn't read your sources."
      />

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

      {/*
        The wait and the failure only. Everything below is the section's own body
        and is written from `data`, so the panel's "something to show" state is
        "the answer arrived" and it draws nothing itself — `content={null}` is
        deliberate, and the section around it is what the reader is meant to see.
        A failed read used to leave this section looking like a reader who
        follows nothing, with no form either, since `canAdd` needs the plan's
        limit to come back.
      */}
      <LoadState
        query={custom}
        hasContent={data !== undefined}
        content={null}
        loading={<Loading label="Reading your sources" />}
        failed="We couldn't read your own sources."
        className="mt-6"
      />

      {data && !canAdd ? (
        <p className="mt-5 text-[13px] leading-relaxed">
          Adding your own sources is included on Plura and Omni.
        </p>
      ) : null}
      {data && data.used > data.limit ? (
        <p className="mt-3 text-sm">
          Your sources are preserved. Only the first {data.limit} active sources are monitored on
          this plan. Remove sources or{" "}
          <a href="/dashboard/billing" className="text-signal">
            upgrade
          </a>
          .
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
