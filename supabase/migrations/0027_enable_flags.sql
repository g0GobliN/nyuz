-- nyuz -- turn on both V2 flags
--
-- `deterministic_cluster_v2` is shadow-only by construction (src/lib/pipeline/
-- cluster.ts) -- it never changes which articles attach to which events, it
-- only starts recording, per clustering model call, whether a confident
-- deterministic guess would have agreed. Turning it on has no product risk.
--
-- `pre_analysis_demand_gate` does change behaviour: it skips pre-analysing
-- an event when none of its contributing sources are `core` or reach a
-- currently-eligible reader (0021). That is now meaningful rather than
-- nearly a no-op -- 0024 and 0026 together reclassified 27 sources from
-- `core` to `demand` (arXiv, sport, entertainment, general news, security),
-- leaving `core` as the original 60 technology sources this product's
-- matching was built around. The gate fails open on any RPC error
-- (src/lib/pipeline/analyse.ts, loadDemand) -- a botched read runs analysis
-- as if the gate did not exist, never silently stops it. Skipped events are
-- left `pending`, not failed -- eligible for analysis the moment a reader's
-- interest reaches them, per docs/plan2.md's demand-gate design.

update public.feature_flags set enabled = true where key = 'deterministic_cluster_v2';
update public.feature_flags set enabled = true where key = 'pre_analysis_demand_gate';
