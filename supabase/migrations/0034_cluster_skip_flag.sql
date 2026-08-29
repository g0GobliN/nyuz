-- nyuz -- the cluster-skip flag (docs/plan2.md phase 7, sections 25-26)
--
-- Lets a confident deterministic verdict decide on its own, with no model
-- call: HIGH CONFIDENCE SAME attaches, HIGH CONFIDENCE DIFFERENT creates,
-- ambiguous still asks. That is plan2 section 25's shape exactly.
--
-- ---------------------------------------------------------------------------
-- Ships OFF, and must stay off until there is evidence
-- ---------------------------------------------------------------------------
--
-- Checked on 2026-08-30: `deterministic_cluster_v2` had been on since the
-- previous day and ZERO articles had been clustered in that window, so no
-- shadow measurement exists. 0033 is what starts accumulating it.
--
-- Turning this on before reading `cluster_shadow_summary()` would be choosing
-- thresholds from no data, which is the one thing the founder's instruction
-- for this phase explicitly rules out.
--
-- What to look at before enabling, and what the numbers mean:
--
--   select * from cluster_shadow_summary(30);
--
-- Two rows, and they carry very different risk (plan2 section 25):
--
--   'different'  the safe half. Disagreement means a split event: the same
--                story arrives twice, costing one extra analysis. Annoying,
--                visible, cheap.
--   'same'       the dangerous half. Disagreement means a MERGE of two
--                unrelated stories -- "silently misinforms every reader who
--                receives it", and unlike a split it is not visible as a
--                duplicate.
--
-- So a blended accuracy number is not good enough to decide on: the 'same'
-- rate needs to be near-perfect over a meaningful sample, while the
-- 'different' rate can carry a little error. If only one of the two is
-- trustworthy, the honest next step is to skip only that half -- which would
-- be a code change, not this flag.
--
-- Requires `deterministic_cluster_v2` as well: acting on the verdict without
-- also recording it would remove the evidence for whether acting was right.

insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  (
    'deterministic_cluster_skip',
    'Cluster v2 skips the model',
    'Lets a confident deterministic same/different verdict decide without a '
    'model call. OFF, and must stay off until cluster_shadow_summary() shows a '
    'trustworthy sample -- especially for the "same" verdict, where being wrong '
    'merges two unrelated stories. See docs/track.md phase 7.',
    false,
    100
  )
on conflict (key) do nothing;
