import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AlertCircle,
  Bookmark,
  EyeOff,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  VolumeX,
} from "lucide-react";
import { recoverCardSummary } from "@/lib/editorial";
import { becauseYouFollow } from "@/lib/matching";
import { sourceCount, type Story } from "@/lib/story";
import type { FeedbackState, Vote } from "@/lib/feedback-store";
import { formatStoryTime } from "@/lib/story-time";
import { cn } from "@/lib/utils";
import { admissibleReaderSentence, normalizeSummary } from "@/lib/reader-evidence";
import { briefingText, cardSummaryRefused } from "@/lib/understand";

const TONE: Record<Story["importance"], string> = {
  High: "text-signal border-signal/40",
  Medium: "text-foreground border-border",
  Notable: "text-muted-foreground border-hairline",
};

export function StoryCard({
  story,
  matched = [],
  index,
  feedback,
  onVote,
  onSave,
  saveError,
  onDismiss,
  onMute,
}: {
  story: Story;
  /** The reader's own topics that matched this story. Empty renders no claim. */
  matched?: string[];
  index: number;
  feedback: FeedbackState;
  onVote: (id: string, v: Vote) => void;
  onSave: (story: Story) => void;
  saveError?: string | undefined;
  onDismiss: (id: string) => void;
  onMute: (topic: string) => void;
}) {
  const vote = feedback.votes[story.id];
  const saved = feedback.saved.includes(story.id);
  const primaryTopic = story.topics[0];
  // The server's own answer wins: `personalizationFor` computes it from the
  // reader's real follow graph and only when the event reached them through
  // their own subscriptions. `because` is the client fallback for the same
  // question, from the reader's chosen topics — never a significance claim.
  const because = becauseYouFollow(matched);
  const provenance = story.personalization?.explanation ?? because;
  /**
   * The summary line. The stored event summary is the fast path -- it costs
   * nothing and it is what nearly every card prints.
   *
   * The slower path exists because the card and the story page must not have
   * different standards for trustworthy prose: this card used to publish the
   * GitHub Taskflow list item as its summary while the story page had withheld
   * it as an incomplete explanatory statement (2026-10-14). When the deck
   * predicate refuses the stored line, the card recovers the story's own opening
   * published sentence instead of printing the refused text, and withholds the
   * line entirely when there is nothing valid to recover. Composing is 150-220
   * ms, and it happens only for a card whose stored line was refused -- 13 of
   * 679 summary lines in the 2026-10-15 window, and 24 more once the shared
   * sentence boundary is asked -- which is also why it is memoized on the story
   * the way the article component memoizes its own composition.
   *
   * Two checks, and the boundary is the wider one (the arbiter's ruling of
   * 2026-10-15, option 1). `cardSummaryRefused` owns the card's own two classes,
   * the deck predicate and the reference predicate. `admissibleReaderSentence`
   * is the shared boundary the story page and the email both ask, and asking it
   * here is what refuses the rest of the measured set: a feed description
   * truncated with an ellipsis, a commit record carrying its author's email
   * (whose card headline was often a commit sha), a raw media payload, marketing
   * copy, an unsupported attribution or an unattributed quotation -- **24 of 679
   * live card lines were printing text that boundary refuses.** The order is the
   * ruling's too: the checks come first, so a refused line is never rendered
   * just because the fast path can render it.
   */
  const summary = useMemo(() => {
    const raw = story.what.trim();
    // No stored line at all is not a refusal to remedy: most events carry none,
    // and composing one here would pay 150-220 ms for every such card in a feed.
    if (raw === "") return "";
    const stored = briefingText(raw);
    if (stored === "") {
      // `briefingText` withheld the line, and the two reasons are different
      // decisions. Provider furniture or a metadata leak keeps its own
      // behaviour at the card and recovers nothing (the ruling of 2026-10-14).
      // A block it cut is the shared boundary's `trailing_ellipsis` refusal, so
      // it goes down the same recovery path as any other refused line -- the
      // ruling of 2026-10-15, whose test is that a truncated description "no
      // longer reaches readers through the card summary".
      if (normalizeSummary(raw).reason !== null) return "";
      return recoverCardSummary(story);
    }
    if (cardSummaryRefused(raw) || !admissibleReaderSentence(stored))
      return recoverCardSummary(story);
    return stored;
  }, [story]);

  return (
    <article className="reveal rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
      <div className="flex items-center gap-3">
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-signal">
          {story.org}
        </span>
        <span
          className={cn(
            "ml-auto rounded-full border px-2.5 py-0.5 text-[11px]",
            TONE[story.importance],
          )}
        >
          {story.importance}
        </span>
      </div>

      <Link
        to="/dashboard/story/$id"
        params={{ id: story.id }}
        search={{ from: "home" }}
        className="group mt-3 block"
      >
        <h2 className="text-[19px] font-medium leading-snug tracking-tight group-hover:underline group-hover:underline-offset-4 sm:text-[21px]">
          {story.title}
        </h2>
      </Link>

      {/* An event whose feed description was furniture has no summary to show,
          and neither has one whose stored summary the deck predicate refused and
          whose story publishes nothing valid to recover. The card prints its
          headline and its sources instead of a credit. */}
      {summary ? (
        <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{summary}</p>
      ) : null}

      {/*
        There is no "Why it matters" block on this card, and that is the
        contract rather than an omission. Under the pure-code rule the only
        significance rungs that can fire are the coverage count (27 of the
        reader's 1,000 matches) and the money consequence (7) — everything
        stronger is written by the `analyse` pass, which this product does not
        run. Every widening measured at about half precision, printing a
        jellyfish "suspended in water" or a 2011 product halted in a
        retrospective. The arbiter ruled 2026-10-17 that the card is complete
        without the block: headline, what happened, and the reader's own
        provenance. `story.why` is still carried by the payload and still
        written by the ladder, so a deterministic source can bring the slot
        back without a migration — the slot simply makes no promise today.
      */}
      {provenance ? (
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          <span className="font-medium">Why you're seeing this · </span>
          {provenance}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
        {/*
          Corroboration is a claim; one outlet is the absence of one. On the
          2026-10-01 briefing every card read "1 source → 1 event", a fact with
          no variation, so the chip prints only when the count says something.
          The timestamp keeps the line company when it does not.
        */}
        {story.sources > 1 ? (
          <span>
            {sourceCount(story.sources)} <span aria-hidden>→</span> 1 event
          </span>
        ) : null}
        <span className="tabular-nums">{formatStoryTime(story.publishedAt)}</span>
        <span className="flex flex-wrap gap-1.5">
          {story.topics.map((t) => (
            <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">
              {t}
            </span>
          ))}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        <Link
          to="/dashboard/story/$id"
          params={{ id: story.id }}
          search={{ from: "home" }}
          className="rounded-full border border-border px-3.5 py-1.5 text-[12.5px] transition-colors hover:bg-muted"
        >
          Read <span aria-hidden>→</span>
        </Link>
        <button
          onClick={() => onSave(story)}
          aria-pressed={saved}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors",
            saved ? "border-signal/50 text-signal" : "border-border hover:bg-muted",
          )}
        >
          <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
          {saved ? "Saved" : "Save"}
        </button>

        <div className="ml-auto flex items-center gap-1">
          <IconToggle
            label="Useful"
            active={vote === "useful"}
            onClick={() => onVote(story.id, "useful")}
          >
            <ThumbsUp className={cn("h-3.5 w-3.5", vote === "useful" && "fill-current")} />
          </IconToggle>
          <IconToggle
            label="Not useful"
            active={vote === "not-useful"}
            onClick={() => onVote(story.id, "not-useful")}
          >
            <ThumbsDown className={cn("h-3.5 w-3.5", vote === "not-useful" && "fill-current")} />
          </IconToggle>
          <IconToggle label="Not interested" onClick={() => onDismiss(story.id)}>
            <EyeOff className="h-3.5 w-3.5" />
          </IconToggle>
          {primaryTopic ? (
            <IconToggle
              label={`Mute ${primaryTopic}`}
              onClick={() => onMute(primaryTopic)}
              active={feedback.mutedTopics.includes(primaryTopic)}
            >
              <VolumeX className="h-3.5 w-3.5" />
            </IconToggle>
          ) : null}
        </div>
      </div>
      {/* Said out loud rather than shown by the button alone. A rollback and a
          tap the reader never made look identical otherwise, and the button
          reporting "Save" again is not a reason to believe the story went
          anywhere. Weight and the glyph carry it: --destructive is monochrome. */}
      {saveError ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-1.5 text-[12px] font-medium leading-relaxed text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{saveError}</span>
        </p>
      ) : null}
    </article>
  );
}

function IconToggle({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
        active && "feedback-pop",
        active
          ? "bg-signal/15 text-signal"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
