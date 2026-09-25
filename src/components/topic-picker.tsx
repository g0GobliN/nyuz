import { Check, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chip } from "@/components/kit";
import { searchTopics, type TopicSearch } from "@/lib/server/topics";
import {
  creatableFrom,
  isValidTopic,
  MAX_TOPIC_LABEL,
  type TopicRejection,
  topicSlug,
  validateTopicLabel,
} from "@/lib/topics";
import { TOPIC_POOL } from "@/lib/topics-pool";
import { cn } from "@/lib/utils";

/**
 * One selector, used by onboarding and by the topics page.
 *
 * It exists as a shared component because the two screens used to disagree
 * about what a topic was — onboarding offered the pool and nothing else, the
 * topics page offered the pool plus an Add button that only lit up when the
 * typed text already matched a pool label — and both of those are now wrong in
 * the same way. A second copy of "may I follow this" would drift from the
 * server's answer, and the failure mode is a button that saves nothing.
 *
 * What the reader is shown is deliberately small: subjects, and an offer to
 * follow what they typed. Nothing about canonical rows, demand, kinds or
 * follower thresholds reaches this file, because none of it is theirs to think
 * about. To them it is "Follow Nepal".
 */

/** Keystrokes settle before a round trip. Long enough to type a word into. */
const DEBOUNCE_MS = 180;

/** Public onboarding has no session yet, so it searches the bundled pool. */
function localSearch(query: string): TopicSearch {
  const trimmed = query.trim();
  const suggestions = TOPIC_POOL.filter(
    (label) => trimmed === "" || label.toLowerCase().includes(trimmed.toLowerCase()),
  ).map((label) => ({
    slug: topicSlug(label),
    label,
    predefined: true,
    followed: false,
  }));

  if (trimmed === "") return { suggestions, creatable: null, rejection: null };

  const validated = validateTopicLabel(trimmed);
  if (!isValidTopic(validated)) {
    return { suggestions, creatable: null, rejection: validated.rejected };
  }

  return {
    suggestions,
    creatable: creatableFrom(
      trimmed,
      suggestions.map((suggestion) => suggestion.slug),
    ),
    rejection: null,
  };
}

/**
 * Searches as the reader types, and never lets an older answer win.
 *
 * Responses can land out of order, and a stale suggestion list is worse here
 * than a slow one: it would offer to create a topic that the newer query has
 * already found, which is the duplicate this whole design avoids.
 */
function useTopicSearch(
  query: string,
  remoteSearch: boolean,
): { result: TopicSearch; loading: boolean } {
  const [result, setResult] = useState<TopicSearch>(() => localSearch(query));
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    setResult(localSearch(query));

    if (!remoteSearch || query.trim() === "") {
      setLoading(false);
      return;
    }

    setLoading(true);

    const timer = setTimeout(() => {
      void searchTopics({ data: { query } })
        .then((next) => {
          if (generation.current !== mine) return;
          setResult(next);
        })
        .catch((error: unknown) => {
          if (generation.current !== mine) return;
          console.error(error);
        })
        .finally(() => {
          if (generation.current === mine) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, remoteSearch]);

  return { result, loading };
}

/** Said in the reader's terms. None of these mention slugs, rows or limits. */
const REJECTION_COPY: Record<TopicRejection, string> = {
  empty: "",
  "too-short": "A topic needs at least two characters.",
  "too-long": `Keep it under ${MAX_TOPIC_LABEL} characters — a subject, not a sentence.`,
  unusable: "Add a word or two so we know what to watch for.",
};

export type TopicPickerProps = {
  /** Labels the reader currently follows, in their own spelling. */
  selected: string[];
  /** Called with the label to follow, or the one to drop if already followed. */
  onToggle: (label: string) => void;
  /** True when following one more would exceed the plan. Suggestions grey out. */
  atCap?: boolean;
  /** Called instead of `onToggle` when a new follow would cross the cap. */
  onCapHit?: (() => void) | undefined;
  /** Shared custom-topic discovery requires a signed-in caller. */
  remoteSearch?: boolean;
  placeholder?: string;
};

export function TopicPicker({
  selected,
  onToggle,
  atCap = false,
  onCapHit,
  remoteSearch = true,
  placeholder = "Search or add a topic…",
}: TopicPickerProps) {
  const [query, setQuery] = useState("");
  const { result } = useTopicSearch(query, remoteSearch);

  const followed = new Set(selected.map(topicSlug));
  const isFollowed = (label: string) => followed.has(topicSlug(label));

  const follow = (label: string) => {
    if (isFollowed(label)) {
      onToggle(label);
      return;
    }
    if (atCap) {
      onCapHit?.();
      return;
    }
    onToggle(label);
    setQuery("");
  };

  const creatable = result.creatable;
  const rejection = query.trim() !== "" && result.rejection ? result.rejection : null;

  return (
    <div>
      <div className="flex items-center gap-2.5 rounded-full border border-input bg-surface px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !creatable) return;
            e.preventDefault();
            follow(creatable.label);
          }}
          placeholder={placeholder}
          aria-label="Search or add a topic"
          className="h-12 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-[15px]"
        />
      </div>

      {/* The create affordance sits above the suggestions when the typed text
          names nothing that exists, because in that case it is the answer to
          what the reader just asked, and everything below it is a near miss. */}
      {creatable ? (
        <div className="mt-4">
          <p className="text-[12.5px] text-muted-foreground">
            No existing topic called “{creatable.label}”
          </p>
          <button
            onClick={() => follow(creatable.label)}
            aria-disabled={atCap}
            className={cn(
              "mt-2 inline-flex items-center gap-1.5 rounded-full border border-signal/50 px-3.5 py-1.5",
              "text-[13px] text-signal transition-all duration-300 active:scale-95",
              "hover:border-signal",
              atCap && "opacity-40",
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Follow “{creatable.label}”
          </button>
        </div>
      ) : null}

      {rejection ? (
        <p className="mt-4 text-[12.5px] text-muted-foreground">{REJECTION_COPY[rejection]}</p>
      ) : null}

      {result.suggestions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {result.suggestions.map((suggestion) => {
            const on = isFollowed(suggestion.label);
            return (
              <Chip
                key={suggestion.slug}
                active={on}
                onClick={() => follow(suggestion.label)}
                className={!on && atCap ? "opacity-40" : undefined}
              >
                {on ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                {suggestion.label}
              </Chip>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
