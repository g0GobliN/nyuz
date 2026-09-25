-- nyuz -- M3: revision-aware delivery.
--
-- ---------------------------------------------------------------------------
-- The suppression this replaces
-- ---------------------------------------------------------------------------
--
-- Delivery suppression is real and load-bearing: `user_events.briefed_at` is the
-- durable marker (digest history may be purged independently), `loadMatches`
-- filters `briefed_at is null and expired_at is null`, `alreadyBriefed` excludes
-- every event id the reader has ever been sent, and
-- `suppressDeliveredDuplicates` treats a same-id repeat as a duplicate.
--
-- Together those make one delivery final. Nothing about the design was wrong --
-- they are what stops a reader seeing the same story twice -- but they cannot
-- tell "the same story again" from "the same story, materially developed", and
-- before this migration the second case was indistinguishable from the first.
--
-- `delivered_revision` is the missing third value. The comparison becomes:
--
--   event.material_revision <= user_events.delivered_revision   -> suppressed
--   event.material_revision >  user_events.delivered_revision   -> sendable
--
-- and the reopening that makes it sendable (clearing `briefed_at`/`expired_at`)
-- happens in `match.ts`, only when that comparison holds. The durable markers
-- keep working exactly as they did for everything else.
--
-- ---------------------------------------------------------------------------
-- Why digest_items needs it too
-- ---------------------------------------------------------------------------
--
-- `alreadyBriefed` reads delivery history, and delivery history is purged.
-- Stamping the revision on `digest_items` means the history itself carries what
-- was delivered, so revision eligibility survives a purge instead of silently
-- reverting to "never delivered" -- which would re-brief an untouched story once
-- old digests aged out. Default 0 is correct for every existing row: revision 0
-- is what a never-revised event has always been.

alter table public.user_events
  add column delivered_revision integer not null default 0;

alter table public.user_events
  add constraint user_events_delivered_revision_nonnegative check (delivered_revision >= 0);

comment on column public.user_events.delivered_revision is
  'The latest event material_revision this reader actually received (0097/0099). Written only when a digest delivers the event -- not when the event is merely matched, and not when the relationship is reopened. Compared against events.material_revision to decide whether a closed relationship may reopen.';

alter table public.digest_items
  add column delivered_revision integer not null default 0;

comment on column public.digest_items.delivered_revision is
  'The event material_revision at the moment this item was delivered. Lets delivery history answer "which revision did this reader get" without joining, and keeps that answer alive after digest history is purged.';

-- ---------------------------------------------------------------------------
-- Subject significance
-- ---------------------------------------------------------------------------
--
-- Topic-relative, computed once per (reader, event) in the match stage and read
-- by the briefing. It lives here rather than on `events` because it is a
-- property of a *topic's* history, not of the event: the same album release is
-- routine for a music topic with a hundred releases in its recent coverage and
-- unusual for one with three. Null means "not computed" -- every row written
-- before this migration, and every event matched by a topic with no history to
-- compare against.
--
-- Deliberately a signal, not a verdict: nothing gates on it. It orders within an
-- interest and can qualify an alert when relevance is already strong; it can
-- never suppress a story on its own.

alter table public.user_events
  add column subject_significance real;

comment on column public.user_events.subject_significance is
  'How unusual this event''s material delta is for this topic''s own observed history (subject-significance.ts). Computed in the match stage, read by the briefing for ordering and alert qualification. Never a gate: null and 0 mean "no evidence", not "unimportant".';
