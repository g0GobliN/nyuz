import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock, Sparkles } from "lucide-react";
import { useMemo } from "react";
import {
  DashboardShell,
  EmptyState,
  PageHeader,
  SampleDataNotice,
} from "@/components/dashboard/shell";
import { LiveBriefing } from "@/components/dashboard/live-briefing";
import { StoryCard } from "@/components/dashboard/story-card";
import { LinkButton } from "@/components/kit";
import { useDisplayName } from "@/lib/auth";
import { useFeedback } from "@/lib/feedback-store";
import { matchStories } from "@/lib/matching";
import { usePrefs } from "@/lib/prefs-store";
import { STORIES } from "@/lib/sample-data";
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
  // The account is the authority on who you are; the locally stored name is a
  // fallback for anyone who set one before signing in. Neither invents a name,
  // so the greeting drops the comma rather than addressing a stranger.
  const who = useDisplayName() || prefs.name;
  const { state, signals, vote, toggleSaved, dismiss, muteTopic, restore } = useFeedback();
  const ref = useReveal<HTMLDivElement>();

  // Interests first, then feedback. A story you never asked for should not be
  // something you have to dismiss — it should never have been here.
  const matches = useMemo(() => matchStories(STORIES, prefs), [prefs]);

  const visible = useMemo(
    () =>
      matches.filter(
        ({ story }) =>
          !state.dismissed.includes(story.id) &&
          !story.topics.some((t) => state.mutedTopics.includes(t)),
      ),
    [matches, state.dismissed, state.mutedTopics],
  );

  const hidden = matches.length - visible.length;
  const noTopics = prefs.topics.length === 0;

  return (
    <DashboardShell title="Home">
      <div ref={ref}>
        {/* Real matches first, fixtures second, and each labelled. The order is
            the honest one: what the pipeline actually produced for this reader
            outranks a sample of what it will eventually look like. */}
        <LiveBriefing />
        <SampleDataNotice />
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
              visible.map(({ story, matched }, i) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  matched={matched}
                  index={i}
                  feedback={state}
                  onVote={vote}
                  onSave={toggleSaved}
                  onDismiss={dismiss}
                  onMute={muteTopic}
                />
              ))
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
            ) : (
              /* Distinguishes "quiet day" from "we do not cover your interests",
                 because the honest answer differs and only one of them is fixed
                 by waiting. */
              <EmptyState
                title="Nothing matched your topics."
                body={`Nothing in today's set touches ${prefs.topics.slice(0, 3).join(", ")}. Coverage today is weighted towards technology, so interests outside that may stay quiet for now.`}
                action={
                  <LinkButton to="/dashboard/topics" variant="outline" size="sm">
                    Adjust my topics
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
                Your nyuz
              </p>
              {/* Your topics, not a fixture list. The bar is how many of today's
                  stories that topic actually pulled in — so a topic nothing
                  matched reads as empty rather than as a confident weighting
                  nobody computed. */}
              <div className="mt-4 space-y-3">
                {prefs.topics.length === 0 ? (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    No topics yet. Add a few and they appear here.
                  </p>
                ) : (
                  prefs.topics.slice(0, 6).map((topic) => {
                    const hits = matches.filter((m) => m.matched.includes(topic)).length;
                    const pct = matches.length > 0 ? Math.round((hits / matches.length) * 100) : 0;
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
              <p className="mt-3 font-serif text-2xl tabular-nums">
                {prefs.paused ? "Paused" : `Tomorrow · ${prefs.time}`}
              </p>
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
