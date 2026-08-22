import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp, Plus, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Button } from "@/components/kit";
import { SOURCE_GROUPS } from "@/lib/sample-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/sources")({
  component: Sources,
  head: () => ({ meta: [{ title: "Sources — nyuz" }] }),
});

type SourceState = "normal" | "priority" | "muted";

function Sources() {
  const [states, setStates] = useState<Record<string, SourceState>>({});
  const [custom, setCustom] = useState<string[]>([]);
  const [url, setUrl] = useState("");

  const total = SOURCE_GROUPS.reduce((n, g) => n + g.count, 0) + custom.length;
  const stateOf = (name: string) => states[name] ?? "normal";
  const set = (name: string, s: SourceState) =>
    setStates((prev) => ({ ...prev, [name]: stateOf(name) === s ? "normal" : s }));

  const addSource = () => {
    const v = url.trim();
    if (!v) return;
    setCustom((c) => (c.includes(v) ? c : [...c, v]));
    setUrl("");
  };

  return (
    <DashboardShell title="Sources">
      <PageHeader
        eyebrow={`${total} feeds monitored`}
        title="Sources we're watching for you."
        sub="You never have to touch this. It exists for the times you want a publication weighted differently, or gone."
      />

      <div className="mb-9 flex flex-col gap-2.5 rounded-2xl border border-hairline bg-surface p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-[14px] font-medium">Add your own</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            A blog, an RSS feed or a changelog URL. We work out the rest.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSource()}
            placeholder="https://example.com/feed.xml"
            className="h-10 w-full rounded-full border border-input bg-background px-4 text-[13.5px] outline-none placeholder:text-muted-foreground focus:border-signal sm:w-64"
          />
          <Button size="sm" onClick={addSource}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      {custom.length > 0 ? (
        <section className="mb-8">
          <h2 className="text-[15px] font-medium">Added by you</h2>
          <div className="mt-3 space-y-2">
            {custom.map((c) => (
              <Row
                key={c}
                name={c}
                state={stateOf(c)}
                onPriority={() => set(c, "priority")}
                onMute={() => set(c, "muted")}
                onRemove={() => setCustom((x) => x.filter((v) => v !== c))}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="space-y-8">
        {SOURCE_GROUPS.map((g) => (
          <section key={g.group}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-medium">{g.group}</h2>
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {g.count} feeds
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {g.items.map((name) => (
                <Row
                  key={name}
                  name={name}
                  state={stateOf(name)}
                  onPriority={() => set(name, "priority")}
                  onMute={() => set(name, "muted")}
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
  onRemove,
}: {
  name: string;
  state: SourceState;
  onPriority: () => void;
  onMute: () => void;
  onRemove?: () => void;
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
        {state === "muted" ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      </button>
      {onRemove ? (
        <button
          onClick={onRemove}
          className="text-[12px] text-muted-foreground hover:text-destructive"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}
