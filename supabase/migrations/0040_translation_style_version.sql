-- nyuz -- record which editorial profile produced a translation
--
-- `content_version` already folds the style version into its hash, so improving
-- a language profile makes every old row miss the cache and regenerate. That
-- gives us CORRECTNESS: no reader is served text written under instructions we
-- have since decided were wrong.
--
-- What it does not give us is TRACEABILITY. A hash is opaque: given a row you
-- cannot tell which profile wrote it, so you cannot answer "has the Japanese
-- copy actually improved since we rewrote the profile", cannot count how much
-- of the cache is still on the old style, and cannot find the stragglers to
-- warm them deliberately. Storing the version alongside answers all three.
--
-- Existing rows are backfilled to '1', which is honest rather than accurate:
-- they were written before versioning existed, and '1' means "before we started
-- counting". As of writing there are no rows at all -- no reader has selected a
-- non-English language -- so this backfills nothing today and exists for the
-- first time it matters.

alter table public.event_translations
  add column if not exists style_version text not null default '1';

comment on column public.event_translations.style_version is
  'Which TRANSLATION_STYLE_VERSION produced this row (0040). Not part of the '
  'cache key -- content_version already hashes it. This column is for asking '
  'which profile wrote a given translation, and how much of the cache is '
  'still on an older style.';

-- The question this column exists to answer: what is still on an old profile?
create index if not exists event_translations_style_idx
  on public.event_translations (language, style_version);
