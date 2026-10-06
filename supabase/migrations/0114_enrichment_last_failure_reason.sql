-- Audit 40: why a source is parked, written on the source row.
--
-- The failure counter says a source failed; it does not say how, and telling
-- the difference has so far meant running a survey against the live web
-- (scripts/audit39-extractability.ts). That survey is what showed Audit 39's
-- three different answers inside one question -- Tom's Hardware's pages
-- extracted cleanly and only the fetch cap rejected them, OpenAI was returning
-- intermittent 403s, Next.js was serving genuinely note-less releases -- and
-- none of the three is visible from a counter.
--
-- Recorded here is the newest concluded attempt's reason: the fetch kind
-- ('http_error', 'too_large', 'timeout', 'not_html', ...) when the page could
-- not be read, 'thin_content' when it carried too little text,
-- 'extraction_error' when extraction threw, and the robots reason when the
-- source refused the path. A success clears it, so a non-null value always
-- means the source's most recent concluded attempt failed.
--
-- Observation only, per the Audit 40 ruling: nothing reads this column to
-- decide eligibility, candidate selection, the latch, or the probe. It exists
-- so the console can answer "why is this source parked?" without rebuilding
-- the answer from scattered evidence rows.
--
-- No backfill: the reason is not reconstructible from the counter, and a
-- guessed value would be worse than a null.

alter table public.sources
  add column enrichment_last_failure_reason text;

comment on column public.sources.enrichment_last_failure_reason is
  'Newest concluded enrichment failure for this source (0114, Audit 40): fetch kind, thin_content, extraction_error, or a robots reason. Cleared on success. Observational only -- no eligibility or selection reads it. NULL = no failure recorded since the column existed.';
