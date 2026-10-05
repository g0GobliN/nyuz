import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { loadTopicControls, saveTopicControls } from "@/lib/server/topic-controls";
import {
  PLAN_LIMITS,
  PLAN_NAMES,
  keywordCounterCopy,
  keywordPoolUsed,
  nextPlanUp,
} from "@/lib/plans";
import type { PlanTier, TopicImportance } from "@/lib/supabase/types";
import { topicSlug } from "@/lib/topics";
import { cn } from "@/lib/utils";

/**
 * The floor every field in the dashboard uses: 16px on phones, the desktop size
 * from `md` up.
 *
 * iOS Safari zooms the whole page in when a control under 16px takes focus, and
 * it does not zoom back out on blur — the reader is left on a magnified page
 * until they pinch. `text-sm` on the label would otherwise hand these three
 * 14px and reintroduce exactly that.
 */
const FIELD = "rounded-lg border border-hairline bg-surface p-2 text-[16px] md:text-[14.5px]";

export function TopicControls({ topic, plan }: { topic: string; plan: PlanTier }) {
  const query = useQuery({ queryKey: ["topic-controls"], queryFn: () => loadTopicControls() });
  const client = useQueryClient();
  const row = query.data?.find(
    (r) => (r.topics as { slug?: string } | null)?.slug === topicSlug(topic),
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<{ keywords: string; excludeKeywords: string } | null>(null);
  const level = PLAN_LIMITS[plan].notificationControl;
  const cap = PLAN_LIMITS[plan].topicKeywords;

  // A save can only update a row that exists: user_topics rows are created at
  // onboarding, so until the query lands there is nothing to save into, and a
  // submit would post an empty topicId only for the uuid validator to reject it
  // as a raw server error. Hold the panel until the row exists.
  if (!row)
    return (
      <p className="text-sm">
        {query.error ? "Could not load topic controls." : "Loading controls…"}
      </p>
    );

  // The counter counts the words on screen, not the words on the server — a
  // reader typing their fifth term needs to see the boundary they are about to
  // cross, and the saved row only knows the last save.
  const liveTerms = draft ?? {
    keywords: row.keywords.join(", "),
    excludeKeywords: row.exclude_keywords.join(", "),
  };
  const used = keywordPoolUsed(liveTerms.keywords, liveTerms.excludeKeywords);
  const counter = keywordCounterCopy(plan, used);

  // The dial is Plura+; free readers see the panel for keywords alone.
  const showDial = level !== "basic";

  return (
    <form
      key={row.topic_id}
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        setError("");
        const data = new FormData(e.currentTarget);
        const terms = (key: string) =>
          String(data.get(key) ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        try {
          await saveTopicControls({
            data: {
              topicId: row.topic_id,
              importance: (data.get("importance") as TopicImportance) ?? "notable",
              keywords: terms("keywords"),
              excludeKeywords: terms("excludeKeywords"),
            },
          });
          await client.invalidateQueries({ queryKey: ["topic-controls"] });
          setDraft(null);
          setSaved(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save controls.");
        }
      }}
    >
      {showDial ? (
        <label className="block text-sm">
          How much of it
          <select
            name="importance"
            defaultValue={row?.importance ?? "notable"}
            className={cn("ml-3", FIELD)}
          >
            <option value="notable">Use briefing density</option>
            <option value="only_major">Only major</option>
            <option value="everything">Everything relevant</option>
          </select>
        </label>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Keywords to prioritize
          <input
            name="keywords"
            defaultValue={row?.keywords.join(", ") ?? ""}
            placeholder="e.g. releases, security"
            onChange={(e) => setDraft((p) => ({ ...(p ?? liveTerms), keywords: e.target.value }))}
            className={cn("mt-2 w-full", FIELD)}
          />
        </label>
        <label className="text-sm">
          Keywords to exclude
          <input
            name="excludeKeywords"
            defaultValue={row?.exclude_keywords.join(", ") ?? ""}
            placeholder="e.g. rumours, pricing"
            onChange={(e) =>
              setDraft((p) => ({ ...(p ?? liveTerms), excludeKeywords: e.target.value }))
            }
            className={cn("mt-2 w-full", FIELD)}
          />
        </label>
      </div>
      {counter ? (
        <p className="text-[12.5px] text-muted-foreground">
          {counter} ·{" "}
          <a href="/dashboard/billing" className="text-signal">
            See {PLAN_NAMES[nextPlanUp(plan) ?? plan]}
          </a>
        </p>
      ) : null}
      <button className="rounded-lg border border-hairline px-3 py-2 text-sm">Save controls</button>
      {saved && (
        <span role="status" className="ml-3 text-sm">
          Saved
        </span>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
