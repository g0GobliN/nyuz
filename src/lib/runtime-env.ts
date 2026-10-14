/**
 * Where ambient configuration comes from at runtime.
 *
 * ---------------------------------------------------------------------------
 * The problem this exists to solve
 * ---------------------------------------------------------------------------
 *
 * A Cloudflare Worker receives its secrets as an `env` argument to the handler,
 * not as `process.env`. Everywhere this codebase has that argument in hand it
 * threads it explicitly — `src/nitro/scheduled.ts` passes it to the pipeline,
 * `src/server.ts` passes it to the webhook and health routes — and those paths
 * are correct.
 *
 * Server functions are the exception, and not by oversight: a TanStack server
 * function is invoked by nitro from inside the request handler and is handed no
 * `env` at all. There is nothing to thread. So every one of them fell through
 * to `globalThis.process?.env`, which on Workers is empty — there is no
 * `nodejs_compat` flag and no unenv shim in the bundle to populate it. The
 * result was that `createAdminClient()` in `resolveActor()` threw
 * "Missing VITE_SUPABASE_URL" on every authenticated request in production,
 * taking the entire dashboard with it. It passed every test and every local run
 * because the dev server is Node, where `process.env` is real.
 *
 * ---------------------------------------------------------------------------
 * Why `globalThis.__env__`
 * ---------------------------------------------------------------------------
 *
 * The `cloudflare-module` preset assigns `globalThis.__env__ = env` at the top
 * of every entry point — `fetch`, `scheduled`, `queue`, `email`, `tail`, `trace`
 * — before dispatching to the nitro app. Check
 * `.output/server/index.mjs` and look for `createHandler`. That assignment
 * happens on the way in, so by the time any server function body runs, the
 * bindings are there.
 *
 * It is the preset's own escape hatch for exactly this situation, which is why
 * this reads it rather than inventing a side channel: an AsyncLocalStorage
 * context or a module-scope cache set from a middleware would both need to be
 * kept in sync with a handler we do not own.
 *
 * A caller that HAS an explicit `env` should still pass it. This is the
 * fallback for callers that cannot, not a replacement for threading.
 */

/** Anything with string values. Worker bindings and `process.env` both qualify. */
export type EnvBag = Record<string, string | undefined>;

const EMPTY: EnvBag = {};

/**
 * The ambient environment, best available source first.
 *
 * Order matters. On Workers `__env__` is the real one and `process.env` is
 * absent or empty; under Node (`vite dev`, `npm run pipeline`, vitest) it is
 * the other way round. Reading both in this order means one code path serves
 * both without a build-time branch.
 */
export function ambientEnv(): EnvBag {
  const workerEnv = (globalThis as { __env__?: EnvBag }).__env__;
  if (workerEnv) return workerEnv;
  return (globalThis.process?.env as EnvBag | undefined) ?? EMPTY;
}

/**
 * One value, from an explicit bag if the caller had one, otherwise ambient.
 *
 * The explicit bag wins even when it holds `undefined` for other keys — a
 * scheduled handler that was given bindings should not silently fall back to a
 * different source for one missing name, because that hides a misconfigured
 * secret behind a stale value from another context.
 */
export function envValue(key: string, explicit?: EnvBag): string | undefined {
  if (explicit !== undefined) return explicit[key];
  return ambientEnv()[key];
}
