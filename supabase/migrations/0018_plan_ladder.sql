-- Retunes the plan ladder. Two of the three changes are about never losing
-- money on a subscriber; the third is about the free tier being a sample
-- rather than a substitute.
--
-- Only the priority cap lives in the database. The token ceilings and the
-- frequency boundary are read from src/lib/plans.ts by code that already holds
-- the plan, so they need no DDL — see reserve_ai_tokens, which takes the
-- per-reader ceiling as a parameter rather than knowing the plans itself.

-- Priority sources: 3 -> 5 on Free, 15 -> 30 on Personal, against 83 active
-- sources. A source costs nothing to honour — it is ingested and analysed once
-- for every reader who will ever see it, and matching spends no tokens — so
-- these numbers are set by what makes a tier feel like itself, not by cost.
--
-- There is an upper bound that has nothing to do with plans: priority is worth
-- +2 in relevanceOf(), so a reader who marks most of the catalogue priority
-- adds +2 to most of their stories and ranks nothing. Past roughly a third of
-- the list the feature stops working for the person using it, which is why
-- Personal lands at 30 and not at 50. Pro stays uncapped on the same argument
-- turned around: someone who has read the room can have the rope.
--
-- The trigger from 0017 calls this function on every write, so replacing the
-- function is the whole change.
--
-- Both are increases, so no existing row can be left over a cap by this.
create or replace function public.plan_priority_source_cap(p_plan text)
returns integer
language sql
immutable
as $fn$
  select case p_plan
    when 'pro' then null
    when 'personal' then 30
    else 5
  end;
$fn$;
