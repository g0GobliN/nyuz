import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bookmark,
  ExternalLink,
  Loader2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import { DashboardShell } from "@/components/dashboard/shell";
import { Button } from "@/components/kit";
import { useFeedback } from "@/lib/feedback-store";
import { storyById } from "@/lib/sample-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/story/$id")({
  loader: ({ params }) => {
    const story = storyById(params.id);
    if (!story) throw notFound();
    return story;
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.title} — nyuz` : "nyuz" }],
  }),
  component: StoryDetail,
});

const PROMPTS = [
  "Explain this like I'm a beginner.",
  "How does this affect developers?",
  "What should I do about it this week?",
];

function StoryDetail() {
  const story = Route.useLoaderData();
  const { state, vote, toggleSaved } = useFeedback();
  const saved = state.saved.includes(story.id);
  const current = state.votes[story.id];

  return (
    <DashboardShell title="Story">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to your nyuz
      </Link>

      <article className="mt-6 animate-rise">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-signal">
            {story.org}
          </span>
          <span className="text-[12px] tabular-nums text-muted-foreground">{story.time}</span>
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px]">
            {story.importance} importance
          </span>
        </div>

        <h1 className="display mt-4 max-w-3xl text-[clamp(1.9rem,4.5vw,2.9rem)]">{story.title}</h1>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_260px]">
          <div className="min-w-0 space-y-9">
            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                What happened
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed">{story.what}</p>
            </section>

            <section className="rounded-3xl border border-signal/30 bg-surface p-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">
                Why it matters to you
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed">{story.why}</p>
            </section>

            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                What changed
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-hairline bg-surface-2 p-5">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Before
                  </p>
                  <p className="mt-2 text-[14px] leading-relaxed">{story.before}</p>
                </div>
                <div className="rounded-2xl border border-signal/30 bg-surface p-5">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-signal">After</p>
                  <p className="mt-2 text-[14px] leading-relaxed">{story.after}</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                How this event formed
              </h2>
              <ol className="relative mt-5 space-y-4 pl-6">
                <span className="absolute bottom-2 left-[4px] top-2 w-px bg-border" />
                {story.timeline.map((t, i) => (
                  <li key={t.at} className="relative">
                    <span
                      className="absolute -left-6 top-[7px] h-[7px] w-[7px] rounded-full"
                      style={{
                        background:
                          i === story.timeline.length - 1 ? "var(--signal)" : "var(--border)",
                      }}
                    />
                    <p className="text-[12px] tabular-nums text-muted-foreground">{t.at}</p>
                    <p className="mt-0.5 text-[14.5px]">{t.label}</p>
                  </li>
                ))}
              </ol>
            </section>

            <AskPanel />
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Scoring
              </p>
              <div className="mt-4 space-y-3">
                {(
                  [
                    ["Relevance", story.score.relevance],
                    ["Importance", story.score.importance],
                    ["Novelty", story.score.novelty],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label}>
                    <div className="flex justify-between text-[12.5px]">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="tabular-nums">{v}%</span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-muted">
                      <div
                        className="h-1 rounded-full bg-signal transition-[width] duration-1000"
                        style={{ width: `${v}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Based on {story.sources} sources
              </p>
              <ul className="mt-4 space-y-2.5">
                {story.sourceList.map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground">
                      {s.at}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
                nyuz is not the source. This summary is generated — open the reporting before acting
                on it.
              </p>
            </div>

            <div className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Was this useful?
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => vote(story.id, "useful")}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-[12.5px] transition-colors",
                    current === "useful"
                      ? "border-signal/50 bg-signal/10 text-signal"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <ThumbsUp className="h-3.5 w-3.5" /> Useful
                </button>
                <button
                  onClick={() => vote(story.id, "not-useful")}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-[12.5px] transition-colors",
                    current === "not-useful"
                      ? "border-border bg-muted text-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <ThumbsDown className="h-3.5 w-3.5" /> Not useful
                </button>
              </div>
              <button
                onClick={() => toggleSaved(story.id)}
                className={cn(
                  "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border py-2 text-[12.5px] transition-colors",
                  saved ? "border-signal/50 text-signal" : "border-border hover:bg-muted",
                )}
              >
                <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
                {saved ? "Saved" : "Save for later"}
              </button>
            </div>
          </aside>
        </div>
      </article>
    </DashboardShell>
  );
}

function AskPanel() {
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);

  const ask = (prompt: string) => {
    if (!prompt.trim()) return;
    setQ(prompt);
    setAsking(true);
    setAnswered(null);
    // Deliberately gated: the deeper model runs only when a person asks for it.
    setTimeout(() => {
      setAsking(false);
      setAnswered(prompt);
    }, 1100);
  };

  return (
    <section id="ask" className="scroll-mt-24 rounded-3xl border border-hairline bg-surface-2 p-6">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Ask about this
      </h2>
      <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
        This runs a stronger model, so it only runs when you ask. Nothing here is pre-generated.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => ask(p)}
            className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-[12.5px] transition-colors hover:border-foreground/25"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(q)}
          placeholder="Ask anything about this story"
          className="h-11 flex-1 rounded-full border border-input bg-surface px-4 text-[14px] outline-none placeholder:text-muted-foreground focus:border-signal"
        />
        <Button size="sm" onClick={() => ask(q)} disabled={asking || !q.trim()}>
          {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ask"}
        </Button>
      </div>

      {asking ? (
        <div className="mt-5 space-y-2">
          {[100, 92, 68].map((w) => (
            <span
              key={w}
              className="block h-3 animate-pulse rounded-full bg-muted"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : null}

      {answered ? (
        <div className="mt-5 rounded-2xl border border-hairline bg-surface p-5">
          <p className="text-[12px] text-muted-foreground">{answered}</p>
          <p className="mt-3 text-[14.5px] leading-relaxed">
            A deeper explanation would appear here, written against this event and the sources
            behind it. Connect a model provider to enable it — the interface, gating and cost
            boundary are already in place.
          </p>
        </div>
      ) : null}
    </section>
  );
}
