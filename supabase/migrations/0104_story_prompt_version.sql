-- Keep the persisted cache version aligned with the current reader-story prompt.
create or replace function public.stage_shared_story(p_event_id uuid,p_version text,p_owner uuid,p_payload jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update event_understanding set phase='persisting',payload=p_payload,prompt_version='story:3',updated_at=now()
    where event_id=p_event_id and content_version=p_version and owner=p_owner and phase in ('requesting','persisting');
  return found;
end $$;
