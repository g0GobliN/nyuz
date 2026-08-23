import { definePlugin } from "nitro";

import { describe, runScheduled } from "@/lib/pipeline/cron";
import type { ServerEnv } from "@/lib/supabase/admin";

/**
 * Wires Cloudflare's Cron Trigger to the pipeline.
 *
 * ---------------------------------------------------------------------------
 * Why a nitro plugin, and not an export from src/server.ts
 * ---------------------------------------------------------------------------
 *
 * A Worker's scheduled handler is `export default { scheduled }`, so the obvious
 * move is to add `scheduled` next to `fetch` in `src/server.ts`. It does not
 * work, and it fails silently, which is worse.
 *
 * `src/server.ts` is not the Worker's default export. The `cloudflare-module`
 * preset generates its own default export and reaches ours through the nitro app;
 * check `.output/server/index.mjs` and you will find nitro's own `scheduled`,
 * which does nothing but call the `cloudflare:scheduled` hook. A second
 * `scheduled` on our entry is never consulted by anything — no error, no warning,
 * just a cron that appears to be configured and never runs.
 *
 * Registering the hook is therefore not a stylistic choice about where the code
 * lives. It is the only way in.
 *
 * ---------------------------------------------------------------------------
 * waitUntil
 * ---------------------------------------------------------------------------
 *
 * Nitro passes the result of `callHook` to `ctx.waitUntil`, so returning the
 * promise is what keeps the invocation alive until the run finishes. An
 * un-awaited call here would be killed the moment the handler returned, most
 * likely mid-insert.
 */
export default definePlugin((nitro) => {
  nitro.hooks.hook("cloudflare:scheduled", ({ controller, env }) => {
    const run = async (): Promise<void> => {
      try {
        console.log(describe(await runScheduled(env as ServerEnv | undefined, controller.cron)));
      } catch (error) {
        // Nothing is listening for a throw from a cron, and an unhandled
        // rejection inside waitUntil is reported without the context that makes
        // it readable. Logged with the schedule that produced it instead.
        console.error(`cron ${controller.cron} failed`, error);
      }
    };

    return run();
  });
});
