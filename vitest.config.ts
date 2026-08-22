import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * Separate from vite.config.ts on purpose.
 *
 * The app config loads the TanStack Start plugin and the nitro Cloudflare
 * preset, both of which build a server bundle and expect a Workers runtime.
 * Neither is wanted here — the units under test are plain functions, and
 * dragging that machinery into the runner makes tests slow and failures hard to
 * read. `tsConfigPaths` is kept because the code imports through `@/`.
 */
export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
