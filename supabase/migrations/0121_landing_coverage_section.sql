-- nyuz -- put the "What nyuz covers" section first on the landing page
--
-- Why this is a migration and not a code change
-- --------------------------------------------
-- The landing page's section order is not in the code. `landing.sections` is an
-- ORDERED list stored in `site_settings`, because order is an editorial
-- decision: whether the comparison table comes before or after the noise
-- argument changes what a first-time visitor is persuaded by, and that is not
-- something worth a deploy.
--
-- The code's `normaliseSections` appends any key the stored row does not
-- mention to the END of the list, switched on. So shipping the new section
-- key on its own would have put "What nyuz covers" below the closing call to
-- action -- the one place it could not possibly do its job. This migration
-- inserts it at the front, where it belongs.
--
-- Why the front
-- -------------
-- The hero is followed by the topic demo ("Show us what you care about").
-- The demo is the PROOF of the coverage claim: it shows the breadth by
-- offering the visitor the breadth to pick from. A visitor should know what
-- nyuz covers before they are asked to choose from it, so the claim comes
-- first and the demo answers it.
--
-- Two paths reach the page, and both need the key first
-- ------------------------------------------------------
-- 1. A database with NO `landing.sections` row renders `SECTIONS_DEFAULT`,
--    which is built from `SECTION_KEYS`, where `coverage` is first. That path
--    needs nothing from this file -- and it is the path the live project is
--    on today (measured 2026-10-21: `site_settings` holds three rows and
--    `landing.sections` is not one of them).
--
-- 2. A database WHERE AN OPERATOR HAS SET THE ORDER has a `landing.sections`
--    row, and the stored order wins over `SECTION_KEYS`. The admin console
--    writes that row (`src/routes/admin/content.tsx`). This migration is what
--    puts `coverage` at the front of it, so an operator's custom order does
--    not silently push the new section to the bottom of their own page.
--
-- So this file is a no-op on a database that never customised the order, and
-- the thing that makes the new section first on such a database is
-- `SECTION_KEYS` in `src/lib/site-content.ts`. Both are needed: the key
-- list for the default, this migration for the customised case.
--
-- What this does NOT do
-- ----------------------
-- It does not touch any other key's position, and it does not change whether
-- any section is enabled. A row that has a section hidden keeps it hidden.
--
-- It is written to be safe to run on a row that already contains the key
-- (a re-run, or a database where an operator added it by hand in the
-- console): the key is removed and re-inserted at the front rather than
-- duplicated, so the section cannot mount twice.
--
-- On a row in the LEGACY `{key: boolean}` map shape this statement does
-- nothing, and that is deliberate rather than an oversight: the app's own
-- `normaliseSections` accepts that shape and normalises it, but the legacy
-- map carries no ORDER to preserve, so the normalised result already puts
-- `coverage` first from `SECTION_KEYS`. Rewriting it here would convert a
-- row the operator can still read in the shape they wrote it into a list
-- they did not ask for, for no positional gain.

update public.site_settings
   set value = (
         select jsonb_agg(elem order by ord)
           from (
             -- The new section, first.
             select 0 as ord,
                    jsonb_build_object('key', 'coverage', 'enabled', true) as elem
             union all
             -- Everything the row already had, in the order it had it, minus
             -- any previous copy of the key this statement is adding.
             select row_number() over (order by ord) as ord, elem
               from (
                 select ord,
                        elem
                   from jsonb_array_elements(value) with ordinality as t(elem, ord)
                  where elem ->> 'key' is distinct from 'coverage'
               ) kept
           ) ordered
         ),
       updated_at = now()
 where key = 'landing.sections'
   and value is not null
   and jsonb_typeof(value) = 'array';
