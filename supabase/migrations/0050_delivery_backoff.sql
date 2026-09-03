-- nyuz -- spacing out delivery retries
--
-- `deliverDue` selects every queued delivery whose attempt count is under the
-- ceiling, and the digest cron fires every five minutes. Nothing else gates the
-- selection, so a retry has always meant "try again on the next tick" -- five
-- attempts inside twenty-five minutes, all of them at the same instant.
--
-- That is the wrong shape for the failure it is meant to survive. The retryable
-- errors are, almost by definition, the ones where the far side is asking for
-- less traffic: a Resend 429, a Telegram 429, a push service 503. Every reader
-- whose briefing was queued in the same window retries together, so the
-- response to being rate limited is a synchronised burst against the provider
-- that just rate limited us, four more times, and then a permanent failure for
-- everybody. An outage lasting half an hour takes the whole batch with it.
--
-- ---------------------------------------------------------------------------
-- What this adds
-- ---------------------------------------------------------------------------
--
-- One nullable column holding the earliest time a row may be tried again.
-- `deliverDue` filters on it, and the send path sets it when it re-queues.
--
-- Nullable, and null means "eligible now", for two reasons. Rows queued for the
-- first time have never been deferred and should go immediately -- a first
-- attempt is not a retry. And every delivery already in flight when this
-- migration lands keeps working without a backfill, which matters because the
-- backfill would otherwise have to guess a schedule for rows mid-retry.
--
-- The schedule itself lives in TypeScript (`RETRY_BACKOFF_MINUTES` in
-- digest.ts) rather than in a default here. It is a product decision about how
-- long to keep trying, it is jittered per row so the herd disperses, and a
-- constant next to the code that reads it is easier to reason about than a
-- default expression that only fires on insert.

alter table public.deliveries
  add column if not exists next_attempt_at timestamptz;

comment on column public.deliveries.next_attempt_at is
  'Earliest time this delivery may be attempted again. Null means eligible now. Set with jittered exponential backoff when a send fails retryably.';

-- The selection is "queued, under the attempt ceiling, and due". Without this
-- index that is a sequential scan over every delivery ever recorded, run every
-- five minutes for ever. Partial on `queued` because the other statuses are
-- terminal and are never selected here, which keeps the index the size of the
-- backlog rather than the size of the history.
create index if not exists deliveries_due_idx
  on public.deliveries (next_attempt_at, attempts)
  where status = 'queued';
