-- Audit 37: a persistent, source-level success marker for recovery probing.
--
-- Audit 36 shipped the spare-capacity probe with its eligibility signal derived
-- from the probe's own bounded history read: "the source enriched an article
-- published within the last 7 days". The Audit 37 investigation measured that
-- this silently re-latches the very sources the probe exists to recover --
-- llama.cpp releases' newest successful enrichment sat on an article published
-- 13 days before the census, so the gate evaluated "not eligible" for the only
-- historically productive latched source, while 54 fresh unattempted articles
-- waited behind the latch. A bounded operational read had become, by accident,
-- the definition of "lifetime".
--
-- The marker is written by the same success path that resets
-- `enrichment_failure_count` (see `recordSourceOutcome` in enrich.ts), so the
-- two states share one lifecycle and cannot drift apart through different
-- code paths. Probe eligibility then reads a column instead of re-deriving
-- history: IS NOT NULL means "this source has demonstrated successful
-- enrichment at least once".
--
-- Backfill: one UPDATE from the evidence the stage already wrote, so the new
-- column is historically truthful rather than merely operationally sufficient
-- (the ruling's preference). Sources with no enriched row -- Tom's Hardware,
-- vLLM, Next.js, OpenAI among the latched families -- stay NULL, which the
-- probe already treats as "never succeeded": NULL is the semantic, not a gap.

alter table public.sources
  add column enrichment_last_success timestamptz;

comment on column public.sources.enrichment_last_success is
  'Newest confirmed successful article-page enrichment for this source (Audit 37). Written by the pipeline''s success path alongside enrichment_failure_count=0. Null = never succeeded; the recovery probe treats that as permanently parked.';

update public.sources s
set enrichment_last_success = latest.extracted_at
from (
  select a.source_id, max(e.extracted_at) as extracted_at
  from public.articles a
  join public.article_evidence e on e.article_id = a.id
  where a.source_id is not null
    and e.status = 'enriched'
    and e.extracted_at is not null
  group by a.source_id
) latest
where s.id = latest.source_id;
