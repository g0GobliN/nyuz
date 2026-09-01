/** Read-only launch backlog classification. */
import { createAdminClient } from "@/lib/supabase/admin";

const db = createAdminClient(process.env as Record<string, string | undefined>);

const pending: { id: string }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("events")
    .select("id")
    .is("analysed_at", null)
    .eq("status", "pending")
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  pending.push(...(data ?? []));
  if ((data?.length ?? 0) < 1000) break;
}

let demanded = 0;
for (let offset = 0; offset < pending.length; offset += 100) {
  const { data, error } = await db.rpc("events_with_demand", {
    p_event_ids: pending.slice(offset, offset + 100).map((row) => row.id),
  });
  if (error) throw new Error(error.message);
  demanded += (data ?? []).filter((row) => row.has_demand).length;
}

const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const [{ count: unclustered }, { data: failedDigests }, { data: reservations }] = await Promise.all(
  [
    db.from("articles").select("id", { count: "exact", head: true }).is("event_id", null),
    db
      .from("digests")
      .select("digest_id, scheduled_for, item_count, generation_tokens")
      .eq("status", "failed"),
    db
      .from("ai_usage_ledger")
      .select("reserved_tokens")
      .gte("created_at", monthStart.toISOString())
      .gt("reserved_tokens", 0)
      .eq("prompt_tokens", 0)
      .eq("completion_tokens", 0),
  ],
);

console.log(`unclustered articles: ${unclustered ?? 0}`);
console.log(`pending events: ${pending.length}`);
console.log(`pending with current demand: ${demanded}`);
console.log(`pending with no current demand: ${pending.length - demanded}`);
console.log(`failed digests: ${failedDigests?.length ?? 0}`);
for (const digest of failedDigests ?? []) {
  console.log(
    `  ${digest.digest_id}: scheduled ${digest.scheduled_for}, items ${digest.item_count}, tokens ${digest.generation_tokens}`,
  );
}
console.log(
  `current-month unsettled AI reservations: ${reservations?.length ?? 0} calls, ${(reservations ?? []).reduce((sum, row) => sum + row.reserved_tokens, 0)} tokens`,
);
