-- The landing page's meta description says "news briefing"; the product's
-- positioning line, ruled 2026-10-21, is "a personalized information briefing".
--
-- Why a migration is needed and not just a code change
-- -----------------------------------------------------
-- `/` reads its description from `getPublicSiteContent()`, which resolves it as
-- `parseSetting(seoSchema, byKey.get("site.seo"), SEO_DEFAULT)`. The stored row
-- WINS over the bundled default. `SEO_DEFAULT` in `src/lib/site-content.ts` is
-- only the fallback for a database with no `site.seo` row.
--
-- A seeded environment HAS such a row: `0003_admin.sql` inserts it, and
-- `0004_landing_copy.sql` rewrites its description to
--
--   "You don't read the news. It reports to you. nyuz watches hundreds of
--    sources, merges the duplicates, and sends you the handful of things worth
--    knowing."
--
-- So editing `SEO_DEFAULT` alone leaves every seeded environment serving a
-- description that says "nyuz watches hundreds of sources" — a countable claim
-- about a number that moves every week, which is the thing the copy rules
-- forbid — and none of them saying "information briefing" at all. The live
-- project has no `site.seo` row (measured 2026-10-21: `site_settings` holds
-- `site.access`, `ai.daily_flash_cap_microusd` and `ai.daily_pro_cap_microusd`,
-- and nothing else), so the live page serves the bundled default and does need
-- the code change. Both paths need their own change; neither alone is enough.
--
-- The guard, and why it is narrow
-- ------------------------------
-- This updates the row ONLY where the description still holds one of the two
-- values this repository has ever written:
--
--   - the value `0004_landing_copy.sql` set, and
--   - the value `SEO_DEFAULT` carried before this change.
--
-- If an operator has edited the description by hand in `/admin/content`, their
-- text does not match either value and is left alone. That is the point: the
-- stored row is an editorial decision, and a positioning sweep is not licence to
-- overwrite an editor's words. A migration that rewrote the description
-- unconditionally would silently revert that edit on every deploy.
--
-- The title is deliberately NOT touched. "nyuz — Stop searching. Start knowing."
-- is the brand line, it is not a positioning claim, and it is not what the
-- ruling changed.
--
-- Idempotent: the guard stops matching once the row has been updated, so a
-- re-run is a no-op.

update public.site_settings
   set value = jsonb_set(
         value,
         '{description}',
         to_jsonb('Tell nyuz what matters. It keeps watch across relevant sources, connects duplicate coverage into events, and delivers a personalized information briefing without the noise.'::text)
       ),
       updated_at = now()
 where key = 'site.seo'
   and value ->> 'description' in (
     -- what 0004_landing_copy.sql seeded
     'You don''t read the news. It reports to you. nyuz watches hundreds of sources, merges the duplicates, and sends you the handful of things worth knowing.'
     -- what SEO_DEFAULT carried until 2026-10-21
     ,
     'Tell nyuz what matters. It keeps watch across relevant sources, connects duplicate coverage into events, and delivers a personalized news briefing without the noise.'
   );
