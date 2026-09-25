begin;

-- No label supplied now means "no opinion", and no opinion keeps the name a
-- device already has.
--
-- 0093 defaulted `p_label` to the literal 'Browser' and wrote whatever it
-- resolved on every existing-row path. That is fine for a caller that has a
-- label and wrong for one that does not: `savePushSubscription` registers the
-- installation to satisfy the push foreign key, has no label to send, and runs
-- on every dashboard visit (`refreshPush`, from the dashboard shell). So every
-- device with notifications turned on reintroduced the placeholder as its own
-- name, and the reader's own phone was listed as "Browser" beside a laptop
-- called "Linux · Firefox" — the name was not missing, it was being overwritten.
--
-- `null` is the absence now, `coalesce` is what preserves the existing name, and
-- only the insert falls back — a device that has never been named has to be
-- called something.
create or replace function public.register_device(
  p_user_id uuid,
  p_install_id uuid,
  p_label text default null,
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
  -- Empty and whitespace-only are the same as absent: there is no device whose
  -- name is "".
  safe_label text := nullif(left(coalesce(trim(p_label), ''), 80), '');
begin
  perform pg_advisory_xact_lock(hashtextextended('device:' || p_user_id::text, 0));

  if exists (select 1 from registered_devices where user_id = p_user_id and install_id = p_install_id) then
    update registered_devices
       set last_seen = now(), label = coalesce(safe_label, label)
     where user_id = p_user_id and install_id = p_install_id;
    return p_install_id;
  end if;

  -- Reuse a migrated endpoint's installation; never count it a second time.
  select install_id into legacy
    from push_subscriptions
   where user_id = p_user_id and endpoint = p_endpoint;
  if legacy is not null then
    update registered_devices
       set last_seen = now(), label = coalesce(safe_label, label)
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
  values (p_user_id, p_install_id, coalesce(safe_label, 'Browser'));
  return p_install_id;
end;
$fn$;

revoke all on function public.register_device(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_device(uuid, uuid, text, text) to service_role;

commit;
