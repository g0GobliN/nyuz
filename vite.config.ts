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

          // Must match INGEST_CRON, DIGEST_CRON and STAGES_CRON in
          // src/lib/pipeline/cron.ts, which dispatches on the schedule string
          // and, for STAGES_CRON, on the minute. A mismatch is a cron that fires
          // and does nothing, so the handler logs the unrecognised schedule
          // rather than returning quietly.
          //
          // Three, because Cloudflare registers three Cron Triggers per Worker
          // and silently drops the rest. cron.test.ts holds this list to the
          // stages that read it.
          triggers: {
            crons: ["*/15 * * * *", "*/5 * * * *", "0,10,20,25,40,50,55 * * * *"],
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
