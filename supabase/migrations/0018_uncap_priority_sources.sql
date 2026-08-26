-- Priority sources stop being a plan entitlement.
--
-- 0017 capped them at 3 / 15 / unlimited and enforced it with a trigger, on the
-- assumption that a source was a thing a plan sold. It is not. A feed is fetched,
-- clustered and analysed once for every reader who will ever see it, and matching
-- deliberately spends no tokens (see src/lib/pipeline/match.ts). Two readers on
-- the same plan, one weighting three feeds and one weighting sixty, cost exactly
-- the same to serve.
--
-- So the cap collected no margin. It only made a free account feel arbitrarily
-- small, and it made a downgrade silently deactivate preferences a reader had
-- set. What a plan sells is metered elsewhere and stays enforced: alert claims,
-- ask claims, story counts per briefing, the model a briefing is written with,
-- retention, and the monthly token ledger.
--
-- Nothing is migrated. Rows already marked priority beyond the old cap simply
-- start counting again, which is what their owner asked for when they set them.

drop trigger if exists enforce_priority_source_cap on public.user_source_prefs;
drop function if exists public.enforce_priority_source_cap();
drop function if exists public.plan_priority_source_cap(text);

-- user_source_prefs.created_at stays. 0017 added it to break cap ties by age;
-- it is now just a useful record of when a reader made the choice, and dropping
-- a column to reclaim nothing would cost more than keeping it.
