-- nyuz — row level security
--
-- Two classes of table:
--
--   Global content (topics, sources, events, articles, event_topics) — every
--   signed-in user reads the same rows. Only the pipeline writes, and it runs
--   with the service_role key, which bypasses RLS entirely. So these tables get
--   a read policy and no write policy at all; that absence is the write guard.
--
--   Per-user rows — owner-only, matched on auth.uid().
--
-- RLS is enabled on every table. A table with RLS on and no matching policy
-- denies by default, which is the behaviour we want for anything unlisted.

alter table public.profiles                  enable row level security;
alter table public.subscriptions             enable row level security;
alter table public.notification_preferences  enable row level security;
alter table public.topics                    enable row level security;
alter table public.user_topics               enable row level security;
alter table public.user_exclusions           enable row level security;
alter table public.sources                   enable row level security;
alter table public.user_source_prefs         enable row level security;
alter table public.events                    enable row level security;
alter table public.articles                  enable row level security;
alter table public.event_topics              enable row level security;
alter table public.user_events               enable row level security;
alter table public.digests                   enable row level security;
alter table public.digest_items              enable row level security;
alter table public.deliveries                enable row level security;
alter table public.feedback                  enable row level security;
alter table public.saved_stories             enable row level security;

-- ---------------------------------------------------------------------------
-- Global content — read-only to authenticated users
-- ---------------------------------------------------------------------------

create policy "topics readable"       on public.topics       for select to authenticated using (true);
create policy "sources readable"      on public.sources      for select to authenticated using (true);
create policy "events readable"       on public.events       for select to authenticated using (true);
create policy "event_topics readable" on public.event_topics for select to authenticated using (true);

-- Articles carry the source attribution behind every summary (brief §33), so
-- they must stay reachable — nyuz is never presented as the origin.
create policy "articles readable"     on public.articles     for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Owner-only rows
-- ---------------------------------------------------------------------------

create policy "own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Plan changes come from the billing webhook (service_role), never the client.
create policy "own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

create policy "own notification prefs" on public.notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own topics" on public.user_topics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own exclusions" on public.user_exclusions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own source prefs" on public.user_source_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own feedback" on public.feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own saved stories" on public.saved_stories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Match results and digests are produced by the pipeline. Users read their own
-- and never write them, so there is deliberately no insert/update policy here.
create policy "own matched events" on public.user_events
  for select using (auth.uid() = user_id);

create policy "own digests" on public.digests
  for select using (auth.uid() = user_id);

create policy "own digest items" on public.digest_items
  for select using (
    exists (
      select 1 from public.digests d
      where d.digest_id = digest_items.digest_id
        and d.user_id = auth.uid()
    )
  );

create policy "own deliveries" on public.deliveries
  for select using (
    exists (
      select 1 from public.digests d
      where d.digest_id = deliveries.digest_id
        and d.user_id = auth.uid()
    )
  );
