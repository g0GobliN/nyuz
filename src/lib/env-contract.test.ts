/**
 * Every environment variable the code reads must be documented, and the
 * documentation must be in the file a developer copies.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * `.env.example` is the only place a variable is described, and nothing checked
 * that the description matched the code. The deploy job checks that the four
 * `VITE_` build-time variables are *set*; it cannot check that the thirty others
 * the Worker reads at runtime were ever written down anywhere, because a missing
 * name is not an error at build time. It fails on the Worker at three in the
 * morning, in whichever stage read it first, as `undefined` where a URL or a key
 * was expected.
 *
 * The failure this catches is small and constant. `VAPID_PUBLIC_KEY` is read as a
 * fallback for `VITE_VAPID_PUBLIC_KEY` and was undocumented; `SAMPLE` sizes a
 * sample in one audit script and was undocumented. Neither is a typo, and both
 * are the shape of thing a new contributor cannot configure.
 *
 * ---------------------------------------------------------------------------
 * What it does not catch, stated plainly
 *
 * A name composed at runtime is invisible to a scan. This codebase has two
 * shapes of that, and they cannot be told apart by looking at the string:
 * `` `MODEL_${capability}` `` in src/lib/ai/config.ts is read from the
 * environment, and `` `AI_THINKING_${operation}` `` in
 * src/lib/ai/request-policy.ts is a row in `ai_runtime_config` in the database.
 * A rule that flagged every composed prefix would flag the second kind too, so
 * there is no such rule here. What catches a `MODEL_` name going missing is that
 * `.env.example` documents three of them and the deploy job fails loudly when the
 * resolved route has no key at all.
 *
 * It is a source test, so it runs in `npm run test` on a laptop as well as in CI.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "scripts"];

/**
 * Names that are read but deliberately not in `.env.example`.
 *
 * Every entry carries its reason, because the point of an allowlist is that
 * adding to it is a decision someone can review later. A name whose reason is
 * "it should be documented" belongs in `.env.example` instead.
 */
const ALLOWLIST = new Map<string, string>([
  // Set by src/test-setup.ts for the fake provider transport. No environment
  // anywhere supplies it, and it holds the literal "test-only".
  ["OPENAI_API_KEY", "test fixture value, set in src/test-setup.ts"],
  ["NYUZ_TEST_ONLY", "name used by runtime-env.test.ts to prove Worker bindings win"],
  // Sizes the sample one audit script takes. An operator knob for a one-off
  // report, not part of running the app, so it stays out of the app's example.
  ["SAMPLE", "operator knob for scripts/cluster-audit.ts, default 400"],
]);

/** Directories that hold nothing but tests and setup. */
function files(root: string, found: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files(path, found);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) found.push(path);
  }
  return found;
}

/** Every source file, minus the tests themselves. */
function sources(): string[] {
  return ROOTS.flatMap((root) => files(root)).filter((path) => !/\.test\.[cm]?[jt]sx?$/.test(path));
}

/**
 * The four ways this codebase reads a variable.
 *
 * `envValue` and `ambientEnv` are src/lib/runtime-env.ts, which exists because
 * on Cloudflare the bindings arrive as `globalThis.__env__` and a bare
 * `process.env` reads nothing at all (runtime-env.test.ts holds that down).
 * Reading `process.env` directly still appears in a few places, so all four are
 * scanned rather than only the tidy one.
 */
const READS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /envValue\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/g,
  /ambientEnv\(\)\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
];

/**
 * Variables the *platform* provides, not configuration anybody writes down.
 *
 * `import.meta.env.DEV` and `.PROD` are Vite's; the `GITHUB_*` names are the
 * runner's, read by scripts/coverage-ratchet.mjs to record which commit a floor
 * was measured at and to write the job summary. Documenting these in
 * `.env.example` would tell a developer to set something that only exists inside
 * a CI job, which is worse than saying nothing.
 */
const NOT_CONFIGURATION = new Set([
  "DEV",
  "PROD",
  "CI",
  "GITHUB_ACTIONS",
  "GITHUB_SHA",
  "GITHUB_STEP_SUMMARY",
  "GITHUB_REF_NAME",
]);

function readNames(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const path of sources()) {
    const text = readFileSync(path, "utf8");
    for (const pattern of READS) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1];
        if (!name || NOT_CONFIGURATION.has(name)) continue;
        const holders = found.get(name) ?? [];
        holders.push(path);
        found.set(name, holders);
      }
    }
  }
  return found;
}

/**
 * Documented names.
 *
 * A commented line counts: `# TELEGRAM_BOT_USERNAME=` is how an *optional*
 * variable is described, and treating it as undocumented would push every
 * optional variable into the file uncommented, which is worse -- an operator
 * cannot tell from an empty `NAME=` whether the app needs it or not.
 */
function documented(): Set<string> {
  const names = new Set<string>();
  for (const line of readFileSync(".env.example", "utf8").split("\n")) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)/.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

describe("the environment contract", () => {
  it("documents every variable the code reads", () => {
    const example = documented();
    const missing: string[] = [];
    for (const [name, holders] of readNames()) {
      if (example.has(name) || ALLOWLIST.has(name)) continue;
      missing.push(`${name} (${holders.slice(0, 3).join(", ")})`);
    }
    expect(missing, "read by the code but absent from .env.example").toEqual([]);
  });

  it("keeps every allowlisted name justified", () => {
    // An allowlist is a promise that each entry has a reason. An empty one grows
    // a fourth thing in it within a year.
    for (const [name, reason] of ALLOWLIST) {
      expect(reason, `${name} needs a stated reason`).toMatch(/\w/);
    }
  });

  it("has an example file to check against", () => {
    // The whole suite passes vacuously without it, which is the one outcome
    // worse than a failure.
    expect(documented().size).toBeGreaterThan(20);
  });
});
