# AI providers

Which model serves which stage, how to swap provider without a deploy, and why the keys are
not in the database.

> **State:** configuration is **built** and editable in the console. Nothing calls it yet,
> because the pipeline that would is not built — see [status.md](status.md).

---

## Three capability tiers

| Tier      | Used by                            | Wants                |
| --------- | ---------------------------------- | -------------------- |
| `cluster` | Stage 3 — same event?              | Cheap, high volume   |
| `digest`  | Stage 6 — the per-person paragraph | Quality, user-facing |
| `reason`  | Deep explanations on request       | Strongest available  |

Each tier is one row in `ai_model_routes` pointing at a provider in `ai_providers`, with its
own `model`, `max_tokens` and optional `temperature`.

`ModelTier` in `src/lib/ai/deepseek.ts` and the `ai_capability` enum must stay in step —
adding a tier means adding it in both places.

---

## Keys are never in the database

> `ai_providers.api_key_env` holds the **name** of the environment variable holding the
> key. Not the key.

Keys stay in Worker secrets. Consequences worth stating plainly:

- a provider row is safe to read, back up, log and screenshot;
- **a leaked database is not a leaked provider account**;
- the console can show configuration to an operator without showing them credentials.

Adding a provider is therefore two steps, deliberately:

1. the row (console or SQL);
2. `wrangler secret put THE_ENV_NAME`.

A provider marked active whose variable is unset shows in the console as a **missing
secret**, rather than failing at request time in the middle of a run.

---

## Swapping provider

1. Set the secret — `wrangler secret put OPENAI_API_KEY` (or `.env` locally).
2. Console → **AI providers** → activate it.
3. Point one tier at it and save.
4. The route cache is 60 seconds per isolate; a save invalidates it in the isolate that
   handled the save.

Move one tier at a time. `cluster` is the safe one to move first — highest volume, least
user-visible, and a regression shows up as bad grouping rather than bad prose.

### Pre-seeded providers

`0003` seeds rows for DeepSeek (active), OpenAI, Groq, OpenRouter and Together — inactive,
awaiting a key — so switching is a toggle rather than data entry. Any provider exposing an
OpenAI-compatible `/v1` surface drops in.

---

## DeepSeek specifics

Current provider. Two things about this account will bite anyone who assumes otherwise:

**The models are `deepseek-v4-flash` and `deepseek-v4-pro`.** `deepseek-chat` and
`deepseek-reasoner` **do not exist here** — verify with `GET /models` before assuming.

**Both are reasoning models.** Completion tokens are spent on hidden `reasoning_content`
before any visible `content` appears. A "reply ok" probe burned **27 of 29** completion
tokens on reasoning. Two consequences:

1. `max_tokens` must cover **reasoning plus output**. Size it for the reasoning, not for
   the sentence you expect back.
2. Running out mid-reasoning returns **HTTP 200 with `content: ""` and
   `finish_reason: "length"`** — no exception, no error field. Unguarded that surfaces as a
   silently blank briefing.

`complete()` in `src/lib/ai/deepseek.ts` treats that case as the failure it is and throws
`TruncatedCompletionError`. **Always check `finish_reason`** in any new call path.

Seeded ceilings reflect this: cluster 4096, digest 8192, reason 16384.

---

## Prompts as data

`ai_prompts` holds the system prompt per tier, so wording can be tuned without a deploy.
Editing prompts is **superadmin-only** — a prompt change alters output for every user
simultaneously and is closer to a deploy than a settings change.

---

## Cost

Only two stages pay a model, and only one of them scales with users:

| Stage      | Frequency                   | Scales with     |
| ---------- | --------------------------- | --------------- |
| Cluster    | Per candidate group         | Volume of news  |
| Understand | **Once per event, forever** | Volume of news  |
| Generate   | Per person per story        | **Subscribers** |

`events.analysis_tokens` and `digests.generation_tokens` record spend so the console can
show the split. See [architecture.md](architecture.md#why-it-stays-cheap).

---

## Related

- [architecture.md](architecture.md) — which stage uses which tier
- [security.md](security.md) — secrets handling
