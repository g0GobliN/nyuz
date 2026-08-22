# Agent notes

nyuz is a TanStack Start app (React 19, TypeScript, Tailwind v4).

- `npm run dev` serves on port 8080. `npm run build` produces a nitro server bundle.
- Routes are file-based under `src/routes/`; `src/routeTree.gen.ts` is generated — never edit it by hand.
- `npx tsc --noEmit` must stay clean. `noUncheckedIndexedAccess` is on, so index
  access yields `T | undefined` — narrow before use.
- Colour is limited to three values: black, white, and one blue (`--signal`, hue 253).
  Every other token in `src/styles.css` is chroma 0. Do not introduce a fourth colour.
