import { createFileRoute, Link } from "@tanstack/react-router";
import { humanError } from "@/lib/errors";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, ExternalLink, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DashboardShell } from "@/components/dashboard/shell";
import { LogoLoader, PanelLoading } from "@/components/loading";
import { formatStoryTime } from "@/lib/story-time";
import { Button } from "@/components/kit";
import { useFeedback } from "@/lib/feedback-store";
import { useReadTracking } from "@/lib/use-engagement";
import { usePlan } from "@/lib/plan-state";
import { loadStory, askStory } from "@/lib/server/briefing";
import type { Story } from "@/lib/story";
import { cn } from "@/lib/utils";
import {
  dedupeStatements,
  intelligenceText,
  legacyEventIntelligence,
  understandMinutes,
  type EventIntelligence,
  type SupportedStatement,
  type TimelinePoint,
} from "@/lib/understand";

export const Route = createFileRoute("/dashboard/story/$id")({
  component: StoryDetail,
  head: ({ params }) => ({
    meta: [{ title: params.id ? "Understand — nyuz" : "nyuz" }],
  }),
});

const PROMPTS = [
  "Explain this like I'm a beginner.",
  "How does this affect developers?",
  "What should I do about it this week?",
];

/** How many sources the rail lists before deferring to the full list below. */
const RAIL_SOURCES = 5;

function StoryDetail() {
  const { id } = Route.useParams();
  const storyQ = useQuery({
    queryKey: ["briefing", "story", id],
    queryFn: () => loadStory({ data: { id } }),
    staleTime: 60_000,
  });
  const story = storyQ.data;

  // Whether the reader got to the bottom of the explanation. A ref rather than
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
      <DashboardShell title="Understand">
        <PanelLoading label="Preparing the event" />
      </DashboardShell>
    );
  }

  if (!story) {
    return (
      <DashboardShell title="Understand">
        <p className="text-[15px]">This event is not in your briefing.</p>
        <Link
          to="/dashboard"
          className="mt-4 inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to your nyuz
        </Link>
      </DashboardShell>
    );
  }

  const intelligence = eventIntelligence(story);

  return (
    <DashboardShell title="Understand">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to your nyuz
      </Link>

      <article className="mt-6 animate-rise">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-signal">
            {story.topics[0] ?? story.org}
          </span>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {formatStoryTime(story.updatedAt ?? story.publishedAt)}
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
          {story.sources} {story.sources === 1 ? "source" : "sources"}
          <span aria-hidden> · </span>
          {understandTime(story, intelligence)} understand
        </p>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_260px]">
          <div className="min-w-0 space-y-9">
            <UnderstandBody
              story={story}
              intelligence={intelligence}
              onReachEnd={() => {
                reachedEnd.current = true;
              }}
            />

            {!planLoading && asksPerDay > 0 ? (
              <AskPanel eventId={story.id} dailyLimit={asksPerDay} />
            ) : !planLoading ? (
              <section
                id="ask"
                className="max-w-[40rem] scroll-mt-24 rounded-3xl border border-hairline bg-surface-2 p-6"
              >
                <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> Ask nyuz
                </h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                  Ask nyuz is included on Personal and Pro. The factual explanation above stays the
                  same on every plan.
                </p>
                <Link
                  to="/dashboard/billing"
                  className="mt-4 inline-block text-[13px] text-signal underline-offset-4 hover:underline"
                >
                  See plans
                </Link>
              </section>
            ) : null}

            <Sources story={story} />
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
                Based on {story.sources} {story.sources === 1 ? "source" : "sources"}
              </p>
              <ul className="mt-4 space-y-2.5">
                {story.sourceList.slice(0, RAIL_SOURCES).map((s) => (
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
              {story.sourceList.length > RAIL_SOURCES ? (
                <a
                  href="#sources"
                  className="mt-3 inline-block text-[12px] text-signal underline-offset-4 hover:underline"
                >
                  All {story.sourceList.length} sources
                </a>
              ) : null}
              <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
                nyuz is not the source. This explanation is generated — open the reporting before
                acting on it.
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
 * Marks the bottom of the explanation as read once it scrolls into view.
 *
 * An IntersectionObserver rather than a scroll handler: it fires once, costs
 * nothing while the page sits still, and does not need throttling. `rootMargin`
 * pulls the trigger up slightly so finishing the last block counts, without
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

/** Structured intelligence for the event, or an evidence-aware fallback. */
function eventIntelligence(story: Story): EventIntelligence {
  return (
    story.understand ?? legacyEventIntelligence({ what: story.what, sources: story.sourceList })
  );
}

function isNewInformation(summary: string, text: string): boolean {
  return dedupeStatements([{ text: summary }, { text }]).length > 1;
}

function uniqueAfterSummary(
  summary: string,
  statements: SupportedStatement[],
): SupportedStatement[] {
  return statements.filter((statement) => isNewInformation(summary, statement.text));
}

/**
 * The event's own timeline when the analysis produced one, otherwise the
 * pipeline's record of how the event formed. Both are real; neither is invented
 * to fill the block.
 */
function timelinePoints(story: Story, intelligence: EventIntelligence): TimelinePoint[] {
  if (intelligence.timeline.length > 0) return intelligence.timeline;
  return story.timeline.map((point) => ({ when: point.at, what: point.label, evidence: [] }));
}

function showBeforeAfter(story: Story, summary: string): boolean {
  return (
    Boolean(story.before && story.after) &&
    isNewInformation(summary, story.before) &&
    isNewInformation(summary, story.after) &&
    isNewInformation(story.before, story.after)
  );
}

function analysisWhy(story: Story, summary: string): string {
  return story.why && isNewInformation(summary, story.why) ? story.why : "";
}

function understandTime(story: Story, intelligence: EventIntelligence) {
  const changed = showBeforeAfter(story, intelligence.summary) ? [story.before, story.after] : [];
  return understandMinutes([
    ...intelligenceText(intelligence),
    ...changed,
    analysisWhy(story, intelligence.summary),
  ]);
}

function EvidenceRefs({ refs, story }: { refs: number[]; story: Story }) {
  if (refs.length === 0) return null;
  const names = refs
    .map((ref) => story.sourceList[ref - 1]?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return null;
  return (
    <sup className="ml-1 text-[10px] font-normal text-muted-foreground" title={names.join(", ")}>
      [{refs.join(", ")}]
    </sup>
  );
}

function BlockHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </h2>
  );
}

/**
 * The explanation itself: a run of blocks at the old article's reading measure.
 * Every block is conditional — a block appears only when the event's evidence
 * actually supports it, so a thin event renders three blocks and a rich one
 * renders eight without either looking unfinished.
 */
function UnderstandBody({
  story,
  intelligence,
  onReachEnd,
}: {
  story: Story;
  intelligence: EventIntelligence;
  onReachEnd: () => void;
}) {
  const facts = uniqueAfterSummary(intelligence.summary, intelligence.facts);
  const context = uniqueAfterSummary(intelligence.summary, intelligence.context);
  const whatNext = uniqueAfterSummary(intelligence.summary, intelligence.whatNext);
  const changed = showBeforeAfter(story, intelligence.summary);
  const why = analysisWhy(story, intelligence.summary);
  const timeline = timelinePoints(story, intelligence);
  const glance = [
    ...intelligence.keyNumbers,
    ...(intelligence.coverage === "thin"
      ? [{ value: String(story.sources), label: "Available sources", evidence: [] }]
      : []),
  ];

  return (
    <div className="max-w-[40rem] space-y-8">
      <p className="text-[19px] leading-[1.65] tracking-[-0.01em]">{intelligence.summary}</p>

      {glance.length > 0 ? (
        <section className="border-y border-hairline py-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            {glance.map((item) => (
              <div key={`${item.value}-${item.label}`}>
                <p className="font-serif text-[26px] leading-none">
                  {item.value}
                  <EvidenceRefs refs={item.evidence} story={story} />
                </p>
                <p className="mt-1.5 text-[12px] text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {facts.length > 0 ? (
        <section>
          <BlockHeading>Key facts</BlockHeading>
          <ul className="mt-3 space-y-2.5">
            {facts.map((fact) => (
              <li key={fact.text} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="mt-[0.65em] h-1 w-1 shrink-0 rounded-full bg-signal" />
                <span>
                  {fact.text}
                  <EvidenceRefs refs={fact.evidence} story={story} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {changed ? (
        <section>
          <BlockHeading>What changed</BlockHeading>
          <div className="mt-3 grid gap-5 sm:grid-cols-2 sm:gap-8">
            <div className="border-t border-hairline pt-3">
              <p className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                Before
              </p>
              <p className="mt-1.5 text-[14.5px] leading-relaxed">{story.before}</p>
            </div>
            <div className="border-t border-signal pt-3">
              <p className="text-[10.5px] uppercase tracking-[0.16em] text-signal">Now</p>
              <p className="mt-1.5 text-[14.5px] leading-relaxed">{story.after}</p>
            </div>
          </div>
        </section>
      ) : null}

      {context.length > 0 ? (
        <section>
          <BlockHeading>Context</BlockHeading>
          <div className="mt-3 space-y-3.5 text-[15px] leading-relaxed">
            {context.map((item) => (
              <p key={item.text}>
                {item.text}
                <EvidenceRefs refs={item.evidence} story={story} />
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {why ? (
        <section className="border-l-2 border-signal pl-5">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-signal">
            Why it matters · nyuz analysis
          </p>
          <p className="mt-2 text-[15px] leading-relaxed">{why}</p>
        </section>
      ) : null}

      {intelligence.affectedGroups.length > 0 ? (
        <section>
          <BlockHeading>Who could be affected</BlockHeading>
          <dl className="mt-3 divide-y divide-[var(--hairline)] border-y border-hairline">
            {intelligence.affectedGroups.map((item) => (
              <div
                key={`${item.group}-${item.effect}`}
                className="py-3.5 sm:grid sm:grid-cols-[8rem_1fr] sm:gap-5"
              >
                <dt className="text-[14px] font-medium">
                  {item.group}
                  {item.basis === "analysis" ? (
                    <span className="ml-2 text-[9px] uppercase tracking-[0.12em] text-signal">
                      analysis
                    </span>
                  ) : null}
                </dt>
                <dd className="mt-1 text-[14px] leading-relaxed text-muted-foreground sm:mt-0">
                  {item.effect}
                  <EvidenceRefs refs={item.evidence} story={story} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {timeline.length >= 2 ? (
        <section>
          <BlockHeading>How this event formed</BlockHeading>
          <ol className="relative mt-4 space-y-4 pl-6">
            <span className="absolute bottom-2 left-[4px] top-2 w-px bg-border" />
            {timeline.map((item, index) => (
              <li key={`${item.when}-${item.what}`} className="relative">
                <span
                  className="absolute -left-6 top-[7px] h-[7px] w-[7px] rounded-full"
                  style={{
                    background: index === timeline.length - 1 ? "var(--signal)" : "var(--border)",
                  }}
                />
                <p className="text-[12px] tabular-nums text-muted-foreground">{item.when}</p>
                <p className="mt-0.5 text-[14.5px]">
                  {item.what}
                  <EvidenceRefs refs={item.evidence} story={story} />
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {whatNext.length > 0 ? (
        <section>
          <BlockHeading>What happens next</BlockHeading>
          <ul className="mt-3 space-y-2.5 text-[15px] leading-relaxed">
            {whatNext.map((item) => (
              <li key={item.text}>
                {item.text}
                <EvidenceRefs refs={item.evidence} story={story} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {intelligence.conflicts.length > 0 ? (
        <section className="border-l-2 border-border pl-5">
          <BlockHeading>Reports differ</BlockHeading>
          <div className="mt-3 space-y-4">
            {intelligence.conflicts.map((conflict) => (
              <div key={conflict.topic}>
                <p className="text-[14px] font-medium">{conflict.topic}</p>
                <ul className="mt-1.5 space-y-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                  {conflict.reports.map((report) => (
                    <li key={report.text}>
                      {report.text}
                      <EvidenceRefs refs={report.evidence} story={story} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {intelligence.unknowns.length > 0 ? (
        <section>
          <BlockHeading>Still unknown</BlockHeading>
          <ul className="mt-3 space-y-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
            {intelligence.unknowns.map((unknown) => (
              <li key={unknown}>— {unknown}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {intelligence.coverage === "thin" ? (
        <p className="border-t border-hairline pt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="text-foreground">Coverage is limited.</span> nyuz has{" "}
          {story.sources === 1 ? "one source" : "limited source material"} for this event, so it
          stops here rather than filling the gaps with speculation.
        </p>
      ) : null}

      <EndOfStory onReach={onReachEnd} />
    </div>
  );
}

function Sources({ story }: { story: Story }) {
  const visible = story.sourceList.slice(0, 8);
  const remaining = story.sourceList.slice(8);
  const rows = (sources: Story["sourceList"]) =>
    sources.map((source) => {
      const absoluteIndex = story.sourceList.indexOf(source) + 1;
      return (
        <li key={source.url ?? `${source.name}-${absoluteIndex}`} className="py-3">
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start justify-between gap-4"
            >
              <span className="min-w-0">
                <span className="text-[12px] text-muted-foreground">
                  [{absoluteIndex}] {source.name}
                </span>
                {source.headline ? (
                  <span className="mt-0.5 block text-[13.5px] leading-snug group-hover:underline">
                    {source.headline}
                  </span>
                ) : null}
              </span>
              <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <span className="text-[13.5px]">
              [{absoluteIndex}] {source.name}
            </span>
          )}
        </li>
      );
    });

  return (
    <section id="sources" className="max-w-[40rem] scroll-mt-24 border-t border-hairline pt-7">
      <BlockHeading>Original sources</BlockHeading>
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        nyuz is not the source. Generated explanations can be wrong; open the original material
        before acting on it.
      </p>
      <ul className="mt-3 divide-y divide-[var(--hairline)]">{rows(visible)}</ul>
      {remaining.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] text-muted-foreground">
            Show {remaining.length} more {remaining.length === 1 ? "source" : "sources"}
          </summary>
          <ul className="mt-3 divide-y divide-[var(--hairline)]">{rows(remaining)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function AskPanel({ eventId, dailyLimit }: { eventId: string; dailyLimit: number }) {
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
      setError(humanError(err, "The explanation could not be generated."));
    } finally {
      setAsking(false);
    }
  };

  return (
    <section
      id="ask"
      className="max-w-[40rem] scroll-mt-24 rounded-3xl border border-hairline bg-surface-2 p-6"
    >
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Ask nyuz
      </h2>
      <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
        Ask anything about this event. Coding help and unrelated questions are refused. Your plan
        includes up to {dailyLimit} questions per day.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        Your question and this event are sent to our AI provider. Do not include personal or
        confidential information.
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
          placeholder="A question about this event"
          className="h-11 flex-1 rounded-full border border-input bg-surface px-4 text-[16px] outline-none placeholder:text-muted-foreground focus:border-signal md:text-[14px]"
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
