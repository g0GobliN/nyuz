begin;

-- Writes must pass the shared subject validator in savePreferences.
drop policy if exists "own exclusions" on public.user_exclusions;
create policy "read own exclusions" on public.user_exclusions
  for select using (auth.uid() = user_id);

-- Replace in one transaction so an insert failure cannot erase saved exclusions.
create or replace function public.replace_user_exclusions(p_user_id uuid, p_terms text[])
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_terms is null or cardinality(p_terms) > 20 then
    raise exception 'You can exclude up to 20 subjects.';
  end if;
  if exists (select 1 from unnest(p_terms) t where t is null or char_length(trim(t)) not between 2 and 80) then
    raise exception 'Exclusions must contain 2 to 80 characters.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 84));
  delete from public.user_exclusions where user_id = p_user_id;
  insert into public.user_exclusions(user_id, term)
    select p_user_id, t from unnest(p_terms) t;
end;
$fn$;
revoke all on function public.replace_user_exclusions(uuid, text[]) from public, anon, authenticated;
grant execute on function public.replace_user_exclusions(uuid, text[]) to service_role;

commit;
