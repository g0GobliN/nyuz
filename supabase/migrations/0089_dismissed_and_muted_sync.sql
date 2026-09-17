-- Dismissals and per-card topic mutes were local-only (see feedback-store.ts),
-- so the same reader saw a different feed on every device. Both get a table
-- of their own now, mirroring saved_stories: a plain "hide this" record, not
-- a weight input.

create table public.dismissed_stories (
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  event_id     uuid        not null references public.events (id)   on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- Keyed by the topic label text, not topic_id: this mutes a tag on the story
-- card, which is not necessarily a topic the reader follows in user_topics.
create table public.muted_topics (
  user_id  uuid        not null references public.profiles (id) on delete cascade,
  topic    text        not null,
  muted_at timestamptz not null default now(),
  primary key (user_id, topic)
);

alter table public.dismissed_stories enable row level security;
alter table public.muted_topics      enable row level security;

create policy "own dismissed stories" on public.dismissed_stories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own muted topics" on public.muted_topics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
