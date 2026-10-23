import { AlertCircle, Bookmark, ExternalLink, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { composeArticle } from "@/lib/editorial";
import { articleMinutes, withoutOpening } from "@/lib/reader-article";
import { storyOpening } from "@/lib/reader-opening";
import { sourceRailLabel } from "@/lib/story";
import type { Story } from "@/lib/story";
import { formatStoryTime } from "@/lib/story-time";
import { cn } from "@/lib/utils";

type Vote = "useful" | "not-useful";

/** The card chrome the rail has used since the Understand page shipped. */
const CARD = "rounded-2xl border border-hairline bg-surface p-5";
const CARD_LABEL = "text-[11px] uppercase tracking-[0.16em] text-muted-foreground";

/**
 * The article's reading measure — 34 rem (544 px), applied to the prose only.
 *
 * The story page carried the widest prose in the product: a 669 px column at
 * 14.5 px sets **109 characters on a full line** (measured live 2026-10-21,
 * `docs/design-audit-2026-10-21.md` S6), against the 85–94 the feed lives in.
 * The audit proposed 36 rem, which lands at 94 cpl on its own arithmetic
 * (109 characters in 669 px = 6.14 px per character); 34 rem lands at **89**,
 * inside the band, and takes the 16 px deck from 88 to **72** — the comfort
 * range for display type.
 *
 * The headline and its meta line deliberately stay full width: a 46 px headline
 * needs the wider track, and the right rail has not moved. Written as the
 * Tailwind candidate verbatim because the compiler scans source text — a
 * literal here is what emits the rule.
 */
const PROSE_MEASURE = "max-w-[34rem]";

export function StoryArticle({
  story,
  saved,
  current,
  gridClassName,
  onVote,
  onToggleSaved,
  saveError,
  onReachEnd,
}: {
  story: Story;
  saved: boolean;
  current: Vote | undefined;
  /** The reading measure, shared with whatever the page prints under the article. */
  gridClassName?: string;
  onVote: (vote: Vote) => void;
  onToggleSaved: () => void;
  saveError?: string | undefined;
  onReachEnd: () => void;
}) {
  // Composition is deterministic and costs 150-220 ms on the production
  // fixtures, and this component re-renders on every vote, save and reach-end:
  // composed once per story rather than once per tap. `story` is the query's own
  // object, so its identity only changes when the payload does.
  //
  // The page opens on the same sentence its card printed (`storyOpening`,
  // `reader-opening.ts` — arbiter ruling #11, extended to these surfaces
  // 2026-10-20), which is not always the deck this composition chose: a story
  // delivered in a briefing opens on the sentence the briefing stored, and a
  // matched story opens on the line its card carries. The body is then stripped
  // of any sentence equal to that opening, so the reader cannot meet the same
  // sentence twice (`withoutOpening`).
  const { article, opening } = useMemo(() => {
    const composed = composeArticle(story);
    // The card's sentence when there is one; the composition's own deck when the
    // delivered line is one the read boundary refuses. The card is gated off its
    // surface in that second case (it has no sentence to print), so the page is
    // never opened by a card the reader could not have seen.
    const line = storyOpening(story) || composed.deck.text;
    return { article: withoutOpening(composed, line), opening: line };
  }, [story]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!end.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onReachEnd();
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -25% 0px" },
    );
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [story.id, onReachEnd]);

  // One measure, one label: the count the reader can verify is the list under
  // the label, so the caption is derived from `sourceList` itself (audit I-06)
  // rather than from the cluster-time `story.sources`, which could disagree
  // with the rows it claimed to count.
  const sourceLabel = sourceRailLabel(story.sourceList);

  return (
    <article
      className={cn(
        gridClassName ?? "mx-auto grid max-w-[40rem] gap-10 lg:max-w-none lg:grid-cols-[1fr_260px]",
        "mt-10",
      )}
    >
      <div className="min-w-0">
        <header>
          <h1 className="display text-[clamp(1.5rem,4.5vw,2.9rem)] leading-[1.12] [overflow-wrap:anywhere]">
            {story.title}
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            {story.topics[0] ? (
              <>
                <span>{story.topics[0]}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            {/* `publishedAt`, not `updatedAt`: this is the moment every list
                that led here already printed, so the header and the card cannot
                disagree about when the story broke. `updatedAt` is the last
                evidence attachment or analysis write, which is about nyuz's
                own processing and reads as publication time when it is
                unlabeled. */}
            <span>{formatStoryTime(story.publishedAt)}</span>
            <span aria-hidden>·</span>
            <span>{articleMinutes(article)} min read</span>
          </p>
          {/* A story with no usable evidence has no deck. Omitting the
              paragraph is cleaner than printing the headline twice, and it is
              the honest state: sources are listed, no summary exists.

              The opening is the same sentence the card carried. Evidence refs
              print only when that sentence is this composition's own deck and
              the refs therefore cite what it says; a delivered line carries its
              own attribution and citing a deck it did not come from would be a
              false credit. */}
          {opening ? (
            <p
              className={cn(
                PROSE_MEASURE,
                "mt-6 text-[14.5px] leading-[1.5] tracking-[-0.01em] sm:text-[16px] sm:leading-[1.6]",
              )}
            >
              {opening}
              {opening === article.deck.text ? (
                <EvidenceRefs refs={article.deck.evidence} story={story} />
              ) : null}
            </p>
          ) : null}
        </header>
        <div
          className={cn(
            PROSE_MEASURE,
            "mt-7 space-y-5 text-[14.5px] leading-relaxed [overflow-wrap:anywhere]",
          )}
        >
          {article.paragraphs.map((paragraph, index) => (
            <div key={index}>
              {paragraph.heading ? (
                <h2 className="mb-3 pt-4 font-serif text-[17px] leading-snug">
                  {paragraph.heading}
                </h2>
              ) : null}
              <p>
                {paragraph.text}
                <EvidenceRefs refs={paragraph.evidence} story={story} />
              </p>
            </div>
          ))}
        </div>
        <div ref={end} aria-hidden className="h-px" />
      </div>

      <aside
        aria-label="Sources and story actions"
        className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start"
      >
        <div className={CARD}>
          <p className={CARD_LABEL}>Scoring</p>
          <div className="mt-4 space-y-3">
            {(
              [
                ["Relevance", story.score.relevance],
                ["Importance", story.score.importance],
                ["Novelty", story.score.novelty],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div className="flex justify-between text-[12.5px]">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="tabular-nums">{value}%</span>
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-muted">
                  <div
                    className="h-1 rounded-full bg-signal transition-[width] duration-1000"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={CARD}>
          <p className={CARD_LABEL}>{sourceLabel}</p>
          <ol className="mt-4 space-y-2.5">
            {story.sourceList.map((source, index) => (
              <li
                key={index}
                id={`source-${story.id}-${index + 1}`}
                tabIndex={-1}
                className="scroll-mt-28 rounded-sm target:outline target:outline-1 target:outline-offset-4 target:outline-border focus:outline focus:outline-1 focus:outline-offset-4 focus:outline-border"
              >
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 items-center gap-1.5 hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{source.name}</span>
                    </a>
                  ) : (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{source.name}</span>
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground">
                    {source.at}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
            nyuz is not the source. Source descriptions may contain errors. Open the original
            reporting before acting on it.
          </p>
        </div>

        <div className={CARD}>
          <p className={CARD_LABEL}>Was this useful?</p>
          <div className="mt-4 flex gap-2">
            {(["useful", "not-useful"] as const).map((value) => {
              const Icon = value === "useful" ? ThumbsUp : ThumbsDown;
              const on = current === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onVote(value)}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-[12.5px] transition-colors",
                    on && "feedback-pop",
                    on
                      ? value === "useful"
                        ? "border-signal/50 bg-signal/10 text-signal"
                        : "border-border bg-muted text-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", on && "fill-current")} />
                  {value === "useful" ? "Useful" : "Not useful"}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={saved}
            onClick={onToggleSaved}
            className={cn(
              "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full border py-2 text-[12.5px] transition-colors",
              saved ? "border-signal/50 text-signal" : "border-border hover:bg-muted",
            )}
          >
            <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
            {saved ? "Saved" : "Save for later"}
          </button>
          {/* The button has already flipped back by the time this is read, which
              on its own is indistinguishable from a tap that never landed. */}
          {saveError ? (
            <p
              role="alert"
              className="mt-3 flex items-start gap-1.5 text-[12px] font-medium leading-relaxed text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{saveError}</span>
            </p>
          ) : null}
        </div>
      </aside>
    </article>
  );
}

function EvidenceRefs({ refs, story }: { refs: number[]; story: Story }) {
  return [...new Set(refs)]
    .filter((ref) => story.sourceList[ref - 1])
    .map((ref) => (
      <sup key={ref} className="ml-1 text-[10px] font-normal leading-none text-muted-foreground">
        <a
          href={`#source-${story.id}-${ref}`}
          aria-label={`Source ${ref}: ${story.sourceList[ref - 1]?.name}`}
          className="px-0.5 hover:text-foreground hover:underline"
        >
          [{ref}]
        </a>
      </sup>
    ));
}
