-- The keyword ladder opens to every plan: uno 4 / plura 50 / omni 100,
-- prioritize and exclude sharing one allowance (prioritize draws first). This
-- supersedes the 0082 definition of `enforce_topic_controls`, which reserved
-- keywords for Omni entirely — without it, a Plura save through the server
-- function would pass its own gate and then be refused here at the last guard.
--
-- The cap is read from `launch_plan`, so the SQL number and PLAN_LIMITS stay
-- one number. It fails closed: if `topicKeywords` is missing from the JSON —
-- which can only mean the regenerated 0081 has not been re-applied — the pool
-- is 0, so existing keyword-free rows keep working and any new keyword save is
-- refused loudly rather than silently unlimited. The importance dial keeps its
-- Plura+ floor.
begin;

create or replace function public.enforce_topic_controls()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare tier text; control text; pool integer;
begin
  select plan::text into tier from subscriptions where user_id = new.user_id;
  tier := coalesce(tier, 'uno');
  control := launch_plan(tier)->>'notificationControl';
  if control = 'basic' and new.importance <> 'notable'
    and (tg_op = 'INSERT' or new.importance is distinct from old.importance) then
    raise exception 'Per-topic controls are available on Plura and Omni.';
  end if;
  pool := coalesce((launch_plan(tier)->>'topicKeywords')::integer, 0);
  if cardinality(new.keywords) + cardinality(new.exclude_keywords) > pool
    and (tg_op = 'INSERT' or new.keywords is distinct from old.keywords
      or new.exclude_keywords is distinct from old.exclude_keywords) then
    raise exception 'Your plan allows % keywords per topic.', pool;
  end if;
  return new;
end; $fn$;

commit;
