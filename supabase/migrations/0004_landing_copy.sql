-- nyuz — landing copy refresh
--
-- The landing page now leads with the line the README opens on — "You don't
-- read the news. It reports to you." — and the bundled defaults in
-- src/lib/site-content.ts moved with it.
--
-- A seeded database would otherwise keep serving the old sub-headline for ever.
-- The landing page renders the stored row whenever there is one, and 0003's
-- insert ends in `on conflict (key) do nothing`, so re-running it changes
-- nothing. Only an update moves an existing row.
--
-- Each statement is guarded on the old value. An operator who has already
-- edited the hero from the console has made a deliberate editorial choice, and
-- a migration is the wrong instrument for overruling it — only rows still
-- holding 0003's untouched seed are moved, which also makes this safe to run
-- twice.
--
-- `jsonb_set` rather than a whole-object rewrite for the same reason: it
-- touches the one key that changed and leaves any edited CTA label, href or
-- footnote in the same row alone.
-- ---------------------------------------------------------------------------

update public.site_settings
   set value = jsonb_set(
         value,
         '{sub}',
         to_jsonb('You don''t read the news. It reports to you.'::text)
       ),
       updated_at = now()
 where key = 'landing.hero'
   and value ->> 'sub' =
       'Tell us what matters to you. We watch the internet and deliver the things worth knowing.';

update public.site_settings
   set value = jsonb_set(
         value,
         '{description}',
         to_jsonb('You don''t read the news. It reports to you. nyuz watches hundreds of sources, merges the duplicates, and sends you the handful of things worth knowing.'::text)
       ),
       updated_at = now()
 where key = 'site.seo'
   and value ->> 'description' =
       'Tell us what matters to you. We watch the internet and deliver the things worth knowing.';
