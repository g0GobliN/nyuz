-- nyuz — admin console
--
-- Everything the operator console needs that 0001/0002 did not cover: who is
-- allowed to operate it, who has been banned, the blog, the landing copy, the
-- AI routing table, feature flags, and the audit trail.
--
-- Two rules carried over from 0002 and applied throughout:
--
--   1. Anything the console *writes* is written with the service-role key from
--      a server function. Those tables therefore get read policies only, and
--      the absence of a write policy is the write guard.
--   2. Tables the public site reads (blog, landing copy, flags) are readable by
--      `anon` as well as `authenticated` — a signed-out visitor renders the
--      marketing site, so those rows have to be reachable without a session.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type admin_role    as enum ('user', 'admin', 'superadmin');
create type post_status   as enum ('draft', 'scheduled', 'published', 'archived');
-- Mirrors ModelTier in src/lib/ai/deepseek.ts. Adding a tier means adding it
-- in both places.
create type ai_capability as enum ('cluster', 'digest', 'reason');

-- ---------------------------------------------------------------------------
-- profiles: email + activity
--
-- The console lists and searches users by email, and auth.users is not exposed
-- to PostgREST. Mirroring the address onto profiles keeps the list one indexed
-- query instead of a paged Admin-API walk joined in application code.
-- ---------------------------------------------------------------------------

alter table public.profiles add column email        text not null default '';
alter table public.profiles add column last_seen_at timestamptz;

update public.profiles p
   set email = coalesce(u.email, '')
  from auth.users u
 where u.id = p.id;

create index profiles_email_idx      on public.profiles (lower(email));
create index profiles_created_idx    on public.profiles (created_at desc);
create index profiles_last_seen_idx  on public.profiles (last_seen_at desc nulls last);

-- Keeps the mirror honest when a user changes their address through Supabase
-- auth, which writes auth.users directly and never touches profiles.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$fn$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.sync_profile_email();

-- 0002 grants "update own profile" for all columns, which now includes the
-- mirrored email. Left alone, a user could rewrite their own address and the
-- console would show whatever they typed. RLS cannot compare against OLD, so
-- the clamp is a trigger. service_role is exempt: the pipeline and the sync
-- trigger above are the only writers that may move these columns.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  new.id         := old.id;
  new.email      := old.email;
  new.created_at := old.created_at;
  return new;
end;
$fn$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ---------------------------------------------------------------------------
-- Roles
--
-- Deliberately NOT a column on profiles: 0002 lets a user update their own
-- profile row, so a role column there would be self-grantable. Here there is
-- no write policy at all, so the only way to change a role is the service-role
-- key behind an admin server function.
-- ---------------------------------------------------------------------------

create table public.user_roles (
  user_id     uuid        primary key references public.profiles (id) on delete cascade,
  role        admin_role  not null default 'user',
  granted_by  uuid        references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now()
);

create index user_roles_role_idx on public.user_roles (role) where role <> 'user';

-- Extends the 0001 trigger so a new signup lands with their address mirrored
-- and a role row already present. Defined here rather than beside the other
-- profiles changes because it now writes user_roles, which is created above.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''));

  insert into public.subscriptions (user_id) values (new.id);
  insert into public.notification_preferences (user_id) values (new.id);
  insert into public.user_roles (user_id) values (new.id);

  return new;
end;
$fn$;

-- Used by the policies below. security definer so it can read user_roles while
-- user_roles itself is behind RLS, which would otherwise recurse.
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.user_roles
     where user_id = uid and role in ('admin', 'superadmin')
  );
$fn$;

create or replace function public.is_superadmin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.user_roles
     where user_id = uid and role = 'superadmin'
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Bans
--
-- The row here is the reason and the paper trail. The ENFORCEMENT is
-- auth.users.banned_until, set through the Supabase Admin API by the same
-- server function — that is what actually stops a token refresh. This table
-- alone would stop nothing, so never treat it as the control.
-- ---------------------------------------------------------------------------

create table public.user_bans (
  user_id    uuid        primary key references public.profiles (id) on delete cascade,
  reason     text        not null default '',
  banned_by  uuid        references public.profiles (id) on delete set null,
  banned_at  timestamptz not null default now(),
  -- null = indefinite.
  expires_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Blog
-- ---------------------------------------------------------------------------

create table public.blog_posts (
  id              uuid        primary key default gen_random_uuid(),
  slug            text        unique not null,
  title           text        not null default '',
  excerpt         text        not null default '',
  -- Markdown. Rendered by a small renderer in the app, never stored as HTML,
  -- so a compromised console session cannot plant script into the public site.
  body_md         text        not null default '',
  cover_url       text,
  status          post_status not null default 'draft',
  tags            text[]      not null default '{}',
  seo_title       text        not null default '',
  seo_description text        not null default '',
  author_id       uuid        references public.profiles (id) on delete set null,
  author_name     text        not null default '',
  featured        boolean     not null default false,
  -- Denormalised so the index page does not have to read every body.
  reading_minutes smallint    not null default 1,
  view_count      integer     not null default 0,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index blog_published_idx on public.blog_posts (published_at desc)
  where status = 'published';
create index blog_status_idx    on public.blog_posts (status);
create index blog_tags_idx      on public.blog_posts using gin (tags);

-- A scheduled post becomes visible when its time passes, with no job to run:
-- the policy below compares published_at to now() on every read.
create or replace function public.blog_post_is_live(p_status post_status, p_published_at timestamptz)
returns boolean
language sql
stable
as $fn$
  select p_status = 'published' and p_published_at is not null and p_published_at <= now();
$fn$;

-- Anonymous readers must be able to count a view without being able to write
-- anything else on the row, so the increment is a function, not a policy.
create or replace function public.increment_post_view(p_slug text)
returns void
language sql
volatile
security definer
set search_path = public
as $fn$
  update public.blog_posts
     set view_count = view_count + 1
   where slug = p_slug
     and public.blog_post_is_live(status, published_at);
$fn$;

-- ---------------------------------------------------------------------------
-- AI configuration
--
-- The point of these tables: swapping DeepSeek for another provider, or moving
-- one tier onto a different model, becomes a row edit rather than a deploy.
--
-- api_key_env holds the NAME of the environment variable holding the key, not
-- the key. Keys stay in Worker secrets. A provider row is therefore safe to
-- read, back up and log, and a leaked database is not a leaked provider
-- account. Adding a provider is two steps on purpose: the row here, and
-- `wrangler secret put <api_key_env>`.
-- ---------------------------------------------------------------------------

create table public.ai_providers (
  id          uuid        primary key default gen_random_uuid(),
  slug        text        unique not null,
  label       text        not null,
  -- OpenAI-compatible base URL. Anything speaking that dialect drops in.
  base_url    text        not null,
  api_key_env text        not null,
  active      boolean     not null default true,
  notes       text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.ai_model_routes (
  capability   ai_capability primary key,
  provider_id  uuid          not null references public.ai_providers (id) on delete restrict,
  model        text          not null,
  -- Both DeepSeek models are reasoning models: this ceiling has to cover hidden
  -- reasoning tokens as well as visible output, or completions come back empty
  -- with finish_reason "length". See src/lib/ai/deepseek.ts.
  max_tokens   integer       not null default 4096 check (max_tokens > 0),
  temperature  real          check (temperature >= 0 and temperature <= 2),
  updated_at   timestamptz   not null default now()
);

-- System prompts as data, so wording can be tuned without a deploy.
create table public.ai_prompts (
  key           text        primary key,
  label         text        not null,
  system_prompt text        not null default '',
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Site content and flags
--
-- One jsonb blob per landing section rather than a column per field: the
-- marketing copy changes shape often, and a schema migration per headline
-- rewrite is the wrong trade. The app validates the shape on read and falls
-- back to its built-in copy when a key is missing, so an empty table renders
-- exactly what ships in the bundle today.
-- ---------------------------------------------------------------------------

create table public.site_settings (
  key        text        primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_by uuid        references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.feature_flags (
  key             text        primary key,
  label           text        not null default '',
  description     text        not null default '',
  enabled         boolean     not null default false,
  -- 0..100. Bucketed by user id at read time, so a user's bucket is stable.
  rollout_percent smallint    not null default 100 check (rollout_percent between 0 and 100),
  updated_by      uuid        references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit trail
--
-- Every mutating console action writes one row. Append-only by construction:
-- there is no update or delete policy, and nothing in the app issues one.
-- ---------------------------------------------------------------------------

create table public.admin_audit_log (
  id          bigint      generated always as identity primary key,
  actor_id    uuid        references public.profiles (id) on delete set null,
  actor_email text        not null default '',
  action      text        not null,
  target_type text        not null default '',
  target_id   text        not null default '',
  meta        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_created_idx on public.admin_audit_log (created_at desc);
create index audit_actor_idx   on public.admin_audit_log (actor_id, created_at desc);
create index audit_target_idx  on public.admin_audit_log (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Analytics
--
-- One round trip for the whole overview chart. PostgREST cannot group by, and
-- pulling raw timestamps to bucket them in JavaScript stops working the moment
-- the tables are real, so the grouping lives here.
--
-- Not granted to anon or authenticated — the console calls it with the
-- service-role key after checking the caller's role in application code.
-- ---------------------------------------------------------------------------

create or replace function public.admin_daily_counts(p_days integer default 30)
returns table (
  day        date,
  signups    integer,
  digests    integer,
  deliveries integer,
  events     integer,
  posts      integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  with days as (
    select generate_series(
      (current_date - (greatest(p_days, 1) - 1) * interval '1 day')::date,
      current_date,
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    (select count(*)::integer from public.profiles   p where p.created_at::date    = d.day),
    (select count(*)::integer from public.digests    g where g.scheduled_for::date = d.day),
    (select count(*)::integer from public.deliveries v where v.created_at::date    = d.day),
    (select count(*)::integer from public.events     e where e.first_seen_at::date = d.day),
    (select count(*)::integer from public.blog_posts b where b.published_at::date  = d.day)
  from days d
  order by d.day;
$fn$;

revoke execute on function public.admin_daily_counts(integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.user_roles      enable row level security;
alter table public.user_bans       enable row level security;
alter table public.blog_posts      enable row level security;
alter table public.ai_providers    enable row level security;
alter table public.ai_model_routes enable row level security;
alter table public.ai_prompts      enable row level security;
alter table public.site_settings   enable row level security;
alter table public.feature_flags   enable row level security;
alter table public.admin_audit_log enable row level security;

-- Roles: a user reads their own so the client can decide whether to render the
-- console entry point. Admins read everyone's. Nobody writes.
create policy "own role" on public.user_roles
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- A banned user's own row, so the app can tell them why and sign them out
-- rather than failing with an opaque token error.
create policy "own ban" on public.user_bans
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- The public blog. Signed-out visitors included — this is the marketing site.
create policy "live posts readable" on public.blog_posts
  for select to anon, authenticated
  using (public.blog_post_is_live(status, published_at));

-- Admins additionally see drafts and scheduled posts, which is what lets the
-- console preview render the same row the public page will.
create policy "admins read all posts" on public.blog_posts
  for select to authenticated using (public.is_admin());

create policy "site settings readable" on public.site_settings
  for select to anon, authenticated using (true);

create policy "flags readable" on public.feature_flags
  for select to anon, authenticated using (true);

-- Admins may read the audit trail in the console; the writes come from the
-- service-role key, so there is deliberately no insert policy.
create policy "admins read audit" on public.admin_audit_log
  for select to authenticated using (public.is_admin());

-- ai_providers, ai_model_routes and ai_prompts get NO policy on purpose. RLS is
-- on and nothing matches, so they are unreachable from the browser entirely.
-- The pipeline and the console read them with the service-role key.

-- ---------------------------------------------------------------------------
-- Seed
--
-- Reproduces today's hard-coded behaviour as data, so applying this migration
-- changes nothing visible until someone edits a row.
-- ---------------------------------------------------------------------------

insert into public.user_roles (user_id, role)
select id, 'user' from public.profiles
on conflict (user_id) do nothing;

insert into public.ai_providers (slug, label, base_url, api_key_env, notes) values
  ('deepseek',   'DeepSeek',   'https://api.deepseek.com',       'DEEPSEEK_API_KEY',
   'Both models on this account are reasoning models: max_tokens must cover hidden reasoning as well as visible output.'),
  ('openai',     'OpenAI',     'https://api.openai.com/v1',      'OPENAI_API_KEY',     ''),
  ('groq',       'Groq',       'https://api.groq.com/openai/v1', 'GROQ_API_KEY',       ''),
  ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1',   'OPENROUTER_API_KEY', ''),
  ('together',   'Together',   'https://api.together.xyz/v1',    'TOGETHER_API_KEY',   '')
on conflict (slug) do nothing;

-- Only the provider actually in use starts active. The rest are pre-filled
-- rows waiting on a secret, so switching is a toggle rather than data entry.
update public.ai_providers set active = false where slug <> 'deepseek';

insert into public.ai_model_routes (capability, provider_id, model, max_tokens)
select c.capability, p.id, c.model, c.max_tokens
  from public.ai_providers p,
       (values
          ('cluster'::ai_capability, 'deepseek-v4-flash',  4096),
          ('digest'::ai_capability,  'deepseek-v4-pro',    8192),
          ('reason'::ai_capability,  'deepseek-v4-pro',   16384)
       ) as c(capability, model, max_tokens)
 where p.slug = 'deepseek'
on conflict (capability) do nothing;

insert into public.ai_prompts (key, label, system_prompt) values
  ('cluster', 'Event clustering',
   'You group near-duplicate headlines into a single real-world event. Answer only with JSON.'),
  ('digest',  'Digest generation',
   'You write one short paragraph explaining why a story matters to this specific reader. No preamble, no hedging, no restating the headline.'),
  ('reason',  'Deep explanation',
   'You explain a story in depth for a reader who asked for more. Say what changed and what it means. Never invent sources.')
on conflict (key) do nothing;

insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  ('blog',             'Public blog',       'Shows the blog in the site nav and footer.',        true,  100),
  ('signups_open',     'Open signups',      'Turn off to close registration without a deploy.',  true,  100),
  ('announcement_bar', 'Announcement bar',  'Shows the banner configured under Landing.',        false, 100),
  ('breaking_alerts',  'Breaking alerts',   'Out-of-schedule sends for high importance events.', true,  100),
  ('deep_explain',     'Deep explanations', 'The premium reasoning tier on story pages.',        false, 100)
on conflict (key) do nothing;

insert into public.site_settings (key, value) values
  ('landing.hero', jsonb_build_object(
      'headline',       E'Stop searching.\nStart knowing.',
      'sub',            'Tell us what matters to you. We watch the internet and deliver the things worth knowing.',
      'ctaLabel',       'Build my radar',
      'ctaHref',        '/onboarding',
      'secondaryLabel', 'See how it works',
      'secondaryHref',  '/how-it-works',
      'footnote',       '327 sources monitored · duplicates merged · one briefing'
  )),
  ('landing.announcement', jsonb_build_object(
      'text', '', 'href', '', 'linkLabel', ''
  )),
  ('landing.sections', jsonb_build_object(
      'interestDemo', true, 'noise', true, 'howItWorks', true, 'comparison', true,
      'profileDemo',  true, 'whyDifferent', true, 'aiTrust', true, 'infrastructure', true,
      'sourceTransparency', true, 'finalCta', true
  )),
  ('site.seo', jsonb_build_object(
      'title',       'nyuz — Stop searching. Start knowing.',
      'description', 'Tell us what matters to you. We watch the internet and deliver the things worth knowing.',
      'ogImage',     '/og-image.jpg'
  )),
  ('site.footer', jsonb_build_object(
      'blurb',   'nyuz summarises and links to original reporting. Summaries are generated and can be wrong — every story keeps its sources one tap away.',
      'tagline', 'Less information. More relevance. Zero searching.'
  ))
on conflict (key) do nothing;
