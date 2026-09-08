import {
  createFileRoute,
  Link,
  useCanGoBack,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { humanError } from "@/lib/errors";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  ExternalLink,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardShell } from "@/components/dashboard/shell";
import { LogoLoader, PanelLoading } from "@/components/loading";
import { formatStoryTime } from "@/lib/story-time";
import { Button } from "@/components/kit";
import { useFeedback } from "@/lib/feedback-store";
import { useReadTracking } from "@/lib/use-engagement";
import { usePlan } from "@/lib/plan-state";
import type { QueueItem, ReadingQueue } from "@/lib/reading-queue";
import { asQueueSource, useReadingQueue, type QueueSource } from "@/lib/use-reading-queue";
import { loadStory, askStory } from "@/lib/server/briefing";
import { getLaunchFlags } from "@/lib/server/settings";
import type { Story } from "@/lib/story";
import { cn } from "@/lib/utils";
import {
  corroboration,
  deriveChange,
  eventTimeline,
  intelligenceText,
  legacyEventIntelligence,
  sourceCountLabel,
  understandMinutes,
  type Audience,
  type Comparison,
  type EventIntelligence,
  type NumericSeries,
  type OverviewItem,
  type Perspective,
  type RelationshipMap as RelationshipMapType,
  type WatchItem,
} from "@/lib/understand";
import { composeArticle } from "@/lib/editorial";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/dashboard/story/$id")({
  component: StoryDetail,
  validateSearch: (search: Record<string, unknown>): { from?: QueueSource } => {
    const from = asQueueSource(search["from"]);
    return from ? { from } : {};
  },
  head: ({ params }) => ({
    meta: [{ title: params.id ? "Understand — nyuz" : "nyuz" }],
  }),
});

const PROMPTS = [
  "Explain this like I'm a beginner.",
  "How does this affect developers?",
  "What should I do about it this week?",
];

function BackToFeed({ className }: { className?: string }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const label = (
    <>
      <ArrowLeft className="h-3.5 w-3.5" /> Back to your nyuz
    </>
  );
  const style = cn(
    "inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground",
    className,
  );

  if (!canGoBack) {
    return (
      <Link to="/dashboard" className={style}>
        {label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.history.back()} className={style}>
      {label}
    </button>
  );
}

function StoryDetail() {
  const { id } = Route.useParams();
  const storyQ = useQuery({
    queryKey: ["briefing", "story", id],
    queryFn: () => loadStory({ data: { id } }),
    staleTime: 60_000,
  });
  const story = storyQ.data;

  const reachedEnd = useRef(false);
  useReadTracking(story?.id, reachedEnd);

  useEffect(() => {
    reachedEnd.current = false;
  }, [id]);

  const { asksPerDay, loading: planLoading } = usePlan();
  const { state, vote, toggleSaved } = useFeedback();
  const saved = story ? state.saved.includes(story.id) : false;
  const current = story ? state.votes[story.id] : undefined;

  const from = Route.useSearch().from ?? "home";
  const queue = useReadingQueue(from, story?.id, state);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const open = useCallback(
    (nextId: string) => {
      void navigate({
        to: "/dashboard/story/$id",
        params: { id: nextId },
        search: { from },
        replace: true,
      }).then(() => window.scrollTo({ top: 0, behavior: "auto" }));
    },
    [navigate, from],
  );

  const nextId = queue.next?.id;
  useEffect(() => {
    if (!nextId) return;
    void queryClient.prefetchQuery({
      queryKey: ["briefing", "story", nextId],
      queryFn: () => loadStory({ data: { id: nextId } }),
      staleTime: 60_000,
    });
  }, [queryClient, nextId]);

  useStoryShortcuts(queue, open);

  const flagsQ = useQuery({
    queryKey: ["launch", "flags"],
    queryFn: () => getLaunchFlags(),
    staleTime: 60_000,
  });
  const askEnabled = flagsQ.data?.askNyuz ?? false;

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
        <BackToFeed className="mt-4" />
      </DashboardShell>
    );
  }

  const article = composeArticle(story, {
    audience: "reader",
    implication: "",
    evidence: [],
  });

  return (
    <DashboardShell title="Understand">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackToFeed />
        <QueueControls queue={queue} onOpen={open} />
      </div>

      <article className="mt-6 animate-rise">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,40rem)_minmax(0,14rem)]">
          <div className="min-w-0 space-y-9">
            <div>
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

              <h1 className="display mt-4 max-w-[40rem] text-[clamp(1.5rem,4.5vw,2.9rem)]">
                {story.title}
              </h1>
              <p className="mt-4 text-[13px] text-muted-foreground">
                {story.org}
                <span aria-hidden> · </span>
                {sourceCountLabel(story.understand?.analysisMeta, story.sources)}
                <span aria-hidden> · </span>
                {understandMinutes([
                  ...intelligenceText(
                    story.understand ??
                      legacyEventIntelligence({ what: story.what, sources: story.sourceList }),
                  ),
                  ...(story.personalization?.explanation
                    ? [story.personalization.explanation]
                    : []),
                ])}{" "}
                understand
              </p>
            </div>

            <EditorialBody
              article={article}
              story={story}
              onReachEnd={() => {
                reachedEnd.current = true;
              }}
            />

            {askEnabled && !planLoading && asksPerDay > 0 ? (
              <AskPanel eventId={story.id} dailyLimit={asksPerDay} />
            ) : null}

            <QueuePager queue={queue} onOpen={open} />
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
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

            <EndMatter article={article} story={story} />

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

function useStoryShortcuts(queue: ReadingQueue, open: (id: string) => void) {
  const { prev, next } = queue;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

      const forward = event.key === "ArrowRight" || event.key === "j";
      const back = event.key === "ArrowLeft" || event.key === "k";
      if (forward && next) {
        event.preventDefault();
        open(next.id);
      } else if (back && prev) {
        event.preventDefault();
        open(prev.id);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, open]);
}

function QueueControls({ queue, onOpen }: { queue: ReadingQueue; onOpen: (id: string) => void }) {
  if (queue.total < 2) return null;

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[12px] tabular-nums text-muted-foreground">
        {queue.position} of {queue.total}
      </span>
      <div className="flex items-center gap-1">
        <StepButton direction="prev" target={queue.prev} onOpen={onOpen} />
        <StepButton direction="next" target={queue.next} onOpen={onOpen} />
      </div>
    </div>
  );
}

function StepButton({
  direction,
  target,
  onOpen,
}: {
  direction: "prev" | "next";
  target: QueueItem | null;
  onOpen: (id: string) => void;
}) {
  const label = direction === "prev" ? "Previous story" : "Next story";

  return (
    <button
      type="button"
      disabled={!target}
      aria-label={label}
      title={target ? `${label}: ${target.title}` : label}
      onClick={() => {
        if (target) onOpen(target.id);
      }}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
        target
          ? "cursor-pointer border-border hover:bg-muted"
          : "cursor-not-allowed border-hairline text-muted-foreground/40",
      )}
    >
      {direction === "prev" ? (
        <ArrowLeft className="h-4 w-4" />
      ) : (
        <ArrowRight className="h-4 w-4" />
      )}
    </button>
  );
}

function QueuePager({ queue, onOpen }: { queue: ReadingQueue; onOpen: (id: string) => void }) {
  if (queue.total < 2) return null;

  return (
    <nav aria-label="More in this list" className="border-t border-hairline pt-7">
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted-foreground">
        <span className="tabular-nums">
          {queue.position} of {queue.total} in {queue.label}
        </span>
        <span className="hidden sm:inline">
          <Key>{"\u2190"}</Key> and <Key>{"\u2192"}</Key> move between stories
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {queue.prev ? (
          <PagerCard direction="prev" target={queue.prev} onOpen={onOpen} />
        ) : (
          <span className="hidden sm:block" />
        )}
        {queue.next ? (
          <PagerCard direction="next" target={queue.next} onOpen={onOpen} />
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-5 sm:text-right">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">The end</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              That was the last of {queue.label}.
            </p>
          </div>
        )}
      </div>
    </nav>
  );
}

function PagerCard({
  direction,
  target,
  onOpen,
}: {
  direction: "prev" | "next";
  target: QueueItem;
  onOpen: (id: string) => void;
}) {
  const isNext = direction === "next";

  return (
    <button
      type="button"
      onClick={() => onOpen(target.id)}
      className={cn(
        "group cursor-pointer rounded-2xl border border-hairline bg-surface p-5 text-left transition-colors hover:border-foreground/20",
        isNext && "sm:text-right",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground",
          isNext && "sm:flex-row-reverse",
        )}
      >
        {isNext ? <ArrowRight className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
        {isNext ? "Next" : "Previous"}
      </span>
      <span className="mt-2 line-clamp-2 block text-[15px] font-medium leading-snug group-hover:underline group-hover:underline-offset-4">
        {target.title}
      </span>
    </button>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border px-1.5 py-0.5 font-sans text-[11px]">
      {children}
    </kbd>
  );
}

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

function eventIntelligence(story: Story): EventIntelligence {
  return (
    story.understand ?? legacyEventIntelligence({ what: story.what, sources: story.sourceList })
  );
}

function timelinePoints(story: Story, intelligence: EventIntelligence) {
  return eventTimeline(
    intelligence,
    story.timeline.map((point) => ({ when: point.at, what: point.label, evidence: [] })),
  );
}

function understandTime(story: Story, intelligence: EventIntelligence) {
  const change = deriveChange(
    story.before,
    story.after,
    intelligence.newDevelopments,
    intelligence.oneSentence,
  );
  const changeTexts =
    change?.mode === "before_now"
      ? [change.before, change.now]
      : (change?.items.map((item) => item.text) ?? []);
  return understandMinutes([
    ...intelligenceText(intelligence),
    ...changeTexts,
    story.personalization?.explanation ?? "",
  ]);
}

function ComparisonTable({ comparison, story }: { comparison: Comparison; story: Story }) {
  return (
    <section>
      <BlockHeading>{comparison.caption || "Compared"}</BlockHeading>
      <div className="mt-3 divide-y divide-[var(--hairline)] border-y border-hairline">
        <div className="grid grid-cols-[1fr_1fr] gap-4 py-2 sm:grid-cols-[8rem_1fr_1fr]">
          <span className="hidden text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground sm:block" />
          <span className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
            {comparison.leftLabel}
          </span>
          <span className="text-[10.5px] uppercase tracking-[0.16em] text-signal">
            {comparison.rightLabel}
          </span>
        </div>
        {comparison.rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[1fr_1fr] gap-4 py-3 sm:grid-cols-[8rem_1fr_1fr]"
          >
            <p className="col-span-2 text-[12px] text-muted-foreground sm:col-span-1 sm:text-[14px] sm:text-foreground">
              {row.label}
            </p>
            <p className="text-[14.5px] text-muted-foreground">{row.left}</p>
            <p className="text-[14.5px]">
              {row.right}
              <EvidenceRefs refs={row.evidence} story={story} />
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function NumericChart({ series, story }: { series: NumericSeries; story: Story }) {
  const max = Math.max(...series.points.map((point) => point.value));
  const min = Math.min(0, ...series.points.map((point) => point.value));
  const span = max - min || 1;

  return (
    <section>
      <BlockHeading>{series.caption || "By the numbers"}</BlockHeading>
      {series.shape === "line" ? (
        <div className="mt-4">
          <svg
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            className="h-24 w-full"
            role="img"
            aria-label={series.points.map((p) => `${p.label} ${p.display}`).join(", ")}
          >
            <polyline
              fill="none"
              stroke="var(--signal)"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
              points={series.points
                .map((point, index) => {
                  const x = (index / (series.points.length - 1)) * 100;
                  const y = 30 - ((point.value - min) / span) * 28;
                  return `${x},${y}`;
                })
                .join(" ")}
            />
          </svg>
          <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
            {series.points.map((point) => (
              <span key={point.label}>{point.label}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {series.points.map((point) => (
            <div key={point.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
              <span className="truncate text-[12px] text-muted-foreground">{point.label}</span>
              <span className="h-2 rounded-full bg-muted">
                <span
                  className="block h-2 rounded-full bg-signal"
                  style={{ width: `${Math.max(2, ((point.value - min) / span) * 100)}%` }}
                />
              </span>
              <span className="text-[12.5px] tabular-nums">{point.display}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        <EvidenceRefs refs={series.points.flatMap((point) => point.evidence)} story={story} />
      </p>
    </section>
  );
}

function StructuredOverview({ items, story }: { items: OverviewItem[]; story: Story }) {
  return (
    <section>
      <BlockHeading>What was announced</BlockHeading>
      <dl className="mt-3 divide-y divide-[var(--hairline)] border-y border-hairline">
        {items.map((item) => (
          <div key={item.name} className="flex items-baseline justify-between gap-4 py-3">
            <div className="min-w-0">
              <dt className="text-[14.5px] font-medium">{item.name}</dt>
              {item.kind ? (
                <dd className="mt-0.5 text-[12px] text-muted-foreground">{item.kind}</dd>
              ) : null}
            </div>
            <dd className="shrink-0 text-[14px] tabular-nums">
              {item.detail}
              <EvidenceRefs refs={item.evidence} story={story} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ThePicture({
  relationships,
  story,
}: {
  relationships: RelationshipMapType;
  story: Story;
}) {
  const labelOf = (id: string) => relationships.nodes.find((node) => node.id === id)?.label ?? id;
  return (
    <section className="border-y border-hairline py-6">
      <BlockHeading>The picture</BlockHeading>
      <div className="mt-4 space-y-5">
        {relationships.edges.map((edge, index) => (
          <div
            key={`${edge.from}-${edge.to}-${index}`}
            className="flex flex-col items-center gap-1.5 text-center"
          >
            <p className="text-[14px] font-medium uppercase tracking-[0.04em]">
              {labelOf(edge.from)}
            </p>
            <span aria-hidden className="h-4 w-px bg-border" />
            {edge.label ? (
              <p className="text-[11px] uppercase tracking-[0.14em] text-signal">{edge.label}</p>
            ) : null}
            <span aria-hidden className="h-4 w-px bg-border" />
            <p className="text-[14px] font-medium uppercase tracking-[0.04em]">
              {labelOf(edge.to)}
              <EvidenceRefs refs={edge.evidence} story={story} />
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AudienceList({ audiences, story }: { audiences: Audience[]; story: Story }) {
  return (
    <section>
      <BlockHeading>Who should care</BlockHeading>
      <dl className="mt-3 divide-y divide-[var(--hairline)] border-y border-hairline">
        {audiences.map((item) => (
          <div key={item.audience} className="py-3.5 sm:grid sm:grid-cols-[8rem_1fr] sm:gap-5">
            <dt className="text-[14px] font-medium">{item.audience}</dt>
            <dd className="mt-1 text-[14px] leading-relaxed text-muted-foreground sm:mt-0">
              {item.implication}
              <EvidenceRefs refs={item.evidence} story={story} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PerspectiveList({ perspectives, story }: { perspectives: Perspective[]; story: Story }) {
  return (
    <section>
      <BlockHeading>Different perspectives</BlockHeading>
      <div className="mt-3 space-y-4">
        {perspectives.map((item) => (
          <div key={item.source}>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {item.source}
            </p>
            <p className="mt-1 text-[14.5px] leading-relaxed">
              {item.stance}
              <EvidenceRefs refs={item.evidence} story={story} />
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WatchNextList({ items, story }: { items: WatchItem[]; story: Story }) {
  return (
    <section>
      <BlockHeading>Watch next</BlockHeading>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.label}>
            <p className="text-[14px] font-medium">{item.label}</p>
            <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">
              {item.detail}
              <EvidenceRefs refs={item.evidence} story={story} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Corroboration({ refs, story }: { refs: number[]; story: Story }) {
  const outlets = corroboration(
    refs,
    story.sourceList.map((source) => source.name),
  );
  if (outlets < 3) return null;
  return (
    <span className="ml-2 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
      {outlets} sources
    </span>
  );
}

function EvidenceRefs({ refs, story }: { refs: number[]; story: Story }) {
  if (refs.length === 0) return null;
  const names = refs
    .map((ref) => story.sourceList[ref - 1]?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return null;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <sup className="ml-1 text-[10px] font-normal text-muted-foreground cursor-help">
            [{refs.join(", ")}]
          </sup>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-[18rem] text-[11px] leading-snug">
          {names.join(", ")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
 * The editorial margin body: a two-column grid where the main content
 * lives in the left column and margin notes populate the right column
 * at the `xl` breakpoint and above. Below `xl`, margin notes render
 * inline within the content flow.
 */
function EditorialBody({
  article,
  story,
  onReachEnd,
}: {
  article: ReturnType<typeof composeArticle>;
  story: Story;
  onReachEnd: () => void;
}) {
  const change = deriveChange(
    story.before,
    story.after,
    article.blocks
      .filter((b) => b.type === "paragraph")
      .map((b) => ({ text: b.content, evidence: b.evidence, kind: "reported" as const })),
    story.understand?.oneSentence ?? "",
  );

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,40rem)_minmax(0,14rem)] xl:gap-8">
      <div className="min-w-0 space-y-8">
        <p className="text-[14.5px] leading-[1.5] tracking-[-0.01em] sm:text-[19px] sm:leading-[1.65]">
          {story.understand?.oneSentence ??
            legacyEventIntelligence({ what: story.what, sources: story.sourceList }).oneSentence}
        </p>

        {story.understand?.relationships ? (
          <ThePicture relationships={story.understand.relationships} story={story} />
        ) : null}

        {change?.mode === "before_now" ? (
          <section>
            <BlockHeading>What changed</BlockHeading>
            <div className="mt-3 grid gap-5 sm:grid-cols-2 sm:gap-8">
              <div className="border-t border-hairline pt-3">
                <p className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                  Before
                </p>
                <p className="mt-1.5 text-[14.5px] leading-relaxed">{change.before}</p>
              </div>
              <div className="border-t border-signal pt-3">
                <p className="text-[10.5px] uppercase tracking-[0.16em] text-signal">Now</p>
                <p className="mt-1.5 text-[14.5px] leading-relaxed">{change.now}</p>
              </div>
            </div>
          </section>
        ) : change?.mode === "new" ? (
          <section>
            <BlockHeading>New in this announcement</BlockHeading>
            <ul className="mt-3 space-y-2.5 text-[15px] leading-relaxed">
              {change.items.map((item) => (
                <li key={item.text}>
                  {item.text}
                  <EvidenceRefs refs={item.evidence} story={story} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {article.sections.map((section, index) => (
          <section key={index}>
            {section.heading ? <BlockHeading>{section.heading}</BlockHeading> : null}
            <div className="mt-3 space-y-3.5">
              {section.blocks.map((block, bIndex) => (
                <ArticleBlock key={`${index}-${bIndex}`} block={block} story={story} />
              ))}
            </div>
            {section.marginNotes.length > 0 ? (
              <div className="xl:hidden mt-3 space-y-2">
                {section.marginNotes.map((note, nIndex) => (
                  <MarginNote key={`${index}-${nIndex}`} note={note} story={story} />
                ))}
              </div>
            ) : null}
          </section>
        ))}

        {story.personalization ? (
          <div className="rounded-3xl border border-signal/30 bg-surface p-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">
              {story.personalization.heading}
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed">{story.personalization.explanation}</p>
          </div>
        ) : null}

        <EndOfStory onReach={onReachEnd} />
      </div>

      <aside className="hidden xl:block xl:space-y-6">
        {article.marginNotes.map((note, index) => (
          <MarginNote key={index} note={note} story={story} />
        ))}
      </aside>
    </div>
  );
}

function ArticleBlock({
  block,
  story,
}: {
  block: import("@/lib/editorial").ArticleBlock;
  story: Story;
}) {
  return (
    <p className="text-[14.5px] leading-relaxed">
      {block.content}
      <EvidenceRefs refs={block.evidence} story={story} />
    </p>
  );
}

function MarginNote({ note, story }: { note: import("@/lib/editorial").MarginNote; story: Story }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-2 p-3 text-[12px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">{note.text}</span>
      <EvidenceRefs refs={note.evidence} story={story} />
    </div>
  );
}

function EndMatter({
  article,
  story,
}: {
  article: ReturnType<typeof composeArticle>;
  story: Story;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        {story.understand?.analysisMeta &&
        story.understand.analysisMeta.sourceCountAtAnalysis !== story.sources
          ? sourceCountLabel(story.understand.analysisMeta, story.sources)
          : `Based on ${sourceCountLabel(story.understand?.analysisMeta, story.sources)}`}
      </p>
      <ul className="mt-4 space-y-2.5">
        {story.sourceList.map((s) => (
          <li key={s.url ?? s.name} className="flex items-center justify-between gap-3 text-[13px]">
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
            <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground">{s.at}</span>
          </li>
        ))}
      </ul>
      {article.endMatter.citations.length > 0 && (
        <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
          {article.endMatter.citations.length} citation
          {article.endMatter.citations.length !== 1 ? "s" : ""} across{" "}
          {article.endMatter.sourceCount} source{article.endMatter.sourceCount !== 1 ? "s" : ""}.
        </p>
      )}
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
        nyuz is not the source. This explanation is generated — open the reporting before acting on
        it.
      </p>
    </div>
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
