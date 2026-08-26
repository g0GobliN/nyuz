-- 0016 — what the reader actually did with a story.
--
-- **This is DDL and cannot be applied from a development machine here.** Paste it
-- into the SQL editor at https://supabase.com/dashboard/project/<ref>/sql, or run
-- it with the Supabase CLI. `npm run db:seed` will refuse it, correctly — see the
-- header of scripts/apply-seed.ts.
--
-- ---------------------------------------------------------------------------
-- Why these live on user_events
-- ---------------------------------------------------------------------------
--
-- `user_events` is already keyed `(user_id, event_id)`, which is exactly the grain
-- an engagement record has: one reader, one story. A separate table would need the
-- same key, its own policies and its own join at read time, to hold five columns
-- that are only ever read alongside the match they belong to.
--
-- ---------------------------------------------------------------------------
-- Why the explicit signals are NOT here
-- ---------------------------------------------------------------------------
--
-- `feedback` and `saved_stories` stay where they are. A vote is a statement the
-- reader chose to make and is theirs to delete; this is observation. Keeping them
-- in separate tables means "erase what I told you" and "erase what you noticed"
-- remain separable, which matters if either is ever offered on its own.
--
-- ---------------------------------------------------------------------------
-- On the counters
-- ---------------------------------------------------------------------------
--
-- `impressions` counts times the story was rendered to this reader, not times it
-- was sent. It is a smallint because a story that has been shown 32,767 times to
-- one person indicates a bug, not a popular story.
--
-- `read_ms` accumulates foreground time on the story page. It is milliseconds and
-- an integer, so it saturates around 24 days of continuous reading of one article,
-- which is a comfortable margin over the plausible.
--
-- `reached_end` is deliberately sticky. Reaching the end of a story once is a fact
-- about that story; opening it later and bouncing does not un-read it.

alter table public.user_events
  add column if not exists impressions  smallint    not null default 0,
  add column if not exists open_count   smallint    not null default 0,
  add column if not exists opened_at    timestamptz,
  add column if not exists read_ms      integer     not null default 0,
  add column if not exists reached_end  boolean     not null default false,
  add column if not exists engaged_at   timestamptz;

-- The weight recompute reads every engaged row for one reader. Without this it is
-- a sequential scan over the whole table once a second reader exists.
create index if not exists user_events_engaged_idx
  on public.user_events (user_id, engaged_at desc)
  where engaged_at is not null;

-- Readers may see their own engagement. They still cannot write it: the existing
-- "own matched events" policy is select-only, and every write below goes through a
-- server function on the service-role client. A browser that could write these
-- could inflate its own relevance, which is the one thing this data must not allow.
comment on column public.user_events.impressions is
  'Times this story was rendered to this reader. Written only by the server.';
comment on column public.user_events.read_ms is
  'Accumulated foreground milliseconds on the story page. Written only by the server.';
