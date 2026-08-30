-- nyuz — cluster v2 shadow flag (docs/track.md phase 7)
--
-- Adds the flag `src/lib/pipeline/cluster.ts` reads to decide whether to
-- compute (never act on) a deterministic same/different verdict alongside
-- every model call, for later comparison. Off by default. Turning it on
-- changes nothing about which articles attach to which events — it only
-- starts recording, per model call, whether a confident deterministic
-- verdict would have agreed with the model. See `describeCluster`'s
-- "shadow N/M agreed" line and `ClusterReport.shadowDecidable` /
-- `shadowAgreed` once this is applied and turned on.
--
-- No SQL function needed here, unlike 0020/0021 — this is a plain
-- `feature_flags.enabled` read, the same pattern `deep_explain` already uses
-- in src/lib/server/briefing.ts.

insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  (
    'deterministic_cluster_v2',
    'Cluster v2 shadow mode',
    'Computes a deterministic same/different verdict alongside every clustering '
    'model call, for comparison only — never changes which articles attach to '
    'which events. Off by default; see docs/track.md phase 7 for what to check '
    'before ever trusting the shadow numbers.',
    false,
    100
  )
on conflict (key) do nothing;
