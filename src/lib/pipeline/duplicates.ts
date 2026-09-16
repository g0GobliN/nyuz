import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { sameHeadline } from "./news-signals";

type News = { id: string; title: string; first_seen_at: string };
export async function suppressDeliveredDuplicates(
  db: SupabaseClient<Database>,
  userId: string,
  ids: string[],
  now: Date,
  kind: "briefing" | "alert",
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
  if (digestIds.length) {
    const previous = await db.from("digest_items").select("event_id").in("digest_id", digestIds);
    if (previous.error) throw new Error(previous.error.message);
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
    if (
      seen.some(
        (s) =>
          s.id === e.id ||
          (Math.abs(Date.parse(s.first_seen_at) - Date.parse(e.first_seen_at)) <= 48 * 3_600_000 &&
            sameHeadline(s.title, e.title)),
      )
    )
      continue;
    seen.push(e);
    keep.add(id);
  }
  return keep;
}
