/**
 * Runs one of the TypeScript files in scripts/ against the real project.
 *
 *   node --env-file=.env scripts/tsrun.mjs scripts/check-feeds.ts [args…]
 *
 * Why this exists. The operator scripts want the same modules the Worker runs —
 * the feed parser, the canonicaliser, the pipeline stages — and those import each
 * other through the `@/` alias from tsconfig. Node can strip types on its own
 * since v22, but it will not resolve that alias, so a bare `node scripts/x.ts`
 * dies on the first `@/lib/...` import.
 *
 * esbuild is already in the tree as a Vite dependency, understands the alias
 * through a flag, and bundles in tens of milliseconds. So: bundle to a cache
 * directory, import the result. No new dependency, no separate tsconfig, and the
 * scripts import application code the same way application code does.
 *
 * `packages: external` leaves node_modules alone — only first-party source is
 * bundled, so `@supabase/supabase-js` is still resolved by node at runtime and
 * there is nothing to keep in step with package.json.
 *
 * Type errors do NOT stop a run: esbuild strips types without checking them.
 * `npm run typecheck` is what checks them, and it covers scripts/ too.
 */

import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const entry = process.argv[2];
if (!entry) {
  console.error("usage: node --env-file=.env scripts/tsrun.mjs <entry.ts> [args…]");
  process.exit(2);
}

// Everything after the entry belongs to the script, not to this launcher.
process.argv = [process.argv[0], path.resolve(root, entry), ...process.argv.slice(3)];

// Inside node_modules rather than the OS temp directory: the bundle keeps its
// imports of `@supabase/supabase-js` and friends, and node resolves those by
// walking up from the importing file. From /tmp there is nothing to walk up to.
const cache = path.join(root, "node_modules", ".cache");
await mkdir(cache, { recursive: true });
const dir = await mkdtemp(path.join(cache, "nyuz-tsrun-"));
const outfile = path.join(dir, "entry.mjs");

try {
  await build({
    entryPoints: [path.resolve(root, entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    sourcemap: "inline",
    alias: { "@": path.join(root, "src") },
    logLevel: "warning",
  });

  await import(pathToFileURL(outfile).href);
} finally {
  // Removed on the way out rather than cached, so a stale bundle can never be the
  // reason a script behaves oddly.
  await rm(dir, { recursive: true, force: true });
}
