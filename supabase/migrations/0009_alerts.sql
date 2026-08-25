-- nyuz — breaking-alert rows, a wider topic pool, story Ask
--
-- Digests were one kind of thing: a scheduled briefing. Alerts are the same
-- tables (deliveries still need a digest_id) but they must not replace today's
-- briefing on the home page or show up as extra days in history. `kind`
-- separates the two without a second set of tables.
--
-- The four extra topics are the ones the corpus already produces and analysis
-- had nowhere to put — Linux, hardware, developer tools, consumer tech. Slugs
-- match `topicSlug()` in src/lib/preferences-map.ts.
--
-- `deep_explain` was seeded off because the Ask panel was a stub. The stub is
-- gone; the flag stays the kill switch.

alter table public.digests
  add column if not exists kind text not null default 'briefing';

alter table public.digests
  drop constraint if exists digests_kind_check;

alter table public.digests
  add constraint digests_kind_check check (kind in ('briefing', 'alert'));

comment on column public.digests.kind is
  'briefing = scheduled slot; alert = out-of-schedule send. Home and history list briefings only.';

insert into public.topics (slug, label) values
  ('linux',            'Linux'),
  ('hardware',         'Hardware'),
  ('developer-tools',  'Developer tools'),
  ('consumer-tech',    'Consumer tech')
on conflict (slug) do nothing;

update public.feature_flags
  set enabled = true
  where key = 'deep_explain';
