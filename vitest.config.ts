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
/**
 * Whether this run is measuring coverage.
 *
 * Read from argv because `--coverage` is exactly the condition that matters,
 * and it is not exposed anywhere else the config can see.
 */
const measuringCoverage = process.argv.includes("--coverage");

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
     *
     * A coverage run gets twice the ceiling, and only it does. v8
     * instrumentation roughly doubles the cost of the repo-walking suites --
     * `callsites.test.ts` passes every file under `src` and `scripts` through the
     * TypeScript compiler -- and under it the slowest of them crossed 30s while
     * the machine was busy, which presents as a timeout in a file with nothing
     * wrong in it. A test that genuinely hangs still fails, 60s later.
     *
     * The ceiling alone was not enough, so coverage runs also get a worker cap.
     * Measured 2026-10-12 on the 8-core development machine: one default-
     * parallelism coverage run finished with four timeouts (three PGlite
     * `beforeAll` hooks and the repo walk) after 512s, every one of the four
     * passing in ~10s when re-run alone -- a 6x starvation factor, and v8
     * instrumentation is why the ceiling is hit from above. The same suite with
     * `--maxWorkers=3` ran 3140/3140 green in 95s, so the cap does not slow the
     * gate down, it stops eight instrumented workers thrashing one machine into
     * reporting failures that are not there. Assertions are untouched: a wrong
     * answer still fails, on any machine.
     */
    testTimeout: measuringCoverage ? 60_000 : 30_000,
    /**
     * The hook ceiling is separate from the test ceiling, and it was never
     * raised with it.
     *
     * The comment above names the evidence: "three PGlite `beforeAll` hooks"
     * timed out in a coverage run, and every one of them passed in ~10s when
     * re-run alone. Raising `testTimeout` did not help those, because a
     * `beforeAll` is a HOOK and `hookTimeout` was left at vitest's 30s default.
     * A hook that blows its ceiling reports "Hook timed out in 30000ms" and
     * every test in the file is reported as SKIPPED, which is how a green
     * migration test can go red for no reason at all.
     *
     * PGlite's WASM start-up is the expensive part and it is real work, not a
     * hang: it compiles the Postgres binary in the browser's WASM heap. On a
     * machine where three agents are each running `tsc` in parallel worktrees
     * (measured load average 20-24 on 4 cores), that start-up was measured
     * crossing 30s.
     *
     * So the hook ceiling follows the test ceiling, and — this is the part that
     * matters — it is NOT conditional on the coverage run. The hook that
     * times out is PGlite's WASM start-up, and that start-up costs the same
     * whether or not v8 is instrumenting the process. Gating the hook ceiling on
     * `measuringCoverage` left `npm run test` with a 30s hook ceiling and
     * `npm run test:coverage` with 60s, so the same three PGlite files went red
     * on the plain run while the coverage run was green — the opposite of what
     * the conditional is for. A plain `vitest run` is the faster of the two and
     * needs the hook room at least as much.
     *
     * A hook that genuinely hangs still fails, on the same schedule — the
     * assertion is untouched, only the schedule for a slow machine moves.
     */
    hookTimeout: 60_000,
    maxWorkers: measuringCoverage ? 3 : undefined,
    /**
     * Coverage is measured, never targeted.
     *
     * `npm run test:coverage` writes `coverage/coverage-summary.json`, and
     * `npm run coverage:ratchet` compares it against the committed floor in
     * `.ci/baseline/coverage.json`. The floor only ever rises, so this is a
     * regression gate rather than a target to game -- see
     * scripts/coverage-ratchet.mjs for why a ratchet and not a threshold.
     *
     * `all: true` is the load-bearing option: it instruments every file under
     * `include`, not only the ones a test imported. Without it a brand-new
     * module is invisible until something imports it, which is exactly the
     * shape of a feature that lands with no tests and no warning.
     */
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/test-setup.ts",
        "src/lib/test-support/**",
        // Generated by the router plugin during a build, not written by hand.
        "src/routeTree.gen.ts",
        "src/**/*.d.ts",
      ],
      // `json-summary` is the machine-readable input the ratchet reads;
      // `text-summary` is what a developer sees without opening a file. The HTML
      // report is deliberately absent: it is a 40MB directory nobody opens in
      // CI, and the browser suite is what proves a page renders.
      reporter: ["json-summary", "text-summary"],
      reportsDirectory: "coverage",
    },
  },
});
