-- Keep historical rows, but stop old work remaining active forever.
-- This is intentionally bounded and idempotent; it never deletes corpus or
-- delivery history. The worker calls it from maintenance and operators may
-- call it with a small limit during a controlled cleanup.

begin;

create index if not exists digests_ready_scheduled_idx
  on public.digests (scheduled_for asc)
  where status = 'ready';

create index if not exists deliveries_queued_created_idx
  on public.deliveries (created_at asc)
  where status = 'queued';

create or replace function public.expire_stale_work(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  briefing_count integer := 0;
  delivery_count integer := 0;
  bounded_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
begin
  with stale as (
    select d.digest_id
      from public.digests d
     where d.status = 'ready'
       and d.kind = 'briefing'
       and d.scheduled_for < now() - interval '120 minutes'
     order by d.scheduled_for asc
     limit bounded_limit
     for update skip locked
  )
  update public.digests d
     set status = 'failed',
         generated_at = coalesce(d.generated_at, now()),
         generation_failure_reason = 'briefing slot expired; not sent'
    from stale
   where d.digest_id = stale.digest_id;
  get diagnostics briefing_count = row_count;

  with stale as (
    select dl.id
      from public.deliveries dl
      join public.digests d on d.digest_id = dl.digest_id
     where dl.status = 'queued'
       and d.kind = 'briefing'
       and d.scheduled_for < now() - interval '24 hours'
     order by d.scheduled_for asc, dl.created_at asc
     limit bounded_limit
     for update of dl skip locked
  )
  update public.deliveries dl
     set status = 'failed',
         last_error = coalesce(dl.last_error, 'delivery retry window expired')
    from stale
   where dl.id = stale.id;
  get diagnostics delivery_count = row_count;

  return jsonb_build_object(
    'expired_briefings', briefing_count,
    'expired_deliveries', delivery_count
  );
end;
$fn$;

revoke all on function public.expire_stale_work(integer) from public, anon, authenticated;
grant execute on function public.expire_stale_work(integer) to service_role;

commit;
