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
    setupFiles: ["./src/test-setup.ts"],
    environment: "node",
    include: ["src/**/*.test.ts"],
    /**
     * The cost-safety and budget-gate suites call `vi.resetModules()` per test
     * and then dynamically re-import the module graph under test, which is the
     * only honest way to assert on what a fresh module does before its first
     * provider call. That costs seconds, not milliseconds, and it lands close
     * enough to the 5s default that which file tips over depends on machine
     * load — `npm run test` passed while `npm run ci`, running straight after a
     * typecheck and a lint, failed a different file each time.
     *
     * Raising the ceiling does not weaken an assertion; every one of these
     * tests still fails on a wrong answer, just not on a slow machine. A test
     * that genuinely hangs still fails, 30s later.
     */
    testTimeout: 30_000,
  },
});
