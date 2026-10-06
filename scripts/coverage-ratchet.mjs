/**
 * The coverage floor: measured now, compared against `.ci/baseline/coverage.json`,
 * failed if anything dropped.
 *
 *   npm run test:coverage      # writes coverage/coverage-summary.json
 *   npm run coverage:ratchet   # compares it; exits non-zero on a regression
 *   npm run coverage:ratchet -- --update --from <summary.json>   # record a floor
 *
 * `--update` refuses to lower anything. The floor moving down is always a
 * deliberate act, so it needs a second flag that says so:
 *
 *   npm run coverage:ratchet -- --update --allow-lower --from <summary.json>
 *
 * Without that, "the floor only rises" is a property of the tool rather than a
 * promise in a comment, and a hurried `--update` after a red build cannot erase
 * the evidence of what was lost.
 *
 * ---------------------------------------------------------------------------
 * Why a floor is only recorded from the runner (Audit 42)
 *
 * v8 reports the ranges it discovered while executing, so the measured universe
 * is not a property of the source alone: code that did not run is reported
 * narrower than code that did. Two machines running one commit therefore do not
 * measure the same numbers. Measured against the runner on the same tree, a
 * laptop disagreed on seven files, and disagreed about the denominator rather
 * than the count -- src/lib/pipeline/digest.ts reported 376 branch ranges there
 * and 372 here. The laptop is not reproducible against itself either: two
 * consecutive local runs of one commit moved a group by up to 0.16pp, while the
 * runner measured that commit identically three times, all 326 files.
 *
 * A floor is a promise the enforcer can keep, so it is recorded from the
 * enforcer. `--update` refuses a local measurement for that reason; download the
 * runner's own summary and record that (the summary is the `Keep the
 * measurement` artifact CI uploads on every run, green or red):
 *
 *   gh run download <run-id> -n coverage-summary -D /tmp/ci-coverage
 *   npm run coverage:ratchet -- --update --from /tmp/ci-coverage/coverage-summary.json
 *
 * Comparison keeps its teeth locally, with one difference: outside GitHub
 * Actions a shortfall inside PORTABILITY_BAND is reported as a warning rather
 * than a failure, because that is the width of the disagreement between two
 * machines rather than a regression. In CI the comparison is exact, and CI is
 * what gates the deploy.
 *
 * ---------------------------------------------------------------------------
 * Why a ratchet and not a threshold
 *
 * A threshold is a number somebody picked, and the honest number for a codebase
 * with 2744 tests over four months of work is whatever it actually measures. A
 * hand-picked 70% would either be unreachable and switched off within a week, or
 * already passed and therefore tell nobody anything. A ratchet asks a question
 * that is true on every commit instead: *did this change make the codebase less
 * tested than it was?*
 *
 * It also makes a new untested file a red diff rather than a silent one. Adding
 * `src/lib/newthing.ts` with no tests drops `src/lib` below its floor, and the
 * only way to make the run green is to test the thing or to raise the floor on
 * purpose with `--update`, in a commit whose diff says so.
 *
 * ---------------------------------------------------------------------------
 * Granularity, and why it is derived rather than listed
 *
 * The table is grouped by directory: `src/lib/pipeline`, `src/lib/ai`,
 * `src/lib/server`, `src/lib` for everything shallower than that, and the top
 * level of `src` for the rest. A hand-maintained list of directories goes stale
 * the first time somebody adds one; this derives the groups from the paths in
 * the coverage summary, so a brand-new directory appears in the table by itself
 * with a floor of zero.
 *
 * A directory with no entry in the baseline -- new, or measured for the first
 * time -- never fails on its first run. It is reported, and the next
 * `--update` records it. Failing there would mean a red build for adding a file
 * to a directory that did not exist yesterday, which is not a regression.
 *
 * ---------------------------------------------------------------------------
 * Why the totals are checked too
 *
 * Per-directory floors catch a directory getting weaker. They would not catch a
 * new directory with 0% coverage that is large enough to matter, because it has
 * no floor to fall from -- so the total is compared as well, and a project-wide
 * drop fails regardless of which directory caused it.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, isAbsolute, relative } from "node:path";

const SUMMARY = "coverage/coverage-summary.json";
const BASELINE = ".ci/baseline/coverage.json";
const METRICS = ["lines", "statements", "functions", "branches"];

/**
 * One ten-thousandth of a percentage point.
 *
 * The summary rounds to two decimals, so a re-run of identical code can differ
 * in the last digit. This tolerance is smaller than anything a real change
 * produces and stops the gate from failing on arithmetic noise.
 */
const TOLERANCE = 0.0001;

/**
 * Paths in the summary are absolute -- v8 reports the file the runner opened --
 * so the baseline would otherwise record `/home/someone/nyuz/src/...` and fail
 * on every machine but the one that wrote it. Both sides go through this, so
 * the file on disk stays portable.
 *
 * A summary measured on the runner is read from its artifact (Audit 42), and
 * there the prefix is `/home/runner/work/nyuz/nyuz`, which is not this
 * checkout's -- `relative` would return a `../..` path and every file would
 * land in one meaningless group, silently comparing nothing. Everything the
 * summary can contain lives under `src/`, so the path from there is the
 * portable form and the fallback is that.
 */
function relativeToRepo(file) {
  if (!isAbsolute(file)) return file;
  const withinCheckout = relative(process.cwd(), file);
  if (!withinCheckout.startsWith("..") && !isAbsolute(withinCheckout)) return withinCheckout;
  const underSrc = file.indexOf("/src/");
  return underSrc === -1 ? withinCheckout : file.slice(underSrc + 1);
}

function groupOf(file) {
  const parts = relativeToRepo(file).split("/");
  // `src/lib/pipeline/x.ts` -> `src/lib/pipeline`; `src/lib/x.ts` -> `src/lib`;
  // `src/routes/x.tsx` -> `src/routes`. Anything outside src/ is its own row.
  if (parts[0] !== "src") return parts.slice(0, Math.max(1, parts.length - 1)).join("/");
  if (parts.length >= 4) return parts.slice(0, 3).join("/");
  // `src/lib/x.ts` -> `src/lib`; a file sitting directly in `src`
  // (`src/server.ts`) -> `src`.
  return parts.length >= 3 ? parts.slice(0, 2).join("/") : "src";
}

/** Averages per-file percentages into one percentage per group. */
function groupTotals(summary) {
  const groups = new Map();
  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    const group = groupOf(file);
    const entry = groups.get(group) ?? {
      files: 0,
      lines: { covered: 0, total: 0 },
      statements: { covered: 0, total: 0 },
      functions: { covered: 0, total: 0 },
      branches: { covered: 0, total: 0 },
    };
    entry.files += 1;
    for (const metric of METRICS) {
      entry[metric].covered += data[metric].covered;
      entry[metric].total += data[metric].total;
    }
    groups.set(group, entry);
  }

  const out = {};
  for (const [group, entry] of groups) {
    out[group] = { files: entry.files };
    for (const metric of METRICS) {
      const { covered, total } = entry[metric];
      out[group][metric] = total === 0 ? 100 : round((covered / total) * 100);
    }
  }
  return out;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function totalsOf(summary) {
  const total = summary.total;
  const out = {};
  for (const metric of METRICS) {
    out[metric] = total[metric].total === 0 ? 100 : round(total[metric].pct);
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The measurement. Missing means the caller skipped the measuring step. */
function readSummary(path) {
  try {
    return readJson(path);
  } catch (error) {
    console.error(
      `Cannot read ${path}: ${error.message}\n` +
        "Run `npm run test:coverage` first -- the ratchet compares a measurement, it does not take one.",
    );
    process.exit(2);
  }
}

/** `--from <file>`: record a summary measured elsewhere, rather than this run's. */
function flag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${name} needs a file to read.`);
    process.exit(2);
  }
  return value;
}

/**
 * How far below the floor a *local* run may sit before it is a failure.
 *
 * Sized by Audit 42's measurements rather than chosen: two consecutive local
 * runs of one commit differed on one file, and because the disagreement was the
 * branch denominator rather than the count -- src/lib/discovery/feed.ts came
 * back with 64 branch ranges and then 63 -- it moved that group by 0.223pp.
 * Local against the runner added up to 0.10pp on a group in the same direction.
 * 0.35pp covers the sum with a little room, and it is a quarter of the width a
 * real regression produces: removing a test file or adding an untested module
 * moves a group by half a point and up. CI never applies it.
 */
const PORTABILITY_BAND = 0.35;

/** GitHub sets this in every job; a laptop never has it. */
const runningInCi = process.env["GITHUB_ACTIONS"] === "true";

/** The floor. Missing is expected exactly once, on the run that creates it. */
function readBaselineOrEmpty() {
  try {
    return readJson(BASELINE);
  } catch {
    return null;
  }
}

const update = process.argv.includes("--update");
const allowLower = process.argv.includes("--allow-lower");
const fromPath = flag("--from");

/**
 * The floor is recorded from the environment that enforces it. A local
 * measurement is refused because it is not reproducible -- see the header.
 * Checked before the summary is read, so the refusal is the message the caller
 * needs rather than a missing-file error from a run that was never allowed.
 */
if (update && !fromPath && !runningInCi) {
  console.error(
    "Refusing to record the floor from this machine's measurement.\n\n" +
      "v8's reported universe depends on what executed, so a local run and the\n" +
      "runner disagree on the same commit and a local run disagrees with itself.\n" +
      "Download the runner's summary and record that:\n\n" +
      "  gh run download <run-id> -n coverage-summary -D /tmp/ci-coverage\n" +
      "  npm run coverage:ratchet -- --update --from /tmp/ci-coverage/coverage-summary.json\n\n" +
      "Check out the commit the run measured first, so `measuredAtCommit` names\n" +
      "the tree the floor is a floor for.\n",
  );
  process.exit(2);
}

const summary = readSummary(fromPath ?? SUMMARY);
const measured = { directories: groupTotals(summary), total: totalsOf(summary) };

if (update) {
  const previous = readBaselineOrEmpty();

  /**
   * Every metric that would go down, so `--update` can refuse before writing.
   *
   * This is the whole reason the tool is trusted: if the flag that records a
   * measurement could quietly record a smaller one, the floor would be a
   * suggestion and a red build would be one command away from green.
   */
  if (previous && !allowLower) {
    const lowered = [];
    for (const [group, values] of Object.entries(measured.directories)) {
      const floor = previous.directories?.[group];
      if (!floor) continue;
      for (const metric of METRICS) {
        if (values[metric] + TOLERANCE < floor[metric]) {
          lowered.push(
            `${group}: ${metric} ${floor[metric].toFixed(2)} -> ${values[metric].toFixed(2)}`,
          );
        }
      }
    }
    for (const metric of METRICS) {
      if (measured.total[metric] + TOLERANCE < previous.total[metric]) {
        lowered.push(
          `total: ${metric} ${previous.total[metric].toFixed(2)} -> ${measured.total[metric].toFixed(2)}`,
        );
      }
    }
    if (lowered.length > 0) {
      console.error("Refusing to lower the floor:\n");
      for (const line of lowered) console.error(`  ${line}`);
      console.error(
        "\nThe floor is a promise about what the suite covers. If this drop is the right\n" +
          "call, say so explicitly: npm run coverage:ratchet -- --update --allow-lower\n" +
          "and put the reason in the commit message.",
      );
      process.exit(1);
    }
  }
  const baseline = {
    measuredAt: new Date().toISOString().slice(0, 10),
    measuredAtCommit: commitAtRecord(),
    // Where the numbers came from, so a later reader can tell a floor taken on
    // the runner from one imported from an artifact by hand.
    measuredIn: runningInCi ? "github-actions" : "external-measurement",
    note:
      "The floor for `npm run coverage:ratchet`. Raise it with " +
      "`npm run coverage:ratchet -- --update` in the commit that adds the tests, " +
      "never by hand.\n" +
      "`measuredAtCommit` is the commit the measurement was taken at, so a later\n" +
      "drop can be attributed to a change rather than guessed at. Read it before\n" +
      "blaming the change under review.",
    directories: measured.directories,
    total: measured.total,
  };
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(
    `Wrote ${BASELINE}${previous ? " (replaced an existing floor)" : ""}` +
      `${baseline.measuredAtCommit ? ` at ${baseline.measuredAtCommit}` : ""}.`,
  );
  process.exit(0);
}

/**
 * The commit the floor was measured at.
 *
 * `GITHUB_SHA` alone is not enough, and reading only that is a real trap: it is
 * unset on a laptop, so every local `--update` recorded `null` and the baseline
 * could not say what it was a floor *for*. A floor with no commit attached cannot
 * be told apart from a floor that drifted because the source underneath it
 * moved — which is exactly the confusion this field exists to prevent.
 *
 * Falls back to git so a local measurement is attributable too.
 */
function commitAtRecord() {
  const fromEnv = process.env["GITHUB_SHA"];
  if (fromEnv) return fromEnv.slice(0, 8);
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .slice(0, 8);
  } catch {
    // A tarball with no git, or a shallow environment. Better a recorded null
    // than a floor that cannot be written at all.
    return null;
  }
}

const baseline = readBaselineOrEmpty();
if (!baseline) {
  console.error(
    `No floor at ${BASELINE}.\n` +
      "Create it deliberately with `npm run coverage:ratchet -- --update`, in its own commit,\n" +
      "so the number it records is reviewable.",
  );
  process.exit(2);
}

const regressions = [];
const portabilityWarnings = [];

function compare(scope, metric, now, floor) {
  if (floor === undefined || floor === null) return;
  const gap = floor - now;
  if (gap <= TOLERANCE) return;
  // In CI the floor came from this same environment, so any gap is a
  // regression. Off it, the floor came from the runner and a small gap is the
  // width of the disagreement between two machines.
  const entry = { scope, metric, now, floor, delta: round(now - floor) };
  if (gap <= PORTABILITY_BAND + TOLERANCE && !runningInCi) portabilityWarnings.push(entry);
  else regressions.push(entry);
}

for (const [group, values] of Object.entries(measured.directories)) {
  const floor = baseline.directories?.[group];
  if (!floor) continue;
  for (const metric of METRICS) compare(group, metric, values[metric], floor[metric]);
}
for (const metric of METRICS)
  compare("total", metric, measured.total[metric], baseline.total?.[metric]);

/** A wide, aligned table so the numbers are readable in a log and a summary. */
function table() {
  const rows = [];
  const groups = [
    ...new Set([...Object.keys(measured.directories), ...Object.keys(baseline.directories ?? {})]),
  ].sort();
  for (const group of groups) {
    const now = measured.directories[group];
    const floor = baseline.directories?.[group];
    if (!now) {
      rows.push([group, "gone", "", "", "", ""]);
      continue;
    }
    rows.push([
      group,
      String(now.files),
      ...METRICS.map((metric) => {
        const value = now[metric].toFixed(2);
        const before = floor?.[metric];
        if (before === undefined) return `${value} (new)`;
        const delta = now[metric] - before;
        return delta < -TOLERANCE
          ? `${value} (${delta.toFixed(2)})`
          : `${value} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`;
      }),
    ]);
  }
  rows.push([
    "total",
    "",
    ...METRICS.map((metric) => {
      const value = measured.total[metric].toFixed(2);
      const before = baseline.total?.[metric];
      if (before === undefined) return `${value} (new)`;
      const delta = measured.total[metric] - before;
      return `${value} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`;
    }),
  ]);
  const header = ["scope", "files", ...METRICS];
  const all = [header, ...rows];
  const widths = header.map((_, index) => Math.max(...all.map((row) => (row[index] ?? "").length)));
  return all
    .map((row, index) =>
      index === 1
        ? `${header.map((_, i) => "-".repeat(widths[i])).join("  ")}`
        : row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join("  "),
    )
    .join("\n");
}

const rendered = table();
console.log(`Coverage against the floor in ${BASELINE}:\n\n${rendered}\n`);

const stepSummary = process.env["GITHUB_STEP_SUMMARY"];
if (stepSummary) {
  writeFileSync(
    stepSummary,
    [
      "### Coverage floor",
      "",
      "```",
      rendered,
      "```",
      "",
      "A number in brackets is the change from the committed floor.",
      "The floor is recorded from the runner: `gh run download <run-id> -n coverage-summary`, then",
      "`npm run coverage:ratchet -- --update --from <summary.json>`. See the Audit 42 note in scripts/coverage-ratchet.mjs.",
      "",
    ].join("\n"),
    { flag: "a" },
  );
}

if (regressions.length > 0) {
  console.error("Coverage went backwards:\n");
  for (const r of regressions) {
    console.error(`  ${r.scope}: ${r.metric} ${r.floor.toFixed(2)} -> ${r.now.toFixed(2)}`);
  }
  console.error(
    "\nNothing here is a target. Either cover what this change added, or raise the floor\n" +
      "deliberately with `npm run coverage:ratchet -- --update` and say why in the commit.",
  );
  process.exit(1);
}

if (portabilityWarnings.length > 0) {
  // Reported, never silent: a reader should know the local run sits under the
  // runner's floor and by how much, even when the gap is machine disagreement.
  console.log(
    `Within the ${PORTABILITY_BAND}pp portability band (this machine against the runner):\n`,
  );
  for (const w of portabilityWarnings) {
    console.log(
      `  ${w.scope}: ${w.metric} ${w.floor.toFixed(2)} -> ${w.now.toFixed(2)} (${w.delta.toFixed(2)})`,
    );
  }
  console.log("");
}

console.log("No regression against the committed floor.");
