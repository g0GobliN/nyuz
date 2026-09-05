-- nyuz — initial schema
--
-- Core principle from the product brief (§37): "Understand a story once.
-- Personalise it many times." Content tables (sources, articles, events) are
-- GLOBAL and written only by the pipeline. Per-user tables reference events by
-- id — an event is never copied per subscriber. That property is what keeps AI
-- cost independent of user count, so preserve it in every future migration.

create extension if not exists pgcrypto;
-- Trigram similarity backs cheap near-duplicate detection on headlines, so the
-- deterministic pass can shortlist candidates before any model call.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type plan_tier          as enum ('uno', 'plura', 'omni');
create type source_kind        as enum ('company_blog', 'news', 'rss', 'github', 'research', 'product', 'other');
create type source_pref        as enum ('normal', 'priority', 'muted');
create type topic_importance   as enum ('everything', 'notable', 'only_major');
create type topic_frequency    as enum ('daily', 'weekly', 'breaking_only');
create type event_status       as enum ('pending', 'analysing', 'complete', 'failed');
create type digest_status      as enum ('scheduled', 'generating', 'ready', 'sent', 'skipped', 'failed');
create type delivery_channel   as enum ('email', 'telegram', 'whatsapp');
create type delivery_status    as enum ('queued', 'sent', 'failed', 'bounced');
create type digest_frequency   as enum ('daily', 'weekly');
create type breaking_mode      as enum ('important', 'everything', 'off');
create type feedback_vote      as enum ('useful', 'not_useful', 'not_interested');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text        not null default '',
  timezone     text        not null default 'UTC',
  onboarded_at timestamptz,
  created_at   timestamptz not null default now()
);

create table public.subscriptions (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  plan               plan_tier   not null default 'uno',
  status             text        not null default 'active',
  current_period_end timestamptz,
  updated_at         timestamptz not null default now()
);

-- Delivery schedule and channel selection. One row per user.
create table public.notification_preferences (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  send_at     time              not null default '07:30',
  timezone    text              not null default 'UTC',
  -- ISO weekday numbers, 1 = Monday .. 7 = Sunday.
  days        smallint[]        not null default '{1,2,3,4,5}',
  channels    delivery_channel[] not null default '{email}',
  frequency   digest_frequency  not null default 'daily',
  breaking    breaking_mode     not null default 'important',
  -- 0 = minimal .. 100 = deep. Drives the importance threshold at digest time.
  density     smallint          not null default 35 check (density between 0 and 100),
  instructions text             not null default '',
  paused      boolean           not null default false,
  updated_at  timestamptz       not null default now()
);

-- ---------------------------------------------------------------------------
-- Interests
-- ---------------------------------------------------------------------------

create table public.topics (
  id    uuid primary key default gen_random_uuid(),
  slug  text unique not null,
  label text        not null
);

create table public.user_topics (
  user_id          uuid              not null references public.profiles (id) on delete cascade,
  topic_id         uuid              not null references public.topics (id)   on delete cascade,
  importance       topic_importance  not null default 'notable',
  frequency        topic_frequency   not null default 'daily',
  keywords         text[]            not null default '{}',
  exclude_keywords text[]            not null default '{}',
  -- Adjusted by the feedback loop; multiplies relevance at match time.
  weight           real              not null default 1.0 check (weight >= 0),
  muted            boolean           not null default false,
  created_at       timestamptz       not null default now(),
  primary key (user_id, topic_id)
);

-- Exclusions beat topics. Enforced at match time, not at ingest.
create table public.user_exclusions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  term    text not null,
  primary key (user_id, term)
);

-- ---------------------------------------------------------------------------
-- Content (global — pipeline writes, everyone reads)
-- ---------------------------------------------------------------------------

create table public.sources (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null,
  homepage   text,
  feed_url   text unique not null,
  kind       source_kind not null default 'rss',
  active     boolean     not null default true,
  last_fetched_at timestamptz,
  failure_count   integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.user_source_prefs (
  user_id   uuid        not null references public.profiles (id) on delete cascade,
  source_id uuid        not null references public.sources (id)  on delete cascade,
  pref      source_pref not null default 'normal',
  primary key (user_id, source_id)
);

create table public.events (
  id             uuid primary key default gen_random_uuid(),
  title          text         not null,
  what_happened  text         not null default '',
  -- 0..10, set by the shared analysis pass. Compared against per-user density.
  importance     real         not null default 0 check (importance between 0 and 10),
  novelty        real         not null default 0 check (novelty    between 0 and 10),
  status         event_status not null default 'pending',
  before_state   text,
  after_state    text,
  first_seen_at  timestamptz  not null default now(),
  last_updated_at timestamptz not null default now(),
  analysed_at    timestamptz,
  -- Token spend for this event's shared analysis. The whole cost argument rests
  -- on this being charged once, so it is recorded once, here.
  analysis_tokens integer     not null default 0
);

create table public.articles (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid references public.sources (id) on delete set null,
  event_id     uuid references public.events (id)  on delete set null,
  url          text unique not null,
  title        text        not null,
  author       text,
  excerpt      text,
  published_at timestamptz,
  fetched_at   timestamptz not null default now(),
  -- Hash of canonicalised url + title. Exact-duplicate guard before similarity.
  content_hash text        not null
);

create table public.event_topics (
  event_id   uuid not null references public.events (id) on delete cascade,
  topic_id   uuid not null references public.topics (id) on delete cascade,
  confidence real not null default 1.0,
  primary key (event_id, topic_id)
);

-- ---------------------------------------------------------------------------
-- Per-user relevance and delivery
-- ---------------------------------------------------------------------------

-- Match results. Written by a deterministic query (topics x exclusions x
-- density), never by a model — see brief §37.
create table public.user_events (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  event_id   uuid        not null references public.events (id)   on delete cascade,
  relevance  real        not null default 0,
  matched_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table public.digests (
  digest_id    uuid primary key default gen_random_uuid(),
  user_id      uuid          not null references public.profiles (id) on delete cascade,
  scheduled_for timestamptz  not null,
  generated_at timestamptz,
  status       digest_status not null default 'scheduled',
  -- A quiet day is a real outcome, not a failure: status 'skipped' with zero items.
  item_count   integer       not null default 0,
  generation_tokens integer  not null default 0,
  unique (user_id, scheduled_for)
);

create table public.digest_items (
  digest_id uuid     not null references public.digests (digest_id) on delete cascade,
  event_id  uuid     not null references public.events (id)         on delete cascade,
  position  smallint not null,
  -- The only per-user generated text. Everything else is shared.
  why_it_matters text not null default '',
  primary key (digest_id, event_id)
);

create table public.deliveries (
  id           uuid primary key default gen_random_uuid(),
  digest_id    uuid             not null references public.digests (digest_id) on delete cascade,
  channel      delivery_channel not null,
  status       delivery_status  not null default 'queued',
  attempts     smallint         not null default 0,
  last_error   text,
  delivered_at timestamptz,
  created_at   timestamptz      not null default now(),
  unique (digest_id, channel)
);

-- ---------------------------------------------------------------------------
-- Feedback loop
-- ---------------------------------------------------------------------------

create table public.feedback (
  user_id    uuid          not null references public.profiles (id) on delete cascade,
  event_id   uuid          not null references public.events (id)   on delete cascade,
  vote       feedback_vote not null,
  created_at timestamptz   not null default now(),
  primary key (user_id, event_id)
);

create table public.saved_stories (
  user_id  uuid        not null references public.profiles (id) on delete cascade,
  event_id uuid        not null references public.events (id)   on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index articles_event_idx        on public.articles (event_id);
create index articles_hash_idx         on public.articles (content_hash);
create index articles_published_idx    on public.articles (published_at desc);
-- Shortlists near-duplicate headlines cheaply, ahead of any model call.
create index articles_title_trgm_idx   on public.articles using gin (title gin_trgm_ops);

create index events_importance_idx     on public.events (importance desc);
create index events_status_idx         on public.events (status) where status <> 'complete';
create index events_recent_idx         on public.events (first_seen_at desc);

create index event_topics_topic_idx    on public.event_topics (topic_id);
create index user_topics_topic_idx     on public.user_topics (topic_id) where muted = false;
create index user_events_user_idx      on public.user_events (user_id, matched_at desc);
create index digests_user_idx          on public.digests (user_id, scheduled_for desc);
create index digests_due_idx           on public.digests (scheduled_for) where status = 'scheduled';
create index deliveries_retry_idx      on public.deliveries (status) where status = 'failed';

-- ---------------------------------------------------------------------------
-- Provision a new user's rows on signup
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));

  insert into public.subscriptions (user_id) values (new.id);
  insert into public.notification_preferences (user_id) values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
