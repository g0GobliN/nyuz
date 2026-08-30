-- nyuz — read-only source demand for the console
--
-- Phase 4 of docs/track.md: make demand visible before anything acts on it.
-- This function changes nothing about collection or analysis — it only
-- answers, per source, "how many currently-eligible readers have a topic
-- this source covers?" Nothing yet reads this to skip a fetch or an analysis
-- pass. Per plan2 §104: compute and show the number first, compare it
-- against real coverage, fix what looks wrong, and only gate behaviour on it
-- once it has been checked against reality.
--
-- ---------------------------------------------------------------------------
-- What counts as demand here
-- ---------------------------------------------------------------------------
--
-- A user contributes to a source's demand if: they have a non-muted
-- `user_topics` row for a topic that source covers (`source_topics`), they
-- are not auto-paused for inactivity (`profiles.auto_paused_at`), their
-- notification preferences are not paused, and they are not banned
-- (`auth.users.banned_until` — the actual enforcement, per
-- docs/database.md#why-a-ban-row-is-not-a-ban; `user_bans` is the audit
-- trail, not the gate). This reuses the account-lifecycle definitions the
-- rest of the app already has rather than inventing a second "active user."
--
-- Direct custom-source followers are not counted — that table does not exist
-- yet (docs/track.md phase 3b). A source with zero rows in `source_topics`
-- correctly shows zero demand: the graph has to be filled in before it can
-- mean anything, and an empty mapping looks exactly like no demand until it
-- is filled, which is the honest failure mode for a first-pass field.
--
-- ---------------------------------------------------------------------------
-- Why a left join from `sources`, not an inner join from `source_topics`
-- ---------------------------------------------------------------------------
--
-- Every source must appear in the result, including one with no topic
-- mapped yet and one whose topics currently have no followers — an operator
-- comparing this against the source list needs to see zero, not a missing
-- row, exactly as `admin_source_stats()` (0007) already does for article
-- counts.
--
-- Not granted to anon or authenticated, same as every other admin-only
-- aggregate function in this project. `getSourceDemand` in
-- src/lib/server/source-topics.ts calls it with the service-role key, after
-- `adminOnly` has established who the caller is.
-- ---------------------------------------------------------------------------

create or replace function public.admin_source_demand()
returns table (
  source_id             uuid,
  interested_users      integer,
  paid_interested_users integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    s.id,
    count(distinct ut.user_id)
      filter (where p.id is not null and np.user_id is not null and au.id is not null)::integer,
    count(distinct ut.user_id)
      filter (
        where p.id is not null and np.user_id is not null and au.id is not null
          and sub.plan is distinct from 'free'
      )::integer
  from public.sources s
  left join public.source_topics st
    on st.source_id = s.id
  left join public.user_topics ut
    on ut.topic_id = st.topic_id and ut.muted = false
  left join public.profiles p
    on p.id = ut.user_id and p.auto_paused_at is null
  left join public.notification_preferences np
    on np.user_id = ut.user_id and np.paused = false
  left join auth.users au
    on au.id = ut.user_id and (au.banned_until is null or au.banned_until < now())
  left join public.subscriptions sub
    on sub.user_id = ut.user_id
  group by s.id;
$fn$;

revoke execute on function public.admin_source_demand() from anon, authenticated;
