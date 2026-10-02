-- nyuz -- admit the shared impact writer to the reservation gate.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
--
-- 0085 froze pipeline AI spend by patching reserve_ai_tokens to refuse every
-- feature except 'understand_generation' and 'probe'. That was the right call
-- for the code-first era: the deterministic finalization pass needs no model,
-- and every remaining call was reader-triggered.
--
-- It also left `event_impacts` with no possible writer. The briefing's first
-- inclusion rung reads that table (0028); with the gate closed, the ladder in
-- inclusion.ts collapses to its last rung and every card in every briefing
-- prints the same "You follow X." sentence. src/lib/pipeline/impacts.ts
-- restores the designed writer — one sentence per event, shared by every
-- reader, never per-user, never on the briefing clock, bounded by
-- IMPACT_LIMIT and by every ceiling the reservation path enforces.
--
-- This migration adds 'impact' to the allowlist and nothing else: the stage
-- itself is opt-in via the `impact_writer_enabled` flag (migration 0106), so
-- the pipeline still makes zero AI calls by default. The daily
-- and monthly checks 0085 installed still apply to it, as do the 0053 safety
-- caps and the 0080 provider-credit gate when enabled. At IMPACT_LIMIT=4
-- events per run, four runs an hour, the worst-case settled cost of the stage
-- is a few cents a day against the $0.50 daily pro cap.
--
-- Idempotent: re-running notices the allowlist already admits 'impact'.

do $$
declare
  d text;
  anchor text := $a$if p_feature not in ('understand_generation','probe') or p_feature is null then return null; end if;$a$;
  patched text := $p$if p_feature not in ('understand_generation','probe','impact') or p_feature is null then return null; end if;$p$;
  signatures integer;
begin
  select count(*) into signatures from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reserve_ai_tokens';
  if signatures <> 1 then
    raise exception 'Expected exactly one reserve_ai_tokens signature, found %', signatures;
  end if;

  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reserve_ai_tokens';
  if d is null then
    raise exception 'reserve_ai_tokens definition unreadable';
  end if;

  if position(patched in d) > 0 then
    raise notice 'reserve_ai_tokens already admits impact -- nothing to do';
    return;
  end if;

  if position(anchor in d) = 0 then
    raise exception
      'reserve_ai_tokens: expected 0085 allowlist line not found -- the installed '
      'function''s shape has moved. Update 0105 rather than skipping it.';
  end if;

  d := replace(d, anchor, patched);
  execute d;
end $$;

comment on function public.reserve_ai_tokens(
  uuid, text, text, integer, integer, integer, bigint, bigint, bigint, bigint, text
) is
  'Reserves tokens/cost for one AI call under an advisory lock, atomically '
  'against: the daily per-model caps, the monthly token and cost safety caps, '
  'the per-user monthly cap, the 0080 provider-credit gate when enabled, and '
  'the 0085 feature allowlist (understand_generation, probe, and — since 0105 '
  '— the shared impact writer). Returns null on refusal, the new '
  'ai_usage_ledger row id on success.';
