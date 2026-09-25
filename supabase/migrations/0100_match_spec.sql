-- nyuz -- M4: the interest match specification.
--
-- ---------------------------------------------------------------------------
-- What changes, and what deliberately does not
-- ---------------------------------------------------------------------------
--
-- `topics.terms` is a list derived from the label, and every term has to appear
-- in an event's shared signal for the topic to select it. That is precise, and it
-- is why it never went wrong loudly -- but it cannot say "this subject has more
-- than one name", which is the most ordinary thing about a subject. A reader
-- following "Arsenal" wants the North London derby; a reader following
-- "Japanese underground electronic music" wants a Tokyo label's release. Neither
-- coverage contains every word, so neither reached anybody.
--
-- `match_spec` holds the structure that can: groups of alternative names that
-- must all be satisfied, optional aliases that boost without admitting, and
-- exclusions. Its semantics live in `src/lib/match-spec.ts` and are tested there,
-- because a rule in SQL and a rule in TypeScript would be two rules.
--
-- `terms` is NOT dropped and NOT rewritten. An empty specification means
-- "derive from `terms`", which is the previous behaviour with no exceptions, so
-- applying this migration changes nothing at all until a specification is
-- written. That is the compatibility argument, and it is the reason the column
-- defaults to the empty object rather than being backfilled from labels: a
-- backfill could silently change what an existing reader receives.
--
-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------
--
-- `match_spec_source` records who wrote it:
--
--   derived   machine-derived from the label; safe, narrow
--   enriched  aliases added by an optional per-topic step, validated
--             deterministically before storage and reviewable in the console
--
-- It exists so an operator can tell a reviewable human/derived value from an
-- enriched one without diffing the JSON, and so a future promotion job can find
-- the specifications it is allowed to touch.

alter table public.topics
  add column match_spec jsonb not null default '{}'::jsonb,
  add column match_spec_source text
    check (match_spec_source is null or match_spec_source in ('derived', 'enriched')),
  add column match_spec_updated_at timestamptz;

comment on column public.topics.match_spec is
  'The interest match specification (0100): require groups (AND across groups, OR within), optional aliases that boost only, and exclusions. An empty object means "derive from terms", which is the behaviour before this migration exactly. Semantics: src/lib/match-spec.ts.';

comment on column public.topics.match_spec_source is
  'Who wrote the specification: derived (from the label) or enriched (aliases added by an optional per-topic step). Null when match_spec is empty.';

comment on column public.topics.match_spec_updated_at is
  'When the specification last changed. Null until one is written.';
