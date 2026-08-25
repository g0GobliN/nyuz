import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Volume2, VolumeX } from "lucide-react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { loadWatchedSources, setSourcePref, type WatchedSource } from "@/lib/server/briefing";
import type { SourcePref } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/sources")({
  component: Sources,
  head: () => ({ meta: [{ title: "Sources — nyuz" }] }),
});

function Sources() {
  const queryClient = useQueryClient();
  const sources = useQuery({
    queryKey: ["briefing", "sources"],
    queryFn: () => loadWatchedSources(),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (input: { sourceId: string; pref: SourcePref }) => setSourcePref({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["briefing", "sources"] }),
  });

  const groups = sources.data ?? [];
  const total = groups.reduce((n, g) => n + g.items.length, 0);

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
    </DashboardShell>
  );
}

function Row({
  name,
  state,
  onPriority,
  onMute,
}: {
  name: string;
  state: SourcePref;
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
          Prioritised
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
