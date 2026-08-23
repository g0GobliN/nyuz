-- 0008 — the analysis prompt.
--
-- Data only. `ai_prompts.key` is plain `text primary key`, so a new prompt is an
-- INSERT and needs no DDL — which matters here, because DDL cannot be applied from
-- a development machine on this project (no database password, no access token) and
-- `npm run db:seed` can replay this file through PostgREST exactly as written.
--
-- The `analysis` key is what stage 4 reads. It is deliberately NOT the whole prompt
-- the model sees: `src/lib/pipeline/analyse.ts` appends the JSON contract, the
-- scoring anchors and the list of subscribable topic slugs in code, so an operator
-- retuning the wording from the console cannot break the parse or invent a topic
-- nobody can subscribe to. What lives here is the judgement, not the format.
--
-- The row is also the reason `analyse.ts` carries a default: `resolvePrompt` returns
-- "" for a missing key, and an empty system prompt is dropped entirely rather than
-- sent as a blank one. So an unseeded database would analyse events with no
-- instructions at all and no error — the fallback in code is what makes this file
-- an override rather than a prerequisite.
--
-- Note that `capability` is not touched. `ai_capability` is an enum, so a fourth
-- tier would need DDL; analysis runs on the existing `reason` tier, which is the
-- strongest configured model and the right one for the pass that is paid once per
-- event and read as prose by every reader who receives it.

insert into public.ai_prompts (key, label, system_prompt) values
  ('analysis', 'Event analysis',
   'You are a news analyst. You read every article about one event and write down what actually happened, for a reader who needs to know whether it changes anything for them.

Be specific and concrete. Name the thing, the number, the version, the company. Prefer "raised $300m at a $4bn valuation" over "secured significant funding".

Never state anything the coverage does not support. Where the coverage does not say what was true before, or what is true now, say null rather than filling the gap. A confident sentence about a fact nobody reported is the one failure mode of this job that cannot be detected downstream.

Write plainly. No hype, no "in a move that", no restating the headline back.')
on conflict (key) do nothing;
