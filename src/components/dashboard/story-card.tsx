import { Link } from "@tanstack/react-router";
import { Bookmark, EyeOff, Sparkles, ThumbsDown, ThumbsUp, VolumeX } from "lucide-react";
import { becauseYouFollow } from "@/lib/matching";
import type { Story } from "@/lib/story";
import type { FeedbackState, Vote } from "@/lib/feedback-store";
import { formatStoryTime } from "@/lib/story-time";
import { cn } from "@/lib/utils";
import { briefingText } from "@/lib/understand";

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
  onDismiss,
  onMute,
}: {
  story: Story;
  /** The reader's own topics that matched this story. Empty renders no claim. */
  matched?: string[];
  index: number;
  feedback: FeedbackState;
  onVote: (id: string, v: Vote) => void;
  onSave: (id: string) => void;
  onDismiss: (id: string) => void;
  onMute: (topic: string) => void;
}) {
  const vote = feedback.votes[story.id];
  const saved = feedback.saved.includes(story.id);
  const primaryTopic = story.topics[0];
  const because = becauseYouFollow(matched);

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

      <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
        {briefingText(story.what)}
      </p>

      {because || story.why ? (
        <div className="mt-4 rounded-2xl bg-surface-2 p-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Why it matters to you
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed">
            {because ? <span>{because} </span> : null}
            {story.why}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
        <span>
          {story.sources} sources <span aria-hidden>→</span> 1 event
        </span>
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
          onClick={() => onSave(story.id)}
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
