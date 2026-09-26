-- nyuz -- P4 made real: the alert gate, revision-aware alert claims, the
-- subject history baseline, and one column removed.
--
-- ---------------------------------------------------------------------------
-- 1. `user_events.subject_significance` is removed
-- ---------------------------------------------------------------------------
--
-- 0099 added it as "computed once per (reader, event) in the match stage and
-- read by the briefing". Nothing ever wrote or read it. And the grain was wrong:
-- subject significance is a property of an (event, topic) pair -- how unusual
-- this development is *for that subject's own history* (0101,
-- subject-significance.ts) -- and a reader following two topics that both
-- selected an event has two values, not one. It is computed per run, per
-- (event, topic), from a bounded history (section 4), and consumed in memory
-- by admission, alerts and the shadow. A column that claims otherwise is worse
-- than no column, so it goes.

alter table public.user_events drop column if exists subject_significance;

-- ---------------------------------------------------------------------------
-- 2. Alert claims know which revision they were for
-- ---------------------------------------------------------------------------
--
-- `alert_claims` was keyed on (user, event): one alert per story, ever. That is
-- the right rule for "the same story again" and the wrong one for "the same
-- story, materially developed" -- the distinction 0097-0099 exist to draw. The
-- claim now records the revision it delivered, and a later claim for the same
-- event is a duplicate only while its revision is not newer.
--
-- Existing rows are revision 0, which is what every event alerted before 0097
-- was, so no past alert becomes re-sendable.

alter table public.alert_claims
  add column revision integer not null default 0;

alter table public.alert_claims
  drop constraint alert_claims_pkey,
  add primary key (user_id, event_id, revision);

comment on column public.alert_claims.revision is
  'The event material_revision this alert delivered (0103). A claim for the same event is a duplicate unless its revision is newer.';

-- ---------------------------------------------------------------------------
-- 3. The alert gate: importance, or a qualified subject development
-- ---------------------------------------------------------------------------
--
-- `claim_alert` is the authority on what may interrupt a reader, and its floor
-- was `importance >= 6` with no exception. The P4 alert rule
-- (`alertEligible`) also admits a subject-significant development on a firmly
-- matched interest -- but only while `subject_significance_enabled` is on. The
-- flag is re-read *here*, inside the lock, so a caller cannot talk its way past
-- the floor with the flag off: the TypeScript may claim `p_subject_qualified`,
-- and the database decides whether that claim is worth anything today.
--
-- Everything else is unchanged: the plan's rolling daily cap, the advisory lock,
-- and the insert that makes the claim.
--
-- The new signatures take no defaults, and the old ones stay as wrappers with
-- their exact previous behaviour (revision 0, no subject qualification), so
-- every existing call site and privilege check keeps resolving to exactly one
-- function.

create function public.claim_alert(
  p_user_id           uuid,
  p_event_id          uuid,
  p_importance        real,
  p_revision          integer,
  p_subject_qualified boolean
)
returns text language plpgsql security definer set search_path = public as $fn$
declare tier text; cap integer; used integer; v_revision integer := greatest(coalesce(p_revision, 0), 0);
begin
  perform pg_advisory_xact_lock(hashtextextended('alert:' || p_user_id::text, 0));
  select plan::text into tier from subscriptions where user_id = p_user_id;
  if p_importance is null then return 'importance'; end if;
  if p_importance < 6 and not (
    coalesce(p_subject_qualified, false)
    and exists (select 1 from feature_flags where key = 'subject_significance_enabled' and enabled)
  ) then
    return 'importance';
  end if;
  cap := (launch_plan(coalesce(tier, 'uno'))->>'alertDailyCap')::integer;
  if exists (
    select 1 from alert_claims
     where user_id = p_user_id and event_id = p_event_id and revision >= v_revision
  ) then
    return 'duplicate';
  end if;
  select count(*) into used from alert_claims
   where user_id = p_user_id and created_at > now() - interval '24 hours';
  if used >= cap then return 'quota'; end if;
  insert into alert_claims (user_id, event_id, revision) values (p_user_id, p_event_id, v_revision);
  return 'ok';
end; $fn$;

create or replace function public.claim_alert(p_user_id uuid, p_event_id uuid, p_importance real)
returns text language sql security definer set search_path = public as $fn$
  select public.claim_alert(p_user_id, p_event_id, p_importance, 0, false)
$fn$;

-- `create_alert_delivery` stamps the revision it delivered on both durable
-- records, the way the briefing does (0099): `digest_items.delivered_revision`
-- and `user_events.delivered_revision`. Before this, an alert for an event at
-- revision 1 left the relationship at revision 0 -- and the next match run,
-- seeing a delivered row one revision behind, reopened it and briefed the same
-- story again.

create function public.create_alert_delivery(
  p_user_id           uuid,
  p_event_id          uuid,
  p_importance        real,
  p_scheduled_for     timestamptz,
  p_why               text,
  p_channels          delivery_channel[],
  p_revision          integer,
  p_subject_qualified boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  admission text;
  new_digest uuid;
  v_revision integer := greatest(coalesce(p_revision, 0), 0);
begin
  admission := public.claim_alert(p_user_id, p_event_id, p_importance, v_revision, p_subject_qualified);
  if admission <> 'ok' then return admission; end if;

  insert into public.digests (
    user_id, scheduled_for, generated_at, status, item_count,
    generation_tokens, kind
  ) values (
    p_user_id, p_scheduled_for, now(), 'ready', 1, 0, 'alert'
  ) returning digest_id into new_digest;

  insert into public.digest_items (digest_id, event_id, position, why_it_matters, delivered_revision)
  values (new_digest, p_event_id, 0, p_why, v_revision);

  insert into public.deliveries (digest_id, channel, status)
  select new_digest, c.channel, 'queued'
    from unnest(p_channels) as c(channel)
  on conflict (digest_id, channel) do nothing;

  update public.user_events
     set briefed_at = now(),
         delivered_revision = greatest(delivered_revision, v_revision)
   where user_id = p_user_id and event_id = p_event_id;

  return 'ok:' || new_digest::text;
end;
$fn$;

create or replace function public.create_alert_delivery(
  p_user_id uuid,
  p_event_id uuid,
  p_importance real,
  p_scheduled_for timestamptz,
  p_why text,
  p_channels delivery_channel[]
)
returns text language sql security definer set search_path = public as $fn$
  select public.create_alert_delivery(
    p_user_id, p_event_id, p_importance, p_scheduled_for, p_why, p_channels, 0, false
  )
$fn$;

revoke all on function public.claim_alert(uuid, uuid, real, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_alert(uuid, uuid, real, integer, boolean) to service_role;
revoke all on function public.claim_alert(uuid, uuid, real) from public, anon, authenticated;
grant execute on function public.claim_alert(uuid, uuid, real) to service_role;

revoke all on function public.create_alert_delivery(
  uuid, uuid, real, timestamptz, text, delivery_channel[], integer, boolean
) from public, anon, authenticated;
grant execute on function public.create_alert_delivery(
  uuid, uuid, real, timestamptz, text, delivery_channel[], integer, boolean
) to service_role;
revoke all on function public.create_alert_delivery(
  uuid, uuid, real, timestamptz, text, delivery_channel[]
) from public, anon, authenticated;
grant execute on function public.create_alert_delivery(
  uuid, uuid, real, timestamptz, text, delivery_channel[]
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The subject's own history, bounded
-- ---------------------------------------------------------------------------
--
-- Subject significance compares an event against *that subject's* history. The
-- first version built that history from whatever else the current match run
-- happened to hold, so a topic with fewer than four events in one page of
-- candidates scored zero -- and the baseline moved every run. This returns the
-- subject's own recent coverage: for each requested topic, its most recent
-- `p_per_topic` complete events since `p_since`, through `event_topics` (which
-- analysis writes for predefined and custom topics alike).
--
-- Bounded three ways: the topics the caller asks about (only those that
-- selected a candidate), the window, and a hard per-topic cap of 200 whatever
-- the caller passes. The lateral join reads one topic's links through
-- `event_topics_topic_idx` (0001) at a time.

create function public.subject_history(
  p_topic_ids uuid[],
  p_since     timestamptz,
  p_per_topic integer
)
returns table (
  topic_id uuid,
  event_id uuid,
  title text,
  what_happened text,
  first_seen_at timestamptz,
  topic_kind text,
  tags text[],
  other_topics jsonb,
  source_names text[]
)
language sql stable security definer set search_path = public as $fn$
  select current_topic.id, h.id, h.title, h.what_happened, h.first_seen_at,
         current_topic.kind::text, coalesce(h.tags, '{}'::text[]),
         coalesce(h.other_topics, '[]'::jsonb),
         coalesce(h.source_names, '{}'::text[])
    from unnest(p_topic_ids) as t(id)
    join public.topics current_topic on current_topic.id = t.id
    cross join lateral (
      select e.id, e.title, e.what_happened, e.first_seen_at, e.tags,
             (
               select jsonb_agg(jsonb_build_object('id', other_topic.id,
                                                    'slug', other_topic.slug,
                                                    'label', other_topic.label))
                 from public.event_topics other_link
                 join public.topics other_topic on other_topic.id = other_link.topic_id
                where other_link.event_id = e.id
                  and other_link.topic_id <> current_topic.id
             ) as other_topics,
             (
               select array_agg(distinct source.name)
                 from public.articles article
                 join public.sources source on source.id = article.source_id
                where article.event_id = e.id
             ) as source_names
        from public.event_topics et
        join public.events e on e.id = et.event_id
       where et.topic_id = current_topic.id
         and e.status = 'complete'
         and e.first_seen_at >= p_since
       order by e.first_seen_at desc
       limit least(greatest(coalesce(p_per_topic, 0), 0), 200)
    ) as h
$fn$;

comment on function public.subject_history(uuid[], timestamptz, integer) is
  'Each topic''s most recent complete events since p_since (at most p_per_topic, hard cap 200), with current topic kind and event signals so custom-topic links can be re-evaluated before building a significance baseline (0103, match.ts).';

revoke all on function public.subject_history(uuid[], timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.subject_history(uuid[], timestamptz, integer) to service_role;
