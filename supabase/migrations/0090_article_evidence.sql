-- Deterministic article-page enrichment.
--
-- The Read page's deterministic fallback (0089 and before) draws only on RSS
-- excerpts, which are one or two sentences per source -- too thin to reach a
-- substantial article. This adds a background stage that fetches an article's
-- own public page, once, and keeps only short structured facts extracted from
-- it. The fetched page itself is never stored: `evidence` holds an array of
-- <=320-character, individually-attributable sentences, the same shape the
-- excerpt-only fallback already produces, just with richer source material to
-- select from. No full article text is retained anywhere.
--
-- The primary key IS the lock (same technique as event_understanding, 0078):
-- inserting the `pending` placeholder row is the claim, so two concurrent
-- workers racing the same article have exactly one winner via the unique
-- constraint, with no separate owner/lease RPC needed for a stage this cheap
-- to duplicate at worst.
create table public.article_evidence (
  article_id uuid primary key references public.articles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'enriched', 'unavailable', 'blocked', 'failed')),
  evidence jsonb not null default '[]'::jsonb,
  -- A size signal for internal quality scoring (see readerQuality in
  -- understand.ts), never a copy of the source text.
  source_word_count integer not null default 0,
  attempts integer not null default 0,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index article_evidence_status_idx on public.article_evidence (status, updated_at);

comment on table public.article_evidence is
  'One row per article, holding short (<=320 char) structured facts deterministically extracted from the article''s own public page. Never the fetched HTML or full article text -- that is discarded immediately after extraction, in the same request, and is never written to any column here.';

alter table public.article_evidence enable row level security;
-- No policy: service role (the pipeline) only. Readers reach the composed
-- article through the existing server functions, never this table directly.
revoke all on public.article_evidence from public, anon, authenticated;
grant all on public.article_evidence to service_role;

-- Per-source-do main robots.txt permission, checked and cached once rather
-- than once per article -- the same reasoning `polling_tier` already uses for
-- per-source state that changes slowly. Null means "not yet checked", which
-- `enrich.ts` treats as not-allowed until a definitive answer (200 parsed, or
-- 404/410 treated as unrestricted) is obtained; an ambiguous fetch failure
-- leaves this null so it is retried later rather than cached as a false no.
alter table public.sources
  add column enrichment_allowed boolean,
  add column robots_checked_at timestamptz,
  add column enrichment_failure_count integer not null default 0;

comment on column public.sources.enrichment_allowed is
  'Whether this source''s domain robots.txt permits fetching article pages for our user agent. Null = not yet checked. Never assumed permissive.';

-- Ships off: the mechanism exists and is fully inert until explicitly turned
-- on, the same rollout pattern already used for pre_analysis_demand_gate and
-- deterministic_cluster_skip (docs/track.md phase 7-8). This stage adds real
-- network fetches inside an already subrequest-constrained Worker invocation
-- (docs/plan.md stage 2), so verifying its impact before enabling it matters
-- more here than for most flags in this codebase.
insert into public.feature_flags (key, label, description, enabled, rollout_percent) values
  ('article_enrichment_enabled',
   'Article evidence enrichment',
   'Background pipeline stage that fetches an article''s own public page, extracts short structured facts, and discards the page. OFF means the deterministic Read fallback composes only from RSS excerpts, exactly as it does today.',
   false, 100)
on conflict (key) do nothing;
