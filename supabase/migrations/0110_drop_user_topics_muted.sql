-- nyuz -- remove `user_topics.muted`
--
-- ---------------------------------------------------------------------------
-- WHY THE COLUMN GOES
-- ---------------------------------------------------------------------------
--
-- Muting a topic has always been the reader's answer to "never send me
-- stories about this subject", and since 0089 that answer lives in
-- `muted_topics`, keyed by the topic's label. The boolean on `user_topics` is
-- the same idea in a second place, and it has never had a writer: no code
-- path sets it true, while five read sites filter on `muted = false` as
-- though it meant something.
--
-- A column that is never written but is read as a filter is not dead weight,
-- it is a trap. `loadPreferences` returns only unmuted rows, while
-- `replaceTopics` diffs the submitted list against ALL of a reader's rows --
-- so the first future feature that writes `muted = true` would make the next
-- topics-page save silently delete the muted follow, answering `{ ok: true }`
-- while unsubscribing the reader from something they explicitly kept. The
-- ruling on the workstream review closed this branch of the trap with an
-- explicit invariant: "a muted `user_topics` row must either be intentionally
-- preserved by topic replacement, or the muted state must not exist in that
-- table." Mute semantics already exist, in one table, with one writer. The
-- column is the ambiguity, so the column goes.
--
-- The table is tiny today (no writer, no true values), so the drop costs no
-- data. Every read site is updated in the same deploy: without the column,
-- `.eq("muted", false)` would fail loudly rather than filter nothing, which
-- is the failure mode that finds a missed site instead of hiding one.
--
-- Safe to re-run: the guard skips when the column is already gone.

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'user_topics'
       and column_name = 'muted'
  ) then
    alter table public.user_topics drop column muted;
    raise notice 'dropped user_topics.muted';
  else
    raise notice 'user_topics.muted already absent';
  end if;
end
$$;

commit;
