-- Month navigation is limited to the reader's current history entitlement.
-- Generate every overlapping calendar month so an empty month remains a valid
-- choice, but never return metadata for retained rows outside the plan window.

create or replace function public.history_months(p_user uuid)
returns table (
  month_key        text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  available        integer,
  locked_newest_at timestamptz,
  locked_oldest_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  with reader as (
    select
      coalesce(
        (select nullif(np.timezone, '') from public.notification_preferences np
          where np.user_id = p_user),
        'UTC'
      ) as tz,
      public.history_window_start(p_user) as window_start
  ),
  months as (
    select generated.local_month
      from reader r
      cross join lateral generate_series(
        date_trunc('month', r.window_start at time zone r.tz),
        date_trunc('month', now() at time zone r.tz),
        interval '1 month'
      ) generated(local_month)
  )
  select
    to_char(m.local_month, 'YYYY-MM'),
    (m.local_month at time zone r.tz),
    ((m.local_month + interval '1 month') at time zone r.tz),
    count(d.digest_id)::integer,
    null::timestamptz,
    null::timestamptz
  from months m
  cross join reader r
  left join public.digests d
    on d.user_id = p_user
   and d.kind = 'briefing'
   and d.status in ('ready', 'sent', 'skipped')
   and d.scheduled_for >= r.window_start
   and d.scheduled_for >= (m.local_month at time zone r.tz)
   and d.scheduled_for < ((m.local_month + interval '1 month') at time zone r.tz)
  group by m.local_month, r.tz
  order by m.local_month desc;
$fn$;

comment on function public.history_months(uuid) is
  'Calendar months overlapping the current plan history window, newest first. '
  'Includes empty months and exposes no metadata from outside the window (0076).';

revoke all on function public.history_months(uuid) from public, anon, authenticated;
grant execute on function public.history_months(uuid) to service_role;
