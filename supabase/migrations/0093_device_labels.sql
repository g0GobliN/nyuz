begin;

-- Keep the device list useful without storing a full user agent or fingerprint.
-- The browser supplies a coarse label such as "iPhone · Chrome" or
-- "Linux · Chrome · PWA"; refreshing an existing installation updates it.
create or replace function public.register_device(
  p_user_id uuid,
  p_install_id uuid,
  p_label text default 'Browser',
  p_endpoint text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  tier text;
  cap integer;
  used integer;
  legacy uuid;
  safe_label text := left(coalesce(nullif(trim(p_label), ''), 'Browser'), 80);
begin
  perform pg_advisory_xact_lock(hashtextextended('device:' || p_user_id::text, 0));

  if exists (select 1 from registered_devices where user_id = p_user_id and install_id = p_install_id) then
    update registered_devices
       set last_seen = now(), label = safe_label
     where user_id = p_user_id and install_id = p_install_id;
    return p_install_id;
  end if;

  -- Reuse a migrated endpoint's installation; never count it a second time.
  select install_id into legacy
    from push_subscriptions
   where user_id = p_user_id and endpoint = p_endpoint;
  if legacy is not null then
    update registered_devices
       set last_seen = now(), label = safe_label
     where user_id = p_user_id and install_id = legacy;
    return legacy;
  end if;

  select plan::text into tier from subscriptions where user_id = p_user_id;
  cap := (launch_plan(coalesce(tier, 'uno'))->>'devices')::integer;
  select count(*) into used from registered_devices where user_id = p_user_id;
  if used >= cap then
    raise exception '% supports % registered device(s). Remove an existing device or upgrade.',
      initcap(coalesce(tier, 'uno')), cap;
  end if;

  insert into registered_devices(user_id, install_id, label)
  values (p_user_id, p_install_id, safe_label);
  return p_install_id;
end;
$fn$;

revoke all on function public.register_device(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_device(uuid, uuid, text, text) to service_role;

commit;
