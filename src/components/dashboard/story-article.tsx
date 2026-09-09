import { Bookmark, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useRef } from "react";
import { composeArticle } from "@/lib/editorial";
import { articleMinutes } from "@/lib/reader-article";
import type { Story } from "@/lib/story";
import { formatStoryTime } from "@/lib/story-time";
import { sourceCountLabel } from "@/lib/understand";
import { cn } from "@/lib/utils";

type Vote = "useful" | "not-useful";

export function StoryArticle({
  story,
  saved,
  current,
  gridClassName,
  onVote,
  onToggleSaved,
  onReachEnd,
}: {
  story: Story;
  saved: boolean;
  current: Vote | undefined;
  /** The reading measure, shared with whatever the page prints under the article. */
  gridClassName?: string;
  onVote: (vote: Vote) => void;
  onToggleSaved: () => void;
  onReachEnd: () => void;
}) {
  const article = composeArticle(story);
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

  return (
    <article
      className={cn(
        gridClassName ??
          "mx-auto grid max-w-[40rem] gap-12 xl:max-w-none xl:grid-cols-[minmax(0,42rem)_minmax(0,12rem)] xl:gap-14",
        "mt-10",
      )}
    >
      <div className="min-w-0">
        <header>
          <h1 className="display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.12] [overflow-wrap:anywhere]">
            {story.title}
          </h1>
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            {story.topics[0] ? (
              <>
                <span>{story.topics[0]}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <span>{formatStoryTime(story.updatedAt ?? story.publishedAt)}</span>
            <span aria-hidden>·</span>
            <span>{articleMinutes(article)} min read</span>
          </p>
          <p className="mt-7 text-[19px] leading-[1.65] tracking-[-0.01em] sm:text-[21px]">
            {article.deck.text}
            <EvidenceRefs refs={article.deck.evidence} story={story} />
          </p>
        </header>
        <div className="mt-8 space-y-6 text-[17px] leading-[1.85] [overflow-wrap:anywhere] sm:text-[18px]">
          {article.paragraphs.map((paragraph, index) => (
            <div key={index}>
              {paragraph.heading ? (
                <h2 className="mb-5 pt-5 font-serif text-[25px] leading-snug">
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
        className="min-w-0 space-y-7 border-t border-hairline pt-6 text-[13px] text-muted-foreground xl:sticky xl:top-24 xl:self-start xl:border-t-0 xl:pt-1"
      >
        <div>
          <p className="text-[12px] leading-relaxed">
            {story.understand?.analysisMeta &&
            story.understand.analysisMeta.sourceCountAtAnalysis !== story.sources
              ? sourceCountLabel(story.understand.analysisMeta, story.sources)
              : `Based on ${sourceCountLabel(story.understand?.analysisMeta, story.sources)}`}
          </p>
          <ol className="mt-4 space-y-4">
            {story.sourceList.map((source, index) => (
              <li
                key={index}
                id={`source-${story.id}-${index + 1}`}
                tabIndex={-1}
                className="scroll-mt-28 rounded-sm target:outline target:outline-1 target:outline-offset-4 target:outline-border focus:outline focus:outline-1 focus:outline-offset-4 focus:outline-border"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px]">[{index + 1}]</span>
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-words hover:text-foreground hover:underline"
                    >
                      {source.name}
                    </a>
                  ) : (
                    <span>{source.name}</span>
                  )}
                </div>
                {source.headline ? (
                  <p className="mt-1 pl-5 text-[12px] leading-relaxed">{source.headline}</p>
                ) : null}
                <p className="mt-1 pl-5 text-[11px] tabular-nums">{source.at}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-3 border-t border-hairline pt-5">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {(["useful", "not-useful"] as const).map((value) => {
              const Icon = value === "useful" ? ThumbsUp : ThumbsDown;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={current === value}
                  onClick={() => onVote(value)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 hover:text-foreground",
                    current === value && "font-medium text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
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
              "inline-flex min-h-11 items-center gap-2 hover:text-foreground",
              saved && "text-foreground",
            )}
          >
            <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
            {saved ? "Saved" : "Save for later"}
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          nyuz is not the source. This story is written from the reporting above.
        </p>
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
