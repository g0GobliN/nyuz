import {
  createFileRoute,
  Link,
  useCanGoBack,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { DashboardShell } from "@/components/dashboard/shell";
import { StoryArticle } from "@/components/dashboard/story-article";
import { PanelLoading } from "@/components/loading";
import { Button } from "@/components/kit";
import { humanError } from "@/lib/errors";
import { useFeedback } from "@/lib/feedback-store";
import { loadPhase } from "@/lib/load-state";
import { useReadTracking } from "@/lib/use-engagement";
import type { QueueItem, ReadingQueue } from "@/lib/reading-queue";
import { asQueueSource, useReadingQueue, type QueueSource } from "@/lib/use-reading-queue";
import { withOfflineFallback } from "@/lib/offline/fallback";
import { useOnline } from "@/lib/online";
import { loadStory } from "@/lib/server/briefing";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/story/$id")({
  component: StoryDetail,
  validateSearch: (search: Record<string, unknown>): { from?: QueueSource } => {
    const from = asQueueSource(search["from"]);
    return from ? { from } : {};
  },
  head: () => ({
    meta: [{ title: "nyuz" }],
  }),
});

/**
 * The reading column and its quiet source rail, shared by the article and by
 * everything printed under it, so the prose keeps one measure down the page.
 */
const READING_GRID = "mx-auto grid max-w-[40rem] gap-10 lg:max-w-none lg:grid-cols-[1fr_260px]";

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
  const online = useOnline();
  const storyQ = useQuery({
    queryKey: ["briefing", "story", id],
    // Full payloads live in the archive for stories that were opened or saved.
    // See src/lib/offline/keys.ts for what a story row is and why it is not the
    // same thing as a list row.
    networkMode: "offlineFirst",
    queryFn: () =>
      withOfflineFallback(["briefing", "story", id], () => loadStory({ data: { id } })),
    staleTime: 60_000,
  });
  const story = storyQ.data;

  const reachedEnd = useRef(false);
  useReadTracking(story?.id, reachedEnd);

  useEffect(() => {
    reachedEnd.current = false;
  }, [id]);

  const onReachEnd = useCallback(() => {
    reachedEnd.current = true;
  }, []);

  const { state, saveErrors, vote, toggleSaved } = useFeedback();
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
      queryKey: ["briefing", "story-preview", nextId],
      // Speculative: warm the next story without blocking the current read.
      queryFn: () => loadStory({ data: { id: nextId } }),
      staleTime: 60_000,
    });
  }, [queryClient, nextId]);

  useStoryShortcuts(queue, open);

  /*
   * Which of the three states this page is in, decided where every other
   * screen decides it: src/lib/load-state.ts owns the order. A page cannot use
   * the panel component — its failure is a sentence and a way back rather than
   * the shared card — but it takes the same decision, so the reader cannot end
   * up under a branch this file reasoned about differently.
   *
   * `waiting` rather than a check on `isLoading`: React Query calls a query
   * between two retry attempts neither loading nor settled for a beat, and that
   * beat used to be read as a story the reader does not have.
   */
  const phase = loadPhase(storyQ, { hasContent: Boolean(story) });

  if (phase === "waiting") {
    return (
      <DashboardShell>
        <PanelLoading label="Preparing the event" />
      </DashboardShell>
    );
  }

  /*
   * A request that failed is not a fact about the reader's briefing.
   *
   * This screen is where a push lands, so it is opened on a cold launch far more
   * often than from inside the app — on iOS, out of a suspended app whose radio
   * has not come back yet, which is where the first request after a resume most
   * often fails. Reporting that as "This event is not in your briefing" tells
   * the reader a story is gone when it is not, and hands them nothing to do
   * about it. The failure now says what happened and offers the retry; only a
   * load that *succeeded* and returned nothing is allowed to make a claim about
   * their briefing, and that is what `loadPhase` encodes: `failed` is reachable
   * only with nothing on screen, so a background refetch that fails behind a
   * rendered story cannot replace it with an apology.
   */
  if (phase === "failed") {
    return (
      <DashboardShell>
        <p className="text-[15px]">
          {online
            ? "Couldn't load this story."
            : "You're offline, and this story isn't stored on this device."}
        </p>
        {/* The reason, verbatim enough to act on. "Couldn't load" with nothing
            under it is a dead end whether the fix is a retry or a sign-in, and
            this line is what a screenshot of this screen can be read for. */}
        <p className="mt-3 text-[13px] text-muted-foreground">
          {humanError(storyQ.error, "The request did not complete.")}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void storyQ.refetch()}
            disabled={storyQ.isFetching}
          >
            {storyQ.isFetching ? "Trying…" : "Try again"}
          </Button>
          <BackToFeed />
        </div>
      </DashboardShell>
    );
  }

  if (!story) {
    return (
      <DashboardShell>
        {/* Two reasons a story can be missing, and they ask different things of
            the reader. Offline, the useful sentence says the copy was never
            made — the usual case for a story opened from a link rather than
            from Saved. Reached only when the load answered and had nothing. */}
        <p className="text-[15px]">
          {online
            ? "This event is not in your briefing."
            : "This story was not saved on this device, so it cannot be read offline."}
        </p>
        <BackToFeed className="mt-4" />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackToFeed />
        <QueueControls queue={queue} onOpen={open} />
      </div>

      <div className="animate-rise">
        <StoryArticle
          story={story}
          saved={saved}
          current={current}
          gridClassName={READING_GRID}
          onVote={(value) => vote(story.id, value)}
          onToggleSaved={() => toggleSaved(story)}
          saveError={story ? saveErrors[story.id] : undefined}
          onReachEnd={onReachEnd}
        />

        <div className={cn(READING_GRID, "mt-14")}>
          <div className="min-w-0 space-y-10">
            {/* Story Ask is not part of V1 — see askStory in server/briefing.ts. */}
            <QueuePager queue={queue} onOpen={open} />
          </div>
        </div>
      </div>
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
          <Key>{"←"}</Key> and <Key>{"→"}</Key> move between stories
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
