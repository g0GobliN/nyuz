-- nyuz -- the V1 AI surface: one reader-triggered call, nothing automatic.
--
-- ---------------------------------------------------------------------------
-- What this closes
-- ---------------------------------------------------------------------------
--
-- Three paid paths are removed in the application in this same change:
--
--   * the per-briefing `impact` call, which made the daily job itself a reason
--     to spend. It was never the source of that text -- `analyse.ts` writes
--     `event_impacts` from the analysis it is already doing -- so what is left
--     is a read plus a deterministic inclusion line (src/lib/pipeline/inclusion.ts).
--   * Story Ask, the only per-reader per-question model call.
--   * translation generation, which prewarmed a reader's language at briefing
--     time.
--
-- The code for all three is deleted rather than flag-gated, so these flags no
-- longer control anything. They are turned OFF and re-described here anyway,
-- because a flag whose label still promises a feature is a trap for whoever
-- next reads the console: it invites an operator to switch it on, observe
-- nothing, and go looking for the bug in the wrong place.
--
-- ---------------------------------------------------------------------------
-- What is NOT done
-- ---------------------------------------------------------------------------
--
-- No data is deleted. `event_impacts`, `event_translations` and `ask_cache`
-- keep every row they hold:
--
--   * stored impacts are still read and still preferred over the derived line;
--   * cached translations are still served to readers whose language has them;
--   * `ask_cache` is dormant, as it has been since P0.
--
-- Nothing is regenerated and this migration makes no model call.

update public.feature_flags
   set enabled = false,
       label = 'Story Ask (removed in V1)',
       description =
         'Story Ask is not part of V1. The endpoint returns a disabled result '
         'before reading a plan, and the model call behind it has been removed, '
         'so this flag no longer enables anything. Historical ask_cache rows are '
         'retained.'
 where key = 'ask_nyuz_enabled';

update public.feature_flags
   set enabled = false,
       label = 'Story translation (removed in V1)',
       description =
         'Translation generation is not part of V1. translateEvents now serves '
         'the existing cache and never writes to it, so this flag no longer '
         'enables anything. Cached event_translations rows are retained and '
         'still served.'
 where key = 'story_translation_enabled';

-- Enrichment stays off, and stays off explicitly.
--
-- `analyse.ts` still reads this flag and still has the code path behind it.
-- That is deliberate: enrichment is the one removed-for-now path with a real
-- future argument (an event that grew from one source to eight genuinely may
-- deserve re-analysis), and unlike Ask and translation it costs nothing while
-- disabled. It must not drift back on by accident, so it is re-asserted here.
update public.feature_flags
   set enabled = false,
       description =
         'Off for V1. Re-analyses an event whose coverage grew materially. Costs '
         'one Pro call per event when on; leave off unless the spend is agreed.'
 where key = 'enrichment_pass_enabled';

-- The deep_explain flag predates Understand and gated an earlier version of the
-- same idea. On-demand Understand (0078) is governed by `understand_on_demand`
-- and `understand_in_analysis`, so this one is now purely historical.
update public.feature_flags
   set description = coalesce(description, '') ||
         ' Superseded by understand_on_demand (0078); no longer read by the application.'
 where key = 'deep_explain'
   and coalesce(description, '') not like '%Superseded by understand_on_demand%';
