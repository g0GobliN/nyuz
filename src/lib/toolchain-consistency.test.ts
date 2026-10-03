/**
 * The Node version and the wrangler version each have four homes, and they have
 * to agree.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * `engines.node` is what a developer's package manager warns about.
 * `.nvmrc` is what `nvm` reads. `node-version` in a workflow is what CI runs.
 * The `wrangler` devDependency is the local binary, and `wranglerVersion` on the
 * deploy action is the one that runs in production.
 *
 * Those are five declarations of two facts, and nothing but a human comparing
 * them kept them aligned. The consequences are not theoretical in this
 * repository:
 *
 * - Node 20 satisfies nothing here and `wrangler dev` *refuses to start* on it,
 *   so a contributor on the wrong major discovers it only when the browser suite
 *   cannot boot. The CI that would have told them is the thing they never ran.
 * - The build stamps `compatibility_date` as the day it ran. A wrangler whose
 *   local runtime predates that date produces an artifact that can be *deployed
 *   but not previewed*, and therefore cannot be tested — which is how 4.126.0
 *   got here and had to be bumped to 4.147.0. When the deploy job's version and
 *   the devDependency's version differ, the browser suite previews the built
 *   output under a *different runtime than the one that published it*, and the
 *   suite becomes a weaker proof than it looks while still reporting green.
 *
 * So this file asserts the facts are one fact. It is deliberately boring: it
 * reads four small files and compares strings. Its value is entirely in failing
 * on the first commit where somebody bumps one of the five and forgets another.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does not do
 *
 * It does not check that the pinned version is the *latest* one. That is a
 * deliberate upgrade, made in a pull request with a changelog read, and a test
 * that fails on every wrangler release trains people to ignore the file. It
 * checks that all five declarations agree, which is the thing that silently
 * rots.
 *
 * It is a source test, so it runs on a laptop as part of `npm run test` and not
 * only in CI.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PKG = JSON.parse(readFileSync("package.json", "utf8")) as {
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
};
const NVMRC = readFileSync(".nvmrc", "utf8").trim();
const CI = readFileSync(".github/workflows/ci.yml", "utf8");
const HEALTH = readFileSync(".github/workflows/health.yml", "utf8");
const WORKFLOWS: Record<string, string> = { "ci.yml": CI, "health.yml": HEALTH };

/** Every `node-version:` in both workflows, with the job it belongs to. */
function declaredNodeVersions(
  workflow: string,
  source: string,
): { job: string; version: string }[] {
  const found: { job: string; version: string }[] = [];
  let job = "unknown";
  for (const line of source.split("\n")) {
    const jobLine = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (jobLine?.[1]) job = jobLine[1];
    const version = /^\s+node-version:\s*"?([^"\s]+)"?\s*$/.exec(line);
    if (version?.[1]) found.push({ job, version: version[1] });
  }
  return found;
}

describe("every job runs the Node version the project declares", () => {
  it("declares a Node version at all", () => {
    expect(NVMRC, ".nvmrc names a Node version").not.toBe("");
    expect(PKG.engines?.node, "package.json declares engines.node").toBeTruthy();
  });

  it("uses the same major in .nvmrc and every workflow", () => {
    const declared = declaredNodeVersions("", NVMRC ? `  v:\n    node-version: ${NVMRC}` : "");
    expect(declared[0]?.version, ".nvmrc reads as a version").toBeTruthy();
    const major = declared[0]?.version;

    const inWorkflows = Object.entries(WORKFLOWS).flatMap(([file, source]) =>
      declaredNodeVersions(file, source).map((entry) => ({ ...entry, file })),
    );

    expect(inWorkflows.length, "at least one job pins a Node version").toBeGreaterThan(0);
    const wrong = inWorkflows.filter((entry) => entry.version !== major);
    expect(
      wrong.map((entry) => `${entry.file} job ${entry.job}: node-version ${entry.version}`),
      `.nvmrc says ${major}. A job on a different major can either refuse to start (wrangler dev on Node 20) or pass where the laptop would fail.`,
    ).toEqual([]);
  });

  it("has an engines range that admits the pinned version", () => {
    const range = PKG.engines?.node ?? "";
    const major = Number.parseInt(NVMRC, 10);
    expect(Number.isNaN(major), `.nvmrc is a number, not "${NVMRC}"`).toBe(false);

    // Handles the two forms this repo could plausibly hold — `>=22` and `^22` —
    // and refuses anything it does not understand rather than assuming it passes.
    const floor = /^>=\s*(\d+)$/.exec(range);
    const caret = /^\^(\d+)$/.exec(range);
    if (floor?.[1] !== undefined) {
      expect(
        major,
        `engines.node "${range}" must admit Node ${major} in .nvmrc`,
      ).toBeGreaterThanOrEqual(Number.parseInt(floor[1], 10));
    } else if (caret?.[1] !== undefined) {
      expect(major, `engines.node "${range}" must admit Node ${major} in .nvmrc`).toBe(
        Number.parseInt(caret[1], 10),
      );
    } else {
      throw new Error(
        `engines.node is "${range}", which this test cannot compare against .nvmrc. Widen the test or simplify the range — do not delete the assertion.`,
      );
    }
  });
});

describe("the deploy runs the wrangler the browser suite previews with", () => {
  it("pins wrangler exactly, not with a range", () => {
    const range = PKG.devDependencies?.["wrangler"];
    expect(range, "wrangler is a devDependency").toBeTruthy();
    // A caret here would let `npm ci` install something other than the version the
    // deploy job runs, which is precisely the drift this file exists to prevent.
    expect(range, "the wrangler devDependency is an exact version").toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("matches the version the deploy action installs", () => {
    const actionVersion = /wranglerVersion:\s*"?([^"\s]+)"?/.exec(CI)?.[1];
    expect(actionVersion, "ci.yml names the wrangler version the deploy action uses").toBeTruthy();

    expect(
      actionVersion,
      "package.json pins the wrangler the e2e job previews the build with; ci.yml deploys with a different one",
    ).toBe(PKG.devDependencies?.["wrangler"]);
  });

  it("keeps the local runtime new enough to preview the build it produces", () => {
    // The build stamps `compatibility_date` as the day it ran, so a wrangler
    // older than that date cannot run the artifact locally. This is the check
    // that would have caught 4.126.0 before it made the e2e suite impossible to
    // run on the day the build happened. The threshold is deliberately
    // conservative rather than derived from the package, because the version
    // that matters is the one workerd reports, and that is not in package.json.
    const version = PKG.devDependencies?.["wrangler"] ?? "0.0.0";
    const [major = 0, minor = 0, patch = 0] = version
      .split(".")
      .map((part) => Number.parseInt(part, 10));
    const current = [major, minor, patch];
    const floor = [4, 147, 0];
    const atLeastFloor =
      current[0]! > floor[0]! ||
      (current[0] === floor[0]! &&
        (current[1]! > floor[1]! || (current[1] === floor[1]! && current[2]! >= floor[2]!)));
    expect(
      atLeastFloor,
      `wrangler ${version} predates ${floor.join(".")}, whose local runtime knows this month's compatibility_date. Raising it is a two-line change: package.json and wranglerVersion in ci.yml.`,
    ).toBe(true);
  });
});

describe("the pinned actions are pinned", () => {
  // This is not about versions — a pinned action cannot be upgraded silently by
  // its owner moving a tag, and the deploy job hands whatever the SHA resolves to
  // a Cloudflare API token that can rewrite the live Worker.
  it("uses a commit SHA rather than a tag for every action", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(WORKFLOWS)) {
      for (const line of source.split("\n")) {
        const use = /^\s*-?\s*uses:\s*(\S+)/.exec(line);
        if (!use?.[1]) continue;
        const ref = use[1];
        if (ref.includes("@")) continue; // a Docker image or a local action
        offenders.push(`${file}: uses: ${ref}`);
      }
    }
    expect(
      offenders,
      "a floating tag is a mutable pointer to code that runs with your credentials",
    ).toEqual([]);
  });

  it("annotates every pinned SHA with the version it belongs to", () => {
    // Without the comment, the next person cannot tell whether a SHA is current
    // or four releases behind, and Dependabot cannot propose the bump.
    const missing: string[] = [];
    for (const [file, source] of Object.entries(WORKFLOWS)) {
      for (const line of source.split("\n")) {
        const use = /uses:\s*\S+@([0-9a-f]{40})\s*$/.exec(line);
        if (use && !line.includes("# v")) missing.push(`${file}: ${line.trim()}`);
      }
    }
    expect(
      missing,
      "a pinned SHA with no version comment cannot be reviewed for staleness",
    ).toEqual([]);
  });
});
