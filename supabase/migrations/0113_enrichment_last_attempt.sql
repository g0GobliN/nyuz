-- Audit 38: the idle clock a never-succeeded source waits out.
--
-- The failure backoff is a one-way latch: `classify` in enrich.ts excludes a
-- source at the threshold before any attempt is made, so the reset path is
-- unreachable and the source stays parked. Audit 36 made the latch recoverable
-- for sources with a lifetime success, and Audit 37 stopped that signal from
-- expiring through a bounded read. The Audit 38 census measured what is left:
-- four latched families -- Tom's Hardware, OpenAI, Next.js releases, vLLM
-- releases -- with no lifetime success at all, holding 1,023 unattempted
-- articles that no code path could ever retry, because the probe required a
-- success these sources do not have.
--
-- Five failures say enrichment is unreliable right now; they do not say the
-- feed can never be enriched. This column is the signal the idle rule reads: a
-- backed-off source with no lifetime success becomes probe-eligible again
-- after 14 days without an attempt. Every other constraint is unchanged --
-- spare capacity only, at most one article per tick, the 24h cooldown, the 72h
-- candidate floor, `enrichment_allowed` must not be false -- and a successful
-- probe resets the counter and writes `enrichment_last_success`, so the source
-- re-enters normal selection and its backlog drains as ordinary work.
--
-- Why a column and not a derived read: some failure paths move
-- `enrichment_failure_count` without writing an `article_evidence` row, so the
-- evidence table is not a complete attempt log and a 14-day condition derived
-- from it would misjudge a just-failed source (the Audit 38 ruling's
-- refinement). Written by `recordSourceOutcome` on every success and every
-- failure, and by the robots-blocked path through `recordSourceAttempt`; the
-- clock arms itself the first time a probe fails, and that source then waits
-- another 14 days.
--
-- No backfill, deliberately. These rows stay NULL, which the rule reads as
-- "long idle": the sources parked the longest deserve one bounded attempt
-- rather than another fortnight of nothing, and seeding an attempt time from
-- the incomplete evidence table would be the inference the ruling rejects.
--
-- Frozen and untouched: the 1:2 scheduler, ENRICH_LIMIT, the failure threshold
-- and its semantics, the 400 arm cap, the extraction path, and the 24h/72h
-- probe constraints.

alter table public.sources
  add column enrichment_last_attempt_at timestamptz;

comment on column public.sources.enrichment_last_attempt_at is
  'When this source was last attempted by enrichment (0113, Audit 38). Written on every success and failure, and on a robots-blocked attempt. Read by the spare-capacity probe: a source with no lifetime success is probe-eligible only after 14 days idle. NULL = no attempt recorded since the column existed, read as long idle.';
