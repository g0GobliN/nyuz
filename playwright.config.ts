import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests against the artifact that deploys.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * Every other check in `npm run ci` reads source. `tsc` cannot see that a
 * component throws at module scope, that a route file fails to import, or that
 * the client bundle 404s its own asset. The failure mode this was written for is
 * the one the deploy job already guards against from the other side: a
 * `VITE_`-prefixed variable that is unset throws in `src/lib/supabase/client.ts`
 * *at module scope*, so every page 500s while the build is green and 2744 tests
 * pass. A build that has never been asked to answer a request cannot be called
 * verified.
 *
 * ---------------------------------------------------------------------------
 * Why the built Worker and not `vite dev`
 *
 * The deploy target is a Cloudflare Worker, and the build stamps
 * `compatibility_date` with the day it ran. Serving that output through
 * `wrangler dev` is the only way to prove the same runtime that production uses
 * answers a request -- a dev server is a different runtime with different
 * resolution, so it cannot make that promise.
 *
 * It runs from the repository root, not `.output/server`: wrangler finds the
 * generated `.output/server/wrangler.json` through `.wrangler/deploy/config.json`,
 * which records a relative path, and refuses to start when it can see both files
 * from different base paths.
 *
 * The build runs inside `command`, not as a separate CI step, so the artifact
 * under test cannot be one left over from an earlier build. The e2e job
 * therefore builds exactly once.
 *
 * ---------------------------------------------------------------------------
 * Why no credentials
 *
 * `wrangler dev --local` never contacts the Cloudflare API. The `VITE_` values
 * are placeholders compiled into the bundle: every public page reads site
 * content through `getPublicSiteContent`, which never throws and falls back to
 * the copy bundled in the components, so the public routes render the same
 * markup production serves before anyone edits a headline. Nothing here needs a
 * Supabase session, and nothing here asserts on account-scoped pages.
 */

const PORT = Number(process.env["E2E_PORT"] ?? 8788);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // One worker: the suite is a smoke test over a local Worker, and each worker
  // boots its own wrangler request loop against one dev server.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // The whole point is to fail fast on a broken page; a 30s ceiling per test is
  // generous for a local Worker.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && wrangler dev --port ${PORT} --ip 127.0.0.1 --local`,
    url: baseURL,
    // 5 minutes: the build plus workerd's first start is the slow part, and a
    // timeout that expires mid-build reports a confusing timeout rather than a
    // build error.
    timeout: 300_000,
    // Never reuse. `reuseExistingServer` sounds like a convenience and is a trap:
    // a `wrangler dev` left running from an earlier build keeps serving the HTML
    // it loaded, while the asset directory underneath it has been rewritten by a
    // later build -- so every page 404s a hashed chunk whose name no longer
    // exists, and the failure looks exactly like a real broken deploy. It cost an
    // hour to diagnose once, in this repository, with a server 97 minutes old.
    //
    // With this off, a busy port fails immediately with a message naming the
    // address, which is the honest outcome: kill the stray server, or point
    // `E2E_PORT` at another one. The build then always belongs to this run.
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
