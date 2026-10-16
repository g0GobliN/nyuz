-- ---------------------------------------------------------------------------
-- The briefing build's cursor: where a build that spans several invocations got
-- to, so the next one resumes instead of starting again.
--
-- The defect this closes (measured 2026-10-16, decisions/reader-delivery.md):
-- one invocation used to build the whole briefing. On the reader whose 22:30Z
-- slot was killed six nights running -- 1,000 unbriefed matches -- that build
-- costs about 17.7 s of CPU, of which the readiness gate is 15.5 s (median
-- 338 ms per brief), against a Workers free-plan Cron Trigger budget whose
-- observed success ceiling is ~710 ms (`cpuTimeUs`, 2026-10-11: 767 scheduled
-- invocations that day succeeded above 10 ms, the largest at 709,805 us). The
-- build did not fail; it was killed, at the same stage, every night, and the
-- reader received nothing.
--
-- So the build is cut at its own stage boundaries -- select, screen, gate,
-- write -- and each boundary is written down here. Arity is one column on
-- purpose: this is a cursor and not a record, nothing but the build reads it,
-- and everything durable it produces (the items, their artifacts, their
-- provenance, the delivery) is written to the tables that already exist.
--
-- Shape (JsonbGenerationProgress in src/lib/pipeline/digest.ts):
--   v           1. A record whose version this build does not know is *no*
--               record, and the briefing starts again rather than resuming from
--               a cursor nothing can vouch for.
--   stage       select | screen | gate | write.
--   snapshotAt  The instant the candidate snapshot was frozen. Ranking is a pure
--               function of it, so the order a later tick resumes against is the
--               order the first tick produced.
--   candidates  The considered set, in ranked order, with the
--               `events.material_revision` each was frozen at.
--   queue       Twin survivors of `candidates`, in order -- what the gate walks.
--   cursor      How far into `queue` the gate has got.
--   verdicts    The gate's verdicts so far: kind null means ready to ship.
--   ticks       Invocations that have advanced this build.
--   heartbeatAt When the progress was last written.
--
-- Semantics, deliberately narrow:
--   NULL        No build in flight: never started, finished, expired, or given
--               up on. `finish`, `expireSlot` and a `failGeneration` that
--               exhausts its attempts all clear it, so a digest that has left
--               the generating state cannot be resumed.
--   non-null    A build with work left. `loadDue` treats such a row as due
--               immediately rather than after GENERATION_LEASE_MINUTES: the
--               lease exists so a *claim* whose worker never came back can be
--               retaken, and a row carrying a cursor has already come back.
--
-- Nullable and add-only: every existing row keeps NULL, which is exactly the
-- single-invocation behaviour it had before this migration. No row is
-- rewritten, and no briefing is rebuilt for a row that already exists.

alter table public.digests
  add column if not exists generation_progress jsonb;

comment on column public.digests.generation_progress is
  'Cursor of a briefing build that spans several Cron ticks (0119). NULL means no build is in flight. Non-null carries the frozen candidate snapshot (with the material revision each candidate was frozen at), the twin survivors, how far the readiness gate has got, and its verdicts so far -- so the next tick resumes rather than restarting a build the free-plan CPU budget kills. A record whose version the build does not know is treated as no record.';
