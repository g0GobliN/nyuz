import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, ExternalLink, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DashboardShell } from "@/components/dashboard/shell";
import { LogoLoader, PanelLoading } from "@/components/loading";
import { formatStoryTime } from "@/lib/story-time";
import { storyGrafs } from "@/lib/article-body";
import { Button } from "@/components/kit";
import { useFeedback } from "@/lib/feedback-store";
import { useReadTracking } from "@/lib/use-engagement";
import { usePlan } from "@/lib/plan-state";
import { loadStory, askStory } from "@/lib/server/briefing";
import type { Story } from "@/lib/story";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/story/$id")({
  component: StoryDetail,
  head: ({ params }) => ({
    meta: [{ title: params.id ? "Story — nyuz" : "nyuz" }],
  }),
});

const PROMPTS = [
  "Explain this like I'm a beginner.",
  "How does this affect developers?",
  "What should I do about it this week?",
];

function StoryDetail() {
  const { id } = Route.useParams();
  const storyQ = useQuery({
    queryKey: ["briefing", "story", id],
    queryFn: () => loadStory({ data: { id } }),
    staleTime: 60_000,
  });
  const story = storyQ.data;

  // Whether the reader got to the bottom of the article. A ref rather than
  // state: nothing on screen changes when it flips, and a re-render on scroll
  // would be a cost paid on every story for no visible benefit.
  const reachedEnd = useRef(false);
  useReadTracking(story?.id, reachedEnd);

  const { asksPerDay, loading: planLoading } = usePlan();
  const { state, vote, toggleSaved } = useFeedback();
  const saved = story ? state.saved.includes(story.id) : false;
  const current = story ? state.votes[story.id] : undefined;

  if (storyQ.isLoading) {
    return (
      <DashboardShell title="Story">
        <PanelLoading label="Opening the story" />
      </DashboardShell>
    );
  }

  if (!story) {
    return (
      <DashboardShell title="Story">
        <p className="text-[15px]">This story is not in your briefing.</p>
        <Link
          to="/dashboard"
          className="mt-4 inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to your nyuz
        </Link>
      </DashboardShell>
    );
  }

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
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {formatStoryTime(story.publishedAt)}
          </span>
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px]">
            {story.importance} importance
          </span>
        </div>

        <h1 className="display mt-4 max-w-[40rem] text-[clamp(1.9rem,4.5vw,2.9rem)]">
          {story.title}
        </h1>
        <p className="mt-4 text-[13px] text-muted-foreground">
          {story.org}
          <span aria-hidden> · </span>
          {formatStoryTime(story.publishedAt)}
          <span aria-hidden> · </span>
          {story.sources} {story.sources === 1 ? "source" : "sources"}
        </p>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_260px]">
          <div className="min-w-0 space-y-9">
            <ArticleBody
              story={story}
              onReachEnd={() => {
                reachedEnd.current = true;
              }}
            />

            {story.timeline.length > 0 ? (
              <section>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  How this event formed
                </h2>
                <ol className="relative mt-5 space-y-4 pl-6">
                  <span className="absolute bottom-2 left-[4px] top-2 w-px bg-border" />
                  {story.timeline.map((t, i) => (
                    <li key={`${t.at}-${t.label}`} className="relative">
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
            ) : null}

            {!planLoading && asksPerDay > 0 ? (
              <AskPanel eventId={story.id} />
            ) : !planLoading ? (
              <section className="rounded-3xl border border-hairline bg-surface-2 p-6">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Ask about this
                </h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                  Ask runs a stronger model. It is included on Personal and Pro.
                </p>
                <Link
                  to="/dashboard/billing"
                  className="mt-4 inline-block text-[13px] text-signal underline-offset-4 hover:underline"
                >
                  See plans
                </Link>
              </section>
            ) : null}
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
                  <li
                    key={s.url ?? s.name}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    {s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 items-center gap-2 hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{s.name}</span>
                      </a>
                    ) : (
                      <span className="flex min-w-0 items-center gap-2">
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{s.name}</span>
                      </span>
                    )}
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

/**
 * Marks the bottom of the article as read once it scrolls into view.
 *
 * An IntersectionObserver rather than a scroll handler: it fires once, costs
 * nothing while the page sits still, and does not need throttling. `rootMargin`
 * pulls the trigger up slightly so finishing the last paragraph counts, without
 * requiring the reader to scroll past it into whitespace.
 */
function EndOfStory({ onReach }: { onReach: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onReach();
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -25% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onReach]);

  return <div ref={ref} aria-hidden className="h-px" />;
}

function ArticleBody({ story, onReachEnd }: { story: Story; onReachEnd: () => void }) {
  const grafs = storyGrafs({
    what: story.what,
    before: story.before,
    after: story.after,
    excerpts: story.sourceList.flatMap((s) => (s.excerpt ? [s.excerpt] : [])),
  });
  const dek = grafs[0];
  const rest = grafs.slice(1);

  return (
    <section className="max-w-[40rem]">
      {dek ? <p className="text-[19px] leading-[1.65] tracking-[-0.01em]">{dek}</p> : null}
      {rest.map((graf) => (
        <p key={graf.slice(0, 48)} className="mt-6 text-[16.5px] leading-[1.8]">
          {graf}
        </p>
      ))}
      {story.why ? (
        <div className="mt-10 rounded-3xl border border-signal/30 bg-surface p-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">
            Why it matters to you
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed">{story.why}</p>
        </div>
      ) : null}
      <EndOfStory onReach={onReachEnd} />
    </section>
  );
}

function AskPanel({ eventId }: { eventId: string }) {
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answered, setAnswered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (prompt: string) => {
    if (!prompt.trim() || asking) return;
    setQ(prompt);
    setAsking(true);
    setAnswered(null);
    setError(null);
    try {
      const result = await askStory({ data: { eventId, question: prompt } });
      if (result.ok) setAnswered(result.answer);
      else setError(result.detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The explanation could not be generated.");
    } finally {
      setAsking(false);
    }
  };

  return (
    <section id="ask" className="scroll-mt-24 rounded-3xl border border-hairline bg-surface-2 p-6">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Ask about this
      </h2>
      <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
        Ask anything about this story. Coding help and unrelated questions are refused.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => void ask(p)}
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
          onKeyDown={(e) => e.key === "Enter" && void ask(q)}
          placeholder="A question about this story"
          className="h-11 flex-1 rounded-full border border-input bg-surface px-4 text-[14px] outline-none placeholder:text-muted-foreground focus:border-signal"
        />
        <Button size="sm" onClick={() => void ask(q)} disabled={asking || !q.trim()}>
          {asking ? <LogoLoader className="h-4 w-4" tone="current" label="Asking" /> : "Ask"}
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

      {error ? (
        <p className="mt-5 text-[13.5px] leading-relaxed text-muted-foreground">{error}</p>
      ) : null}

      {answered ? (
        <div className="mt-5 space-y-4 rounded-2xl border border-hairline bg-surface p-5">
          {answered.split(/\n\n+/).map((graf) => (
            <p key={graf.slice(0, 48)} className="text-[14.5px] leading-relaxed">
              {graf}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
