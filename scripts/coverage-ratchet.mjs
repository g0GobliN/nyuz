/**
 * The coverage floor: measured now, compared against `.ci/baseline/coverage.json`,
 * failed if anything dropped.
 *
 *   npm run test:coverage      # writes coverage/coverage-summary.json
 *   npm run coverage:ratchet   # compares it; exits non-zero on a regression
 *   npm run coverage:ratchet -- --update   # raises the floor to what was measured
 *
 * `--update` refuses to lower anything. The floor moving down is always a
 * deliberate act, so it needs a second flag that says so:
 *
 *   npm run coverage:ratchet -- --update --allow-lower
 *
 * Without that, "the floor only rises" is a property of the tool rather than a
 * promise in a comment, and a hurried `--update` after a red build cannot erase
 * the evidence of what was lost.
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
 */
function relativeToRepo(file) {
  return isAbsolute(file) ? relative(process.cwd(), file) : file;
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
function readSummary() {
  try {
    return readJson(SUMMARY);
  } catch (error) {
    console.error(
      `Cannot read ${SUMMARY}: ${error.message}\n` +
        "Run `npm run test:coverage` first -- the ratchet compares a measurement, it does not take one.",
    );
    process.exit(2);
  }
}

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
const summary = readSummary();
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

function compare(scope, metric, now, floor) {
  if (floor === undefined || floor === null) return;
  if (now + TOLERANCE < floor) {
    regressions.push({ scope, metric, now, floor, delta: round(now - floor) });
  }
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
      "`npm run coverage:ratchet -- --update` raises it, in the commit that adds the tests.",
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

console.log("No regression against the committed floor.");
