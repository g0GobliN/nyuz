import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    // Redirects TanStack Start's bundled server entry to src/server.ts, our SSR
    // error wrapper. nitro builds the deployable output from that entry.
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    // Cloudflare Workers target. The ingestion/AI pipeline runs as Workers driven
    // by Cron Triggers and Queues, so the SSR server ships to the same runtime.
    // No Node built-ins are available at runtime — keep server code fetch-based.
    nitro({
      preset: "cloudflare-module",
      // The cron entry point. Not `src/server.ts`: the preset owns the Worker's
      // scheduled handler and dispatches it to a hook — see src/nitro/scheduled.ts
      // for why an export there would be ignored without complaint.
      plugins: ["./src/nitro/scheduled.ts"],
      cloudflare: {
        wrangler: {
          // Pinned, not inferred. Left unset, nitro derives a name from the git
          // remote — it produced "g0goblin-nyuz" here — and a worker's name is
          // its identity on Cloudflare. Anything that changed that inference
          // (renaming the repo, deploying from a fork, a CI checkout with a
          // different origin) would not fail: it would quietly create a second
          // worker, leaving the first one live with the cron triggers and the
          // secrets still on it. The deploy workflow ships to this name.
          name: "nyuz",

          // `AI_MONTHLY_TOKEN_BUDGET` and `AI_MONTHLY_COST_USD` are set as plain
          // Worker variables in the Cloudflare dashboard (see docs/deployment.md),
          // not declared here — they need to change without a redeploy. Without
          // `keep_vars`, `wrangler deploy` treats the config's variable set as
          // authoritative and wipes dashboard-only vars it doesn't know about.
          keep_vars: true,

          // Must match INGEST_CRON, DIGEST_CRON and STAGES_CRON in
          // src/lib/pipeline/cron.ts, which dispatches on the schedule string
          // and, for STAGES_CRON and DIGEST_CRON, on the minute. A mismatch is a
          // cron that fires and does nothing, so the handler logs the
          // unrecognised schedule rather than returning quietly.
          //
          // DIGEST_CRON generates and delivers every minute. The trigger limit
          // below is why digest work shares the existing one-minute trigger
          // rather than registering a fourth cron entry.
          //
          // Three, because Cloudflare registers three Cron Triggers per Worker
          // and silently drops the rest. cron.test.ts holds this list to the
          // stages that read it.
          triggers: {
            crons: [
              "*/15 * * * *",
              "* * * * *",
              "0,2,6,8,9,14,17,23,24,29,32,38,39,44,47,53,54,59 * * * *",
            ],
          },
        },
      },
    }),
  ],
  resolve: {
    // React and the TanStack packages must resolve to one copy each. Two copies
    // of React break hooks; two routers break context lookups at runtime.
    dedupe: [
      "react",
      "react-dom",
      "@tanstack/react-router",
      "@tanstack/react-start",
      "@tanstack/react-query",
    ],
  },
  server: {
    port: 8080,
    // Telegram only posts to public HTTPS, so a local webhook needs a tunnel in
    // front of this server. Vite otherwise rejects the tunnel's Host header and
    // Telegram sees nothing but failures.
    allowedHosts: [".trycloudflare.com"],
  },
});
