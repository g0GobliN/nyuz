/** One-off: install the `impact_writer_enabled` feature flag row (default off). */

import { db, main, say } from "./lib/db.ts";

main(async () => {
  const { error } = await db().from("feature_flags").upsert(
    {
      key: "impact_writer_enabled",
      label: "Shared impact writer (AI why-it-matters)",
      description:
        "When on, the :10/:25/:40/:55 stage writes one AI why-it-matters sentence per event into event_impacts. When off (default), the briefing uses the deterministic inclusion ladder only and the pipeline makes zero AI calls.",
      enabled: false,
      rollout_percent: 100,
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
  say("impact_writer_enabled flag installed (enabled: false)");
});
