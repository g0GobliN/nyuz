# Agent notes

nyuz is a TanStack Start app (React 19, TypeScript, Tailwind v4).

- `npm run dev` serves on port 8080. `npm run build` produces a nitro server bundle.
- Routes are file-based under `src/routes/`; `src/routeTree.gen.ts` is generated — never edit it by hand.
- `npx tsc --noEmit` must stay clean. `noUncheckedIndexedAccess` is on, so index
  access yields `T | undefined` — narrow before use.
- Colour is limited to three values: black, white, and one amber (`--signal`, hue 70).
  Every other token in `src/styles.css` is chroma 0. Do not introduce a fourth colour.

## DeepSeek

- Models are `deepseek-v4-flash` (high volume) and `deepseek-v4-pro` (user-facing
  quality), read from `MODEL_*` env vars. `deepseek-chat` / `deepseek-reasoner`
  do NOT exist on this account — verify with `GET /models` before assuming.
- **Both are reasoning models.** Completion tokens are spent on
  `reasoning_content` before any visible `content` is produced — a "reply ok"
  test burned 27 of 29 tokens on reasoning. Budget `max_tokens` for reasoning
  plus output, or responses come back with empty `content` and
  `finish_reason: "length"` and no error. Always check `finish_reason`.
- OpenAI-compatible API, so use the `openai` SDK pointed at `DEEPSEEK_BASE_URL`.
