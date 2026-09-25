import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { sameHeadline } from "./news-signals";

type News = { id: string; title: string; first_seen_at: string };

/**
 * Which of these events may be delivered, having already been delivered before.
 *
 * Two rules, and they are about different things:
 *
 *   - **The same event again.** A duplicate unless the event has materially
 *     moved since the revision the reader received. That comparison is only
 *     possible when the caller passes `materialRevisionOf` -- the alert path
 *     does not, because re-entry is a briefing event and not an interruption --
 *     and behaves exactly as the id-only rule did before when it does not.
 *   - **A different event that is the same story.** Unchanged, including the
 *     48-hour window: two outlets, two events, one story.
 *
 * The revision half reads `digest_items.delivered_revision`, so a story the
 * reader received at revision N is still recognised as received after the
 * digest itself has been purged.
 */
export async function suppressDeliveredDuplicates(
  db: SupabaseClient<Database>,
  userId: string,
  ids: string[],
  now: Date,
  kind: "briefing" | "alert",
  materialRevisionOf?: ReadonlyMap<string, number>,
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const since = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const [events, digests] = await Promise.all([
    db.from("events").select("id,title,first_seen_at").in("id", ids),
    db
      .from("digests")
      .select("digest_id")
      .eq("user_id", userId)
      .eq("kind", kind)
      .gte("generated_at", since),
  ]);
  if (events.error || digests.error) throw new Error("Duplicate coverage check unavailable");
  const digestIds = (digests.data ?? []).map((d) => d.digest_id);
  const seen: News[] = [];
  const deliveredRevision = new Map<string, number>();
  if (digestIds.length) {
    const previous = await db
      .from("digest_items")
      .select("event_id, delivered_revision")
      .in("digest_id", digestIds);
    if (previous.error) throw new Error(previous.error.message);
    for (const item of previous.data ?? []) {
      deliveredRevision.set(
        item.event_id,
        Math.max(deliveredRevision.get(item.event_id) ?? 0, item.delivered_revision ?? 0),
      );
    }
    const previousIds = (previous.data ?? []).map((item) => item.event_id);
    if (previousIds.length) {
      const delivered = await db
        .from("events")
        .select("id,title,first_seen_at")
        .in("id", previousIds);
      if (delivered.error) throw new Error(delivered.error.message);
      seen.push(...delivered.data);
    }
  }
  const byId = new Map((events.data ?? []).map((e) => [e.id, e]));
  const keep = new Set<string>();
  for (const id of ids) {
    const e = byId.get(id);
    if (!e) continue;
    const currentRevision = materialRevisionOf?.get(id) ?? 0;
    if (
      seen.some((s) => {
        if (s.id === e.id) {
          // The same event. With no revision information this is the duplicate
          // it always was; with it, the event is a duplicate only while the
          // reader's delivered revision still covers the current one.
          if (materialRevisionOf === undefined) return true;
          return (deliveredRevision.get(s.id) ?? 0) >= currentRevision;
        }
        return (
          Math.abs(Date.parse(s.first_seen_at) - Date.parse(e.first_seen_at)) <= 48 * 3_600_000 &&
          sameHeadline(s.title, e.title)
        );
      })
    )
      continue;
    seen.push(e);
    keep.add(id);
  }
  return keep;
}
