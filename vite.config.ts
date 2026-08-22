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
    nitro({ preset: "cloudflare-module" }),
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
  },
});
