-- nyuz -- shared event impacts (docs/plan2.md phase 2, docs/track.md)
--
-- Removes the automatic per-user-per-story AI call before scale makes it
-- expensive, not because it is expensive today. The desired shape:
--
--   shared event analysis, once
--   -> shared impact intelligence, once per event
--   -> deterministic user matching (already true, stage 5)
--   -> deterministic digest assembly (this migration's purpose)
--   -> personalised AI only on explicit request (Story Ask, already built)
--
-- ---------------------------------------------------------------------------
-- Why a separate table and not a column on `events`
-- ---------------------------------------------------------------------------
--
-- `title`, `what_happened`, `before_state`, `after_state` are flat columns
-- because they are written exactly once, atomically, alongside the rest of
-- analysis, with no independent lifecycle. This needs one: most events get
-- their impact written the same way, during analysis (src/lib/pipeline/
-- analyse.ts), but events analysed *before* this migration existed have
-- none, and digest.ts (src/lib/pipeline/digest.ts) has to backfill those
-- lazily, on first need, exactly like translation will (docs/plan2.md phase
-- 1). Both paths need the same atomic claim/lock shape `events.status`
-- already uses for the analysis claim itself -- `status` here plays the
-- same role, at the impact's own granularity rather than the whole event's.
--
-- `status = 'failed'` is deliberately NOT auto-reclaimed by the backfill
-- path, matching analyse.ts's own precedent: "a failed event is not
-- retried by the schedule... an operator asks for it by name." A shared
-- resource costs money on retry too, and unattended retry of the same
-- failure is the thing this project has consistently refused to build.

create type impact_status as enum ('pending', 'generating', 'complete', 'failed');

create table public.event_impacts (
  event_id           uuid          primary key references public.events (id) on delete cascade,
  status              impact_status not null default 'pending',
  text                text,
  model               text,
  prompt_tokens       integer     not null default 0,
  completion_tokens   integer     not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index event_impacts_status_idx on public.event_impacts (status);

comment on table public.event_impacts is
  'One shared "why it matters" explanation per event, reused by every reader '
  'it is briefed to. Written once, during analysis or on first digest need. '
  'Never per-user -- see src/lib/pipeline/digest.ts.';

-- ---------------------------------------------------------------------------
-- RLS -- same shape as event_topics/events: read-only to signed-in users, no
-- write policy at all. The pipeline writes with the service-role key, which
-- bypasses RLS entirely.
-- ---------------------------------------------------------------------------

alter table public.event_impacts enable row level security;

create policy "event_impacts readable" on public.event_impacts
  for select to authenticated using (true);
