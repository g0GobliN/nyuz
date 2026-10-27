/**
 * Probe: what chips does the stack under review write for the events of the
 * audited digest `7268ba11-28c6-4d2d-abe6-db483dccb897`, compared with the
 * stored rows the audit measured on 2026-10-23?
 *
 * Read-only. Maps to the H-16 rework contract. Uses this worktree's types and
 * the current rule's implementation — running it from another checkout would
 * silently measure the other checkout, so make sure this is in the worktree.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { main } from "./lib/db.ts";

const DIGEST = "7268ba11-28c6-4d2d-abe6-db483dccb897";

/** What the audit measured on 2026-10-23, before this slice. */
const BEFORE: Record<string, string[]> = {
  // card 04, GTC Berlin keynote — six labels, past the 5-label cap; Music and
  // Economy are labels the current rule does not produce.
  4: ["politics", "music", "economy", "ai", "nvidia", "robotics"],
};

main(async () => {
  const admin = createAdminClient();
  console.log("Before (stored 2026-10-23):");
  for (const [card, labels] of Object.entries(BEFORE)) {
    console.log(`  card ${card}: ${labels.join(" · ")}`);
  }

  const { data: items, error: itemsError } = await admin
    .from("digest_items")
    .select("event_id, events ( title, what_happened, analysed_at )")
    .eq("digest_id", DIGEST)
    .order("position", { ascending: false });

  if (itemsError) throw itemsError;
  console.log(`\nDigest ${DIGEST}: ${items.length} items`);

  /**
   * Topic labels for the digest's events, read as two flat queries rather than
   * an embedded `topics (label)` join: the generated database types do not
   * carry that relation, and a cast to make the join typecheck would be a claim
   * about the schema the compiler cannot verify (same reason
   * reader-eval-corpus.ts reads its labels flat).
   */
  const labelById = new Map<string, string>();
  {
    const { data, error } = await admin.from("topics").select("id, label");
    if (error) throw new Error(`topics: ${error.message}`);
    for (const topic of data ?? []) labelById.set(topic.id, topic.label);
  }
  const ids = items.map((item) => item.event_id);
  const labelRowsByEvent = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("event_topics")
      .select("event_id, topic_id")
      .in("event_id", ids.slice(i, i + 200));
    if (error) throw new Error(`event_topics: ${error.message}`);
    for (const row of data ?? []) {
      const label = labelById.get(row.topic_id);
      if (!label) continue;
      labelRowsByEvent.set(row.event_id, [...(labelRowsByEvent.get(row.event_id) ?? []), label]);
    }
  }

  for (const [index, item] of items.entries()) {
    const labels = labelRowsByEvent.get(item.event_id) ?? [];
    console.log(`  card ${items.length - index}: ${labels.join(" · ")}`);
  }

  const everyEventHasLabels = items.every(
    (item) => labelRowsByEvent.get(item.event_id) !== undefined,
  );
  console.log(
    `\nProbe exit: store follows the write path through ${
      everyEventHasLabels ? "topic join ok" : "broken topic join"
    }`,
  );
});
