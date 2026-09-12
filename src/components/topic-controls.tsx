import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { loadTopicControls, saveTopicControls } from "@/lib/server/topic-controls";
import { PLAN_LIMITS } from "@/lib/plans";
import type { PlanTier, TopicImportance } from "@/lib/supabase/types";
import { topicSlug } from "@/lib/topics";

export function TopicControls({ topic, plan }: { topic: string; plan: PlanTier }) {
  const query = useQuery({ queryKey: ["topic-controls"], queryFn: () => loadTopicControls() });
  const client = useQueryClient();
  const row = query.data?.find(
    (r) => (r.topics as { slug?: string } | null)?.slug === topicSlug(topic),
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const level = PLAN_LIMITS[plan].notificationControl;
  if (level === "basic")
    return (
      <p className="text-sm">
        Tune individual topics with{" "}
        <a href="/dashboard/billing" className="text-signal">
          Plura
        </a>
        .
      </p>
    );
  if (!row)
    return (
      <p className="text-sm">
        {query.error ? "Could not load topic controls." : "Loading controls…"}
      </p>
    );
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
              importance: data.get("importance") as TopicImportance,
              keywords: terms("keywords"),
              excludeKeywords: terms("excludeKeywords"),
            },
          });
          await client.invalidateQueries({ queryKey: ["topic-controls"] });
          setSaved(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save controls.");
        }
      }}
    >
      <label className="block text-sm">
        How much of it
        <select
          name="importance"
          defaultValue={row.importance}
          className="ml-3 rounded-lg border border-hairline bg-surface p-2"
        >
          <option value="notable">Use briefing density</option>
          <option value="only_major">Only major</option>
          <option value="everything">Everything relevant</option>
        </select>
      </label>
      {level === "advanced" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Keywords to prioritize
            <input
              name="keywords"
              defaultValue={row.keywords.join(", ")}
              className="mt-2 w-full rounded-lg border border-hairline bg-surface p-2"
            />
          </label>
          <label className="text-sm">
            Keywords to exclude
            <input
              name="excludeKeywords"
              defaultValue={row.exclude_keywords.join(", ")}
              className="mt-2 w-full rounded-lg border border-hairline bg-surface p-2"
            />
          </label>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Keyword rules are available on Omni.</p>
      )}
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
