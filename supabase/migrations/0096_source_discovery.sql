-- nyuz -- P0 universal source discovery.
--
-- ---------------------------------------------------------------------------
-- The gap this closes
-- ---------------------------------------------------------------------------
--
-- A reader may follow anything -- a band, a team, a language, a city's transit
-- authority. Until now a subject only began collecting once somebody had put a
-- source in `sources`: the seed, the admin console, or pasting a feed URL.
-- Discovery closes the loop between "somebody follows this" and "the pipeline
-- watches something that covers it", without a second source registry and
-- without a second content pipeline.
--
-- ---------------------------------------------------------------------------
-- One job per TOPIC, not per reader
-- ---------------------------------------------------------------------------
--
-- A thousand readers following "Rust programming" are one piece of discovery
-- work, exactly as they are one piece of analysis work. Everything below is
-- keyed by topic for that reason, and the candidate registry is global: two
-- topics that happen to find the same site share one candidate row, one probe
-- and one `sources` row.
--
-- ---------------------------------------------------------------------------
-- What this deliberately is not
-- ---------------------------------------------------------------------------
--
-- No crawler, no sitemap walk, no article fetching, no model call, and no
-- search API or key. A job body reads the database: sources whose own name
-- names the subject, then articles whose text mentions it, and links what it
-- finds. The only thing in this stage that touches the network is a URL a
-- reader supplied, and that goes through a bounded `resolveFeed` probe -- the
-- same `fetchFeed`/`parseFeed` path a reader-submitted feed already goes
-- through. Rows here are operational state: service-role writes only, admin
-- read, with retention left to the operator (see `discovery_jobs` comment).
--
-- A discovered source is a normal `sources` row. The ingester, the demand
-- refresh, the polling tiers, the matcher and the briefing all read it without
-- knowing anything changed; the only mark is `origin`, which is provenance,
-- never ownership.

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------
--
-- 0039 introduced `source_origin` with `curated` and `user`. `discovered` is
-- the third producer: a source the discovery stage registered on its own,
-- because a followed topic had no coverage. Kept in the same enum rather than
-- a second column so every existing read of `origin` stays exhaustive.

alter type public.source_origin add value if not exists 'discovered';

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
--
-- One row per discovery attempt for one topic. `status` stays small on purpose:
-- a job is pending (claimable), running (claimed by an invocation), succeeded
-- (its seed methods ran and their counts are in `attempts`) or failed (an
-- unforeseen database error; `retryable` is expressed by `next_attempt_at` and
-- `attempt`).
--
-- `terms` is the term list the job looked for and `attempts` is what each seed
-- method made of it -- `{method, considered, matched, linked}` per entry, in
-- order. Together they are what an operator needs to answer "why is this
-- subject still uncovered" without reading the code.
--
-- Retention: operational, not history. A cleanup is `delete from
-- discovery_jobs where created_at < now() - interval '90 days'`; nothing reads
-- them after the next successful job for the same topic.

create table public.discovery_jobs (
  id               uuid        primary key default gen_random_uuid(),
  topic_id         uuid        not null references public.topics (id) on delete cascade,
  status           text        not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  -- Incremented on claim, so a failed job's backoff is derivable.
  attempt          integer     not null default 0 check (attempt >= 0),
  -- Which seed method produced this job's links: `registry`, `corpus`, or
  -- `none` when nothing the product already holds mentions the subject yet.
  method           text,
  -- The terms looked for, in order. An array rather than a row per term because
  -- they are only ever read together.
  terms            jsonb       not null default '[]'::jsonb,
  -- One entry per method tried, in order: {method, considered, matched, linked}.
  attempts         jsonb       not null default '[]'::jsonb,
  -- Sources linked to this job's subject. Not "registered": these are sources
  -- that already existed, which is the whole point of the deterministic flow.
  linked_count     integer     not null default 0,
  error            text,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  -- When the job may next be claimed. Null means never again: succeeded, or
  -- failed in a way no retry can fix.
  next_attempt_at  timestamptz
);

-- The claim query: pending jobs whose time has come, oldest first.
create index discovery_jobs_queue_idx
  on public.discovery_jobs (status, next_attempt_at);

-- Cooldown and history: "has this topic been attempted recently".
create index discovery_jobs_topic_idx
  on public.discovery_jobs (topic_id, created_at desc);

comment on table public.discovery_jobs is
  'Shared topic-level source discovery attempts. One row per topic per attempt '
  '-- never per reader. Deterministic and provider-free: a job body reads the '
  'database and links sources it finds there. Service-role writes only; see 0096.';

comment on column public.discovery_jobs.next_attempt_at is
  'Earliest next claim. Null after success or a permanent failure -- the '
  'state machine is the pair (status, next_attempt_at), deliberately small.';

-- One open job per topic, enforced by the database rather than by a check.
--
-- This is the index that makes shared discovery true under concurrency: two
-- readers following the same new subject in the same minute both compute
-- "queue a job", one insert wins, and the loser's 23505 is the same answer it
-- would have got from reading first. An application-level check cannot make
-- that promise across two Worker invocations.
create unique index discovery_jobs_inflight_idx
  on public.discovery_jobs (topic_id)
  where status in ('pending', 'running');

-- ---------------------------------------------------------------------------
-- Candidates
-- ---------------------------------------------------------------------------
--
-- The global registry of URLs discovery has found and not yet turned into a
-- source. `url` is unique, which is the whole idempotency story: two jobs that
-- surface the same site race on the insert, one wins, and the loser reads the
-- winner's row rather than probing twice.
--
-- A candidate may be a feed URL or a site URL -- the feed resolver decides
-- which -- so `feed_url` is filled in only once resolution succeeds. `rejected`
-- rows are kept: they are the memory that stops the same dead site being probed
-- every week.
--
-- Retention: `rejected and not retryable` may be deleted after ~180 days;
-- registered rows are a useful provenance trail.

create table public.source_candidates (
  id               uuid        primary key default gen_random_uuid(),
  -- Canonicalised by `canonicalUrl`, the same function feeds go through, so
  -- trailing slashes and tracking parameters cannot produce two candidates.
  url              text        unique not null,
  -- Where the URL came from. Only `reader` writes rows today: a URL a reader
  -- supplied for a subject they follow, queued because the probe failed
  -- transiently or because the registration write did. Kept so a later method
  -- can be told apart from it in the console.
  method           text        not null default 'reader',
  -- The resolved feed, once one is found. Null while unresolved.
  feed_url         text,
  domain           text        not null default '',
  title            text,
  -- The topic whose job found it first. Provenance for the console; the
  -- registration links the source to the topic that actually wanted it.
  first_topic_id   uuid        references public.topics (id) on delete set null,
  first_job_id     uuid        references public.discovery_jobs (id) on delete set null,
  status           text        not null default 'discovered'
    check (status in ('discovered', 'registered', 'rejected')),
  reject_reason    text,
  -- Whether trying again later could change the answer. Network failures are
  -- retryable; "this page has no feed" is not.
  retryable        boolean     not null default false,
  probe_attempts   integer     not null default 0 check (probe_attempts >= 0),
  -- Null means never again: registered, or rejected permanently.
  next_attempt_at  timestamptz default now(),
  resolved_source_id uuid      references public.sources (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- The resolution queue: unresolved candidates whose time has come.
create index source_candidates_queue_idx
  on public.source_candidates (status, next_attempt_at);

comment on table public.source_candidates is
  'Global registry of URLs discovery has found, keyed by canonical URL. One '
  'row regardless of how many topics or jobs surfaced it; see 0096.';

comment on column public.source_candidates.url is
  'The candidate page or feed URL, canonicalised. NEVER a canonical article '
  'URL by design: discovery results are sites and feeds, not stories.';

comment on column public.source_candidates.retryable is
  'True for transient failures (timeouts, 5xx). False with status=rejected is '
  'a permanent verdict -- no feed on the page, refused, or not a feed.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Same shape as admin_audit_log: admins may read the operational state in the
-- console, the service-role key writes it, and nothing else can see it. RLS
-- on with no insert/update/delete policy is the write guard.

alter table public.discovery_jobs    enable row level security;
alter table public.source_candidates enable row level security;

create policy "admins read discovery jobs" on public.discovery_jobs
  for select to authenticated using (public.is_admin());

create policy "admins read source candidates" on public.source_candidates
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
--
-- Same shape as the other sweeps: one bounded function called from the daily
-- dormant stage, not a background job of its own. Discovery history is
-- operational state, not a record:
--
--   discovery_jobs       90 days. Nothing reads a job once its topic has a
--                        newer one; the cooldown that matters is the last 24
--                        hours. An OPEN job older than 90 days is a stuck job,
--                        and deleting it is what lets the next pass queue a
--                        fresh one.
--   source_candidates    180 days, and only the permanently rejected ones.
--                        They exist to stop a dead site being probed every
--                        week; after two seasons even that memory is worth
--                        less than the row. Registered candidates are kept --
--                        they are the provenance trail for a real source.

create or replace function public.purge_expired_discovery(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  removed integer := 0;
  step integer;
begin
  with doomed as (
    select id
      from public.discovery_jobs
     where created_at < now() - interval '90 days'
     order by created_at
     limit greatest(p_limit, 0)
  )
  delete from public.discovery_jobs j using doomed d where j.id = d.id;
  get diagnostics step = row_count;
  removed := removed + step;

  with doomed as (
    select id
      from public.source_candidates
     where status = 'rejected'
       and retryable = false
       and updated_at < now() - interval '180 days'
     order by updated_at
     limit greatest(p_limit - removed, 0)
  )
  delete from public.source_candidates c using doomed d where c.id = d.id;
  get diagnostics step = row_count;
  removed := removed + step;

  return removed;
end;
$fn$;

revoke execute on function public.purge_expired_discovery(integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Flag
-- ---------------------------------------------------------------------------
--
-- Off by default, like every processing flag: applying this migration changes
-- nothing until an operator enables it, and disabling it stops discovery
-- without touching anything discovery has already registered. The pipeline
-- domain (ingest, cluster, analyse, match, digest) never consults it.

insert into public.feature_flags (key, label, description, enabled)
values (
  'source_discovery_enabled',
  'Source discovery',
  'When on, a followed subject with no mapped source and no recent attempt '
  'queues a shared topic-level job. The job body is deterministic and makes no '
  'outbound request: it links sources nyuz already collects to the subject. Off '
  'means no discovery work of any kind is queued.',
  false
)
on conflict (key) do nothing;
