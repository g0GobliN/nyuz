-- ---------------------------------------------------------------------------
--
-- GOB-15 T3: reconcile alert digests stuck at `ready` to honest terminal states.
--
-- `digests.status` is the generation lifecycle, but for alerts it had been read
-- as though it were delivery state. An alert digest is born `ready`
-- (`create_alert_delivery`), and `reconcileDigestAfterTerminal` now settles it
-- to `sent`/`failed` once its deliveries resolve -- but that reconciler landed
-- after a backlog had already accumulated. On 2026-10-14 the live table held
-- 70 `kind='alert'` digests still at `ready`, every one of them terminal (no
-- queued deliveries left): 39 with a `sent` delivery (the reader was reached)
-- and 31 with only `failed` deliveries (the reader was never reached).
--
-- This migration maps those stuck rows to the new model, additively. It is an
-- UPDATE of `status` only: no rows are inserted or deleted, and no schema
-- changes. The per-channel truth stays in `deliveries` (queued/sent/failed),
-- from which the whole-alert outcome (success/partial/failed/pending) is
-- derived at read time (`alertDeliveryOutcome` in alerts-recent.ts).
--
-- Mapping of existing rows to the new model:
--   `ready` with a `sent` delivery    -> `sent`    (success or partial: >=1 channel delivered)
--   `ready` with no `sent` delivery   -> `failed`  (every channel failed)
--   `sent` / `failed` / others        -> unchanged
--
-- Rollback: nothing else was written by this migration, so restoring the prior
-- state is exactly
--
--   update public.digests d
--      set status = 'ready', generation_failure_reason = null
--    where d.kind = 'alert'
--      and d.digest_id in (<the ids this run changed>)
--      and d.status in ('sent', 'failed');
--
-- Capturing that id list before running this file is the complete, reversible
-- rollback plan; the statements below are otherwise idempotent in effect (an
-- already-terminal row is left alone).

update public.digests d
   set status = 'sent'
 where d.kind = 'alert'
   and d.status = 'ready'
   and exists (
     select 1 from public.deliveries dl
      where dl.digest_id = d.digest_id
        and dl.status = 'sent'
   );

update public.digests d
   set status = 'failed',
       generation_failure_reason = 'alert delivery failed; reconciled from a stuck ready status'
 where d.kind = 'alert'
   and d.status = 'ready'
   and not exists (
     select 1 from public.deliveries dl
      where dl.digest_id = d.digest_id
        and dl.status = 'sent'
   );
