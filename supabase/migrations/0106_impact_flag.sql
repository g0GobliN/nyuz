-- nyuz -- the impact writer is opt-in.
--
-- Migration 0105 admitted the `impact` feature to the reservation gate; this
-- one installs the flag that decides whether the stage runs at all. Default
-- OFF: the code-first policy is zero provider calls unless an operator turns
-- the writer on deliberately. The briefing needs nothing from this stage --
-- its deterministic inclusion ladder is the shipping behaviour; the writer
-- only upgrades rung 3 into a per-story sentence for an operator who chooses
-- to spend on it.

insert into public.feature_flags (key, label, description, enabled, rollout_percent)
values (
  'impact_writer_enabled',
  'Shared impact writer (AI why-it-matters)',
  'When on, the :10/:25/:40/:55 stage writes one AI why-it-matters sentence per '
  'event into event_impacts. When off (default), the briefing uses the '
  'deterministic inclusion ladder only and the pipeline makes zero AI calls.',
  false,
  100
)
on conflict (key) do nothing;
