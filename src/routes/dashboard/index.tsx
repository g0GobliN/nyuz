import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { StoryCard } from "@/components/dashboard/story-card";
import { PanelLoading } from "@/components/loading";
import { LinkButton } from "@/components/kit";
import { useDisplayName } from "@/lib/auth";
import { useFeedback } from "@/lib/feedback-store";
import { usePrefs } from "@/lib/prefs-store";
import { loadHomeFeed } from "@/lib/server/briefing";
import { clockInZone } from "@/lib/pipeline/schedule";
import { useReveal } from "@/lib/use-reveal";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardHome,
  head: () => ({ meta: [{ title: "Your nyuz" }] }),
});

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function DashboardHome() {
  const { prefs } = usePrefs();
  const who = useDisplayName() || prefs.name;
  const { state, signals, vote, toggleSaved, dismiss, muteTopic, restore } = useFeedback();
  const ref = useReveal<HTMLDivElement>();

  const feed = useQuery({
    queryKey: ["briefing", "home"],
    queryFn: () => loadHomeFeed(),
    staleTime: 60_000,
  });

  const stories = useMemo(() => feed.data?.stories ?? [], [feed.data?.stories]);

  const visible = useMemo(
    () =>
      stories.filter(
        (story) =>
          !state.dismissed.includes(story.id) &&
          !story.topics.some((t) => state.mutedTopics.includes(t)),
      ),
    [stories, state.dismissed, state.mutedTopics],
  );

  const hidden = stories.length - visible.length;
  const noTopics = prefs.topics.length === 0;
  const quiet = feed.data?.digestStatus === "skipped" || feed.data?.source === "empty";

  const nextLabel = prefs.paused
    ? "Paused"
    : feed.data?.nextAt
      ? `${clockInZone(new Date(feed.data.nextAt), prefs.timezone)}`
      : `Tomorrow · ${prefs.time}`;

  return (
    <DashboardShell title="Home">
      <div ref={ref}>
        <PageHeader
          eyebrow={new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          title={who ? `${greeting()}, ${who}.` : `${greeting()}.`}
          sub={
            visible.length > 0
              ? `Your nyuz found ${visible.length} ${visible.length === 1 ? "thing" : "things"} worth knowing.`
              : "Your nyuz came back quiet."
          }
        >
          <LinkButton to="/dashboard/briefing" variant="outline" size="sm">
            Read as a briefing <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </PageHeader>

        <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            {visible.length > 0 ? (
              visible.map((story, i) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  matched={story.topics.filter((t) => prefs.topics.includes(t))}
                  index={i}
                  feedback={state}
                  onVote={vote}
                  onSave={toggleSaved}
                  onDismiss={dismiss}
                  onMute={muteTopic}
                />
              ))
            ) : feed.isLoading ? (
              <PanelLoading label="Building your feed" />
            ) : noTopics ? (
              <EmptyState
                title="You haven't told us what to watch for yet."
                body="Pick a few topics and your briefing starts filling in. Until then there is nothing to match against, so there is nothing here."
                action={
                  <LinkButton to="/dashboard/topics" variant="outline" size="sm">
                    Choose my topics
                  </LinkButton>
                }
              />
            ) : quiet ? (
              <EmptyState
                title="Nothing matched your topics."
                body={`Nothing in the last ${feed.data?.windowHours ?? 48} hours touched ${prefs.topics.slice(0, 3).join(", ")}. A quiet day is a real answer, not a failure.`}
                action={
                  <LinkButton to="/dashboard/topics" variant="outline" size="sm">
                    Adjust my topics
                  </LinkButton>
                }
              />
            ) : (
              <EmptyState
                title="Your briefing is still assembling."
                body="Matches are in. The personal briefing goes out at the time you set — until then this page shows what has already been matched for you."
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
                Your nyuz
              </p>
              <div className="mt-4 space-y-3">
                {prefs.topics.length === 0 ? (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    No topics yet. Add a few and they appear here.
                  </p>
                ) : (
                  prefs.topics.slice(0, 6).map((topic) => {
                    const hits = stories.filter((s) => s.topics.includes(topic)).length;
                    const pct = stories.length > 0 ? Math.round((hits / stories.length) * 100) : 0;
                    return (
                      <div key={topic}>
                        <div className="flex justify-between text-[12.5px]">
                          <span>{topic}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {hits === 0 ? "—" : hits}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 rounded-full bg-muted">
                          <div
                            className="h-1 rounded-full bg-signal transition-[width] duration-1000"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
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
              <p className="mt-3 font-serif text-2xl tabular-nums">{nextLabel}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {prefs.paused
                  ? "Nothing is being sent until you resume."
                  : `${prefs.days.join(" · ")} · ${prefs.timezone}`}
              </p>
              <Link
                to="/dashboard/delivery"
                className="mt-4 inline-block text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                {prefs.paused ? "Resume briefings" : "Change schedule"}
              </Link>
            </div>

            <div className="rounded-2xl border border-signal/30 bg-surface p-5">
              <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-signal">
                <Sparkles className="h-3.5 w-3.5" /> Your nyuz is learning
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
