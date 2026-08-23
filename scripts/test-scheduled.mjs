/**
 * Fires the built Worker's scheduled handler, the way Cloudflare would.
 *
 *   npm run build
 *   npm run cron:test
 *   npm run cron:test -- "*\/15 * * * *"     a specific schedule
 *   npm run cron:test -- "10,40 * * * *"     clustering — this one spends money
 *   npm run cron:test -- "20,50 * * * *"     analysis — so does this one
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * A Cron Trigger is the one part of the Worker that cannot be exercised by
 * opening a page. `wrangler dev --test-scheduled` is the usual answer and needs
 * wrangler, a Cloudflare account and credentials; this needs the build output and
 * a service-role key, both of which are already here.
 *
 * It imports `.output/server/index.mjs` — the artifact that actually deploys, not
 * the source — and calls the `scheduled` export on it. So it proves the whole
 * chain: that the nitro plugin was bundled, that it registered the hook, that the
 * preset's handler calls it, that the schedule string is dispatched, and that the
 * run reaches the database. The one thing it cannot prove is that Cloudflare's
 * scheduler pulls the trigger at the right minute; `triggers.crons` in
 * .output/server/wrangler.json is the whole of that claim.
 *
 * Plain .mjs rather than TypeScript because it consumes a build artifact, so
 * there is nothing here for tsrun to resolve or for tsc to check.
 *
 * This reads the service-role key from the environment and writes to the real
 * database. It is not a test in the `npm test` sense and never runs in CI.
 */

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const WORKER = resolve(".output/server/index.mjs");
const DEFAULT_CRON = "*/15 * * * *";

if (!existsSync(WORKER)) {
  console.error(`No build output at ${WORKER}.\nRun \`npm run build\` first.`);
  process.exit(1);
}

const cron = process.argv[2] ?? DEFAULT_CRON;

// Exactly what Cloudflare passes, and no more — anything this harness invents
// that the runtime does not provide would be a lie about what the handler can
// rely on.
const controller = { cron, scheduledTime: Date.now(), noRetry: () => {} };

const pending = [];
const ctx = {
  waitUntil: (promise) => pending.push(promise),
  passThroughOnException: () => {},
};

const env = {
  VITE_SUPABASE_URL: process.env["VITE_SUPABASE_URL"],
  SUPABASE_SERVICE_ROLE_KEY: process.env["SUPABASE_SERVICE_ROLE_KEY"],
  // The clustering schedule calls a model, and the AI router reads its provider
  // key out of the same env bag. In production these are Worker secrets set with
  // `wrangler secret put`, so passing them here models the deployed shape rather
  // than inventing anything: without them the handler falls back to env routing
  // and then fails on the first call with "Missing DEEPSEEK_API_KEY", which is
  // exactly what a deploy that forgot the secret would do.
  DEEPSEEK_API_KEY: process.env["DEEPSEEK_API_KEY"],
  DEEPSEEK_BASE_URL: process.env["DEEPSEEK_BASE_URL"],
};

if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run through `node --env-file=.env`, which is what npm run cron:test does.");
  process.exit(1);
}

const worker = await import(pathToFileURL(WORKER).href);
const handler = worker.default;

if (typeof handler?.scheduled !== "function") {
  console.error("The built worker has no scheduled export. The nitro preset should provide one.");
  process.exit(1);
}

console.log(`cron ${cron}\n`);

const started = Date.now();
handler.scheduled(controller, env, ctx);

if (pending.length === 0) {
  console.error(
    "\nNothing called waitUntil. The hook is not registered — check nitro's `plugins`.",
  );
  process.exit(1);
}

// Cloudflare keeps the invocation alive until these settle, and kills it if they
// do not. Awaiting them is what makes this a test of the run rather than of the
// dispatch.
await Promise.all(pending);

console.log(`\n${Math.round((Date.now() - started) / 1000)}s`);
