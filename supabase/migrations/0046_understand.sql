-- nyuz -- structured, shared event intelligence for the Understand page
--
-- One optional JSON document lives on the global event row. It is produced by
-- the same shared analysis call that already writes what_happened, scores and
-- topics, so it adds no per-reader work and no new automatic model call.
--
-- Existing events remain valid with null here. The application renders those
-- from their existing summary and feed evidence, which makes this additive and
-- safe to roll out without re-analysing the corpus.

alter table public.events
  add column if not exists understand jsonb;

comment on column public.events.understand is
  'Versioned, global event intelligence for the evidence-driven Understand page. '
  'Generated once during shared analysis; never personalised per reader.';
