-- nyuz -- a bounded, race-safe write path for `muted_topics`
--
-- ---------------------------------------------------------------------------
-- THE HOLE
-- ---------------------------------------------------------------------------
--
-- `muted_topics` (0089) is written by `saveMutedTopic` as a raw upsert keyed
-- (user_id, topic), where `topic` is whatever string the request carried --
-- any 1–80 characters. Nothing limited how many rows one account could hold:
-- a script minting distinct strings grows the table without bound, and
-- `loadFeedback` selects every row back on each dashboard load, so the same
-- account also inflates its own payload forever. This is the growth class
-- 0108 closed for canonical topics; the card-mute path simply predates it.
--
-- ---------------------------------------------------------------------------
-- THE BRAKE
-- ---------------------------------------------------------------------------
--
-- One function owns every write, as 0108's lesson prescribes: a number in
-- application code is a display value, never a guard. The cap is checked
-- under an advisory lock so two concurrent saves from one account cannot both
-- pass the count and both insert (the same technique 0108 used for the
-- stage-5 window and 0082 for the topic cap).
--
--   100 muted topics per account. A reader mutes from story cards, one card
--   at a time; a hundred is far past any honest use and low enough that a
--   hostile account's damage is a bounded set, not a table.
--
-- The delete path is uncapped: unmuting must never be refused, or a full set
-- would trap a reader instead of teaching them the limit.
--
-- The label is stored trimmed, and the server has already validated it is a
-- real topic label (validateTopicLabel) before calling -- the database repeats
-- only the structural check, because the semantic one is app code with tests.
--
-- Safe to re-run: `create or replace`.

begin;

create or replace function public.save_muted_topic(
  p_user_id uuid,
  p_topic text,
  p_muted boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  label text;
begin
  if p_user_id is null then return 'no-user'; end if;

  label := btrim(coalesce(p_topic, ''));
  if label = '' or char_length(label) > 80 then return 'invalid'; end if;

  perform pg_advisory_xact_lock(hashtextextended('muted-topics:' || p_user_id::text, 0));

  if not p_muted then
    delete from public.muted_topics where user_id = p_user_id and topic = label;
    return 'ok';
  end if;

  -- Idempotent, so a double-tap costs one row and one answer.
  if exists (select 1 from public.muted_topics where user_id = p_user_id and topic = label) then
    return 'ok';
  end if;

  if (select count(*) from public.muted_topics where user_id = p_user_id) >= 100 then
    return 'limit';
  end if;

  insert into public.muted_topics (user_id, topic) values (p_user_id, label);
  return 'ok';
end;
$fn$;

revoke all on function public.save_muted_topic(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.save_muted_topic(uuid, text, boolean) to service_role;

commit;
