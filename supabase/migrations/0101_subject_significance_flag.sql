-- nyuz -- P4: the interest-conditional admission flag.
--
-- ---------------------------------------------------------------------------
-- What turning this on changes
-- ---------------------------------------------------------------------------
--
-- `match.ts` admits an event to a topic when its shared `importance` clears the
-- topic's floor. With this flag on, it admits when the larger of that and the
-- *subject-relative* term clears it -- a topic's own signals, measured against
-- that subject's observed history (see `src/lib/pipeline/subject-significance.ts`).
--
-- The effect is one-directional by construction: the term can lift a story into
-- the briefing and alerts of the people who follow that subject, and can never
-- lower a score or remove an event anybody would have received before. A world
-- event alarms exactly as it did.
--
-- ---------------------------------------------------------------------------
-- Why it ships off
-- ---------------------------------------------------------------------------
--
-- Same reason every processing flag ships off: applying this migration changes
-- nothing until an operator enables it. The rule can admit events the shared
-- score would not, so it is measured first -- `significanceShadow` produces the
-- admission and alert comparison at every floor the product uses, and
-- `promotionVerdict` names the blockers -- and enabled afterwards.
--
-- Disabling it restores the previous behaviour immediately and exactly: the
-- context that carries the subject baselines is only built when the flag reads
-- true, and an unreadable flag reads as false.

insert into public.feature_flags (key, label, description, enabled)
values (
  'subject_significance_enabled',
  'Subject-relative significance',
  'When on, an event that is a material development for a subject you follow can '
  'reach that subject''s briefing and alerts even when its world-importance score '
  'would not have cleared the subject''s floor. Never lowers a score and never '
  'removes an event. Off means the shared importance score alone decides.',
  false
)
on conflict (key) do nothing;
