import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { StoryCard } from "@/components/dashboard/story-card";
import { LinkButton } from "@/components/kit";
import { useFeedback } from "@/lib/feedback-store";
import { useRadar } from "@/lib/radar-store";
import { RADAR, STORIES } from "@/lib/sample-data";
import { useReveal } from "@/lib/use-reveal";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardHome,
  head: () => ({ meta: [{ title: "Your radar — nyuz" }] }),
});

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function DashboardHome() {
  const { prefs } = useRadar();
  const { state, signals, vote, toggleSaved, dismiss, muteTopic, restore } = useFeedback();
  const ref = useReveal<HTMLDivElement>();

  const stories = useMemo(
    () =>
      STORIES.filter(
        (s) =>
          !state.dismissed.includes(s.id) &&
          !s.topics.some((t) => state.mutedTopics.includes(t)),
      ),
    [state.dismissed, state.mutedTopics],
  );

  const hidden = STORIES.length - stories.length;

  return (
    <DashboardShell title="Home">
      <div ref={ref}>
        <PageHeader
          eyebrow={new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          title={`${greeting()}, ${prefs.name}.`}
          sub={
            stories.length > 0
              ? `Your radar found ${stories.length} things worth knowing.`
              : "Your radar came back quiet."
          }
        >
          <LinkButton to="/dashboard/briefing" variant="outline" size="sm">
            Read as a briefing <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </PageHeader>

        <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            {stories.length > 0 ? (
              stories.map((s, i) => (
                <StoryCard
                  key={s.id}
                  story={s}
                  index={i}
                  feedback={state}
                  onVote={vote}
                  onSave={toggleSaved}
                  onDismiss={dismiss}
                  onMute={muteTopic}
                />
              ))
            ) : (
              <EmptyState
                title="Nothing important happened for your radar today."
                body="That is actually a good thing. We do not pad a briefing to fill space — the next one arrives on schedule."
                action={
                  <LinkButton to="/dashboard/topics" variant="outline" size="sm">
                    Widen my topics
                  </LinkButton>
                }
              />
            )}

            {hidden > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface-2 px-5 py-4 text-[13px]">
                <span className="text-muted-foreground">
                  {hidden} {hidden === 1 ? "story" : "stories"} hidden by your feedback.
                </span>
                <button
                  onClick={() => state.dismissed.forEach(restore)}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  Show them
                </button>
              </div>
            ) : null}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Your radar
              </p>
              <div className="mt-4 space-y-3">
                {RADAR.map((r) => (
                  <div key={r.topic}>
                    <div className="flex justify-between text-[12.5px]">
                      <span>{r.topic}</span>
                      <span className="tabular-nums text-muted-foreground">{r.weight}</span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-muted">
                      <div
                        className="h-1 rounded-full bg-signal transition-[width] duration-1000"
                        style={{ width: `${r.weight}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Link
                to="/dashboard/topics"
                className="mt-5 inline-block text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                Adjust topics
              </Link>
            </div>

            <div className="rounded-2xl border border-hairline bg-surface p-5">
              <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Your next briefing
              </p>
              <p className="mt-3 font-serif text-2xl tabular-nums">Tomorrow · {prefs.time}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {prefs.days.join(" · ")} · {prefs.timezone}
              </p>
              <Link
                to="/dashboard/delivery"
                className="mt-4 inline-block text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                Change schedule
              </Link>
            </div>

            <div className="rounded-2xl border border-signal/30 bg-surface p-5">
              <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-signal">
                <Sparkles className="h-3.5 w-3.5" /> Your radar is learning
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                {signals === 0
                  ? "Rate a few stories and your briefing starts adjusting to what you actually open."
                  : `${signals} signals collected. Topics you skip fade, topics you open rise.`}
              </p>
              <div className="mt-4 flex gap-1">
                {Array.from({ length: 16 }).map((_, i) => (
                  <span
                    key={i}
                    className="h-6 flex-1 rounded-[3px] transition-colors duration-700"
                    style={{
                      background: i < Math.min(16, signals) ? "var(--signal)" : "var(--muted)",
                      opacity: i < Math.min(16, signals) ? 0.35 + i * 0.04 : 1,
                    }}
                  />
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </DashboardShell>
  );
}
