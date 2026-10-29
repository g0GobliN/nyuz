/** One-off: disable the `deterministic_cluster_skip` feature flag (default off per ruling). */

import { db, main, say } from "./lib/db.ts";

main(async () => {
  const { error } = await db()
    .from("feature_flags")
    .update({
      enabled: false,
      description:
        "When on, the clustering pipeline skips the model call on confident \"different\" verdicts from the shadow log. When off (default), every article pair is scored by the model. MUST stay off until cluster_shadow_summary() shows trustworthy \"same\" verdict agreement (migration 0034, docs/track.md ruling 2026-09-05).",
      updated_at: new Date().toISOString(),
    })
    .eq("key", "deterministic_cluster_skip");
  if (error) throw new Error(error.message);
  say("deterministic_cluster_skip flag disabled (enabled: false)");
});