-- nyuz -- observability for complete events with no final topic
--
-- `finish_event_finalization` (0085) does an unconditional
-- `insert into event_topics select ... unnest(p_topics)`: there is no threshold
-- and no silent-write-failure path, so every row that reaches `status='complete'`
-- with zero `event_topics` rows got there because the deterministic classifier
-- found nothing, never because a write failed. That is the whole reason this can
-- be a simple count rather than something that needs to distinguish two causes.
--
-- Production carried ~308 of these silently. This makes the number observable
-- (`npm run db:status`) rather than something an operator has to think to query.

create or replace function public.complete_events_without_topics()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from events e
  where e.status = 'complete'
    and not exists (select 1 from event_topics et where et.event_id = e.id)
$$;

revoke all on function public.complete_events_without_topics() from public;
grant execute on function public.complete_events_without_topics() to service_role;

comment on function public.complete_events_without_topics() is
  'Count of complete events with no event_topics rows -- always "classifier found '
  'nothing", never a silent promotion failure, since finish_event_finalization has '
  'no threshold and no swallowed-error path. Surfaced by npm run db:status.';
