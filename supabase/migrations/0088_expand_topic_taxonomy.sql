-- nyuz -- expand the predefined topic taxonomy
--
-- The demonstrated production gap: complete events with no event_topics because
-- no predefined topic fits (rail/transit, EV/automotive, military, and adjacent
-- general-news beats had no category at all in the 28-topic pool). This adds
-- exactly the topics the deterministic classifier (topic-assign.ts) now has
-- keyword coverage for -- no more, to keep the taxonomy compact.
--
-- `kind` must be set explicitly: 0049 added that column with `default 'custom'`,
-- and only `kind = 'predefined'` rows are visible to assignTopics-based
-- classification (classify.ts / analyse.ts read every topic regardless of
-- `terms`, but the editorial vocabulary in topic-assign.ts only maps predefined
-- labels).

insert into public.topics (slug, label, kind) values
  ('transport',  'Transport',  'predefined'),
  ('automotive', 'Automotive', 'predefined'),
  ('energy',     'Energy',     'predefined'),
  ('crime',      'Crime',      'predefined'),
  ('military',   'Military',   'predefined'),
  ('education',  'Education',  'predefined'),
  ('travel',     'Travel',     'predefined')
on conflict (slug) do nothing;
