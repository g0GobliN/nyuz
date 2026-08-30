-- nyuz -- global cached event translation (docs/plan2.md phase 1, phase 39-45)
--
-- English stays the canonical event knowledge: analysis runs in English,
-- clustering compares English headlines, `events` columns are English. This
-- table holds language *views* of that canonical knowledge -- never a second
-- pipeline, never a re-analysis, never a per-user copy.
--
-- ---------------------------------------------------------------------------
-- The key, and why content_version is in it
-- ---------------------------------------------------------------------------
--
-- Primary key is (event_id, language, content_version). The first two are
-- obvious. The third exists because an event's English text is not
-- permanently immutable: `analyse.ts` writes it once and never re-analyses,
-- but an operator retrying a failed analysis by name, or any future
-- re-analysis path, would leave every cached translation silently describing
-- the *previous* text. Without a version in the key that staleness is
-- undetectable; with it, a changed source text simply misses the cache and
-- regenerates, and the old rows remain readable for anything already
-- delivered.
--
-- `content_version` is derived from the source text by the caller
-- (src/lib/pipeline/translate.ts), not stored on `events` -- it is a property
-- of the text a translation was made *from*, which is exactly the thing a
-- foreign key to a mutable row cannot express.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT here
-- ---------------------------------------------------------------------------
--
-- No user_id, anywhere. Ten Japanese readers of one story share one row. That
-- is the whole cost argument, and it is the same property `events` itself
-- rests on -- see docs/architecture.md.
--
-- No eager translation of the corpus. Rows appear when a reader of that
-- language actually needs that story (docs/localisation-plan.md: "filled on
-- demand, when an event first enters a digest for a reader of that
-- language"). At 1,771 events x 5 non-English languages, eager filling would
-- pay for ~8,800 translations of coverage nobody opens.
--
-- `digest_items.why_it_matters` is NOT translated here. Phase 2 made that
-- text shared per event rather than per user, so it belongs in
-- `event_impacts` and gets its own translation path later if wanted --
-- adding it to this table would mean this table's key no longer identifies
-- one canonical thing.

create type translation_status as enum ('pending', 'generating', 'complete', 'failed');

create table public.event_translations (
  event_id        uuid               not null references public.events (id) on delete cascade,
  -- BCP-47. 'zh-Hans' not 'zh': Simplified and Traditional are not
  -- interchangeable to a reader, and a schema storing bare 'zh' cannot
  -- express the difference later (docs/localisation-plan.md).
  language        text               not null check (language ~ '^[a-z]{2}(-[A-Za-z]{2,8})?$'),
  -- Short hash of the English source text this was translated from.
  content_version text               not null,
  status          translation_status not null default 'pending',
  title           text,
  what_happened   text,
  before_state    text,
  after_state     text,
  impact          text,
  model           text,
  prompt_tokens     integer     not null default 0,
  completion_tokens integer     not null default 0,
  created_at      timestamptz        not null default now(),
  updated_at      timestamptz        not null default now(),
  primary key (event_id, language, content_version)
);

-- Serves the cache lookup (event + language, newest version first) and the
-- admin "how much have we translated" counts.
create index event_translations_lookup_idx
  on public.event_translations (event_id, language, updated_at desc);
create index event_translations_language_idx on public.event_translations (language, status);

comment on table public.event_translations is
  'Global language views of canonical English event knowledge. Keyed by '
  '(event, language, content_version) -- never by user. One row serves every '
  'reader of that language. See docs/track.md phase 1.';

-- ---------------------------------------------------------------------------
-- Reader language preference
-- ---------------------------------------------------------------------------
--
-- Default 'en' so every existing row keeps today's behaviour exactly. This
-- column is the reader's *reading* language for story content; UI
-- localisation is a separate concern with a separate mechanism (static i18n
-- resources, plan2 section 44) and must not be conflated with it.

alter table public.notification_preferences
  add column language text not null default 'en'
    check (language ~ '^[a-z]{2}(-[A-Za-z]{2,8})?$');

-- ---------------------------------------------------------------------------
-- RLS -- same shape as every other global content table: signed-in read, no
-- write policy at all. The pipeline writes with the service-role key.
-- ---------------------------------------------------------------------------

alter table public.event_translations enable row level security;

create policy "event_translations readable" on public.event_translations
  for select to authenticated using (true);
