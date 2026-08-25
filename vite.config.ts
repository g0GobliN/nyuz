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
          // Must match the CRON constants in src/lib/pipeline/cron.ts, which
          // dispatches on the schedule string. A mismatch is a cron that fires
          // and does nothing, so the handler logs the unrecognised schedule
          // rather than returning quietly.
          triggers: {
            crons: [
              "*/15 * * * *",
              "10,40 * * * *",
              "20,50 * * * *",
              "25,55 * * * *",
              "*/5 * * * *",
              "0 12 * * 1",
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
