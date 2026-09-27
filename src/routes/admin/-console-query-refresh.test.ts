import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Which cached queries each console mutation refreshes.
 *
 * `useConsoleMutation(fn, keys)` invalidates `keys` on success, and a wrong key
 * fails silently: the save works, the audit row is written, and the page keeps
 * showing the old number until the query goes stale on its own. Nothing in the
 * types or the build notices — a key is just an array. So this reads the
 * source with the TypeScript parser and checks the two ways that goes wrong:
 * a key that matches no query at all, and a mutation that stops refreshing a
 * view drawn from what it changed.
 */

type Key = string[];

const CONSOLE_DIRS = ["src/routes/admin", "src/components/admin"];

function sourceFiles(dirs: string[]): string[] {
  return dirs.flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
      .map((name) => join(dir, name).replaceAll("\\", "/")),
  );
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/**
 * A key as comparable text: string literals by value, anything else as its
 * source (`days`, `String(days)`). Comparing source text is what catches a key
 * that names the right query with the wrong value type — `String(days)` never
 * matches a query keyed on the number `days`.
 */
function keyOf(array: ts.ArrayLiteralExpression, source: ts.SourceFile): Key {
  return array.elements.map((element) =>
    ts.isStringLiteral(element) ? element.text : `\${${element.getText(source)}}`,
  );
}

/** An array literal, or the array literal a same-file const was initialised with. */
function arrayOf(expression: ts.Expression, source: ts.SourceFile): ts.ArrayLiteralExpression {
  let node: ts.Expression = expression;
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isArrayLiteralExpression(node)) return node;
  if (ts.isIdentifier(node)) {
    const name = node.text;
    let found: ts.ArrayLiteralExpression | null = null;
    walk(source, (candidate) => {
      if (
        ts.isVariableDeclaration(candidate) &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === name &&
        candidate.initializer
      ) {
        found = arrayOf(candidate.initializer, source);
      }
    });
    if (found) return found;
  }
  throw new Error(`${source.fileName}: cannot resolve "${expression.getText(source)}" to an array`);
}

type Mutation = { file: string; fn: string; keys: Key[] };

function mutationsIn(file: string): Mutation[] {
  const source = parse(file);
  const found: Mutation[] = [];
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useConsoleMutation"
    ) {
      const [fn, keys] = node.arguments;
      if (!fn || !keys) throw new Error(`${file}: useConsoleMutation needs (fn, keys)`);
      found.push({
        file,
        fn: fn.getText(source),
        keys: arrayOf(keys, source).elements.map((element) =>
          keyOf(arrayOf(element, source), source),
        ),
      });
    }
  });
  return found;
}

function queryKeysIn(file: string): Key[] {
  const source = parse(file);
  const found: Key[] = [];
  walk(source, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "queryKey" &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found.push(keyOf(node.initializer, source));
    }
  });
  return found;
}

const FILES = sourceFiles(CONSOLE_DIRS);
const MUTATIONS = FILES.flatMap(mutationsIn);
// Readers come from the whole app: a console action may rightly refresh a
// query a reader-facing page owns.
const QUERY_KEYS = sourceFiles(["src"]).flatMap(queryKeysIn);

/** React Query's partial match: every segment of the prefix, in order. */
function isPrefix(prefix: Key, key: Key): boolean {
  return prefix.length <= key.length && prefix.every((segment, i) => segment === key[i]);
}

const show = (key: Key) => key.join("/");

/** One file's mutations as `fn -> sorted keys`, failing on a duplicate fn. */
function refreshesIn(file: string): Record<string, string[]> {
  const table: Record<string, string[]> = {};
  for (const mutation of MUTATIONS.filter((m) => m.file === file)) {
    if (mutation.fn in table) throw new Error(`${file}: ${mutation.fn} is used twice`);
    table[mutation.fn] = mutation.keys.map(show).sort();
  }
  return table;
}

describe("console query refresh", () => {
  it("finds the mutations and queries it is meant to check", () => {
    // Guards everything below against passing vacuously if the parser stops
    // matching — an empty list satisfies every "each of" assertion.
    expect(MUTATIONS.length).toBeGreaterThan(20);
    expect(QUERY_KEYS.length).toBeGreaterThan(20);
  });

  it("every refreshed key matches a query the app actually reads", () => {
    const dead = MUTATIONS.flatMap(({ file, fn, keys }) =>
      keys
        .filter((key) => !QUERY_KEYS.some((query) => isPrefix(key, query)))
        .map((key) => `${file}: ${fn} refreshes ${show(key)}, which no query uses`),
    );
    expect(dead).toEqual([]);
  });
});

/**
 * The AI console's refresh lists, pinned exactly.
 *
 * Exact on purpose: the file-level check above proves a key is real, not that
 * it is the right one, and the AI tabs share state — a cap changed on Limits is
 * drawn on Status, Spend and in the sidebar. Changing a list here should be a
 * decision someone made, not a side effect of moving code between files.
 */
const PINNED: Record<string, Record<string, string[]>> = {
  "src/routes/admin/ai/limits.tsx": {
    // Caps are drawn by Status (gauges + forecast), Spend and the sidebar card;
    // the kill switch also shows in Spend's feature flags (admin/cost).
    saveAiRuntimeSettings: ["admin/ai-runtime", "admin/ai-spend", "admin/ai-status", "admin/cost"],
    // Reset cannot touch the kill switch, so admin/cost is not needed.
    resetAiRuntimeSetting: ["admin/ai-runtime", "admin/ai-spend", "admin/ai-status"],
  },
  "src/routes/admin/ai/spend.tsx": {
    // Credit is drawn on Spend and, via ai-status, on Status and the sidebar.
    addAiTopup: ["admin/ai-credit", "admin/ai-status", "admin/ai-topups"],
    deleteAiTopup: ["admin/ai-credit", "admin/ai-status", "admin/ai-topups"],
  },
  "src/routes/admin/ai/providers.tsx": {
    setRoute: ["admin/ai"],
    saveProvider: ["admin/ai"],
    deleteProvider: ["admin/ai"],
    savePrompt: ["admin/ai"],
    // A probe reads a provider and changes nothing.
    probeProvider: [],
  },
  "src/routes/admin/ai/index.tsx": {},
  "src/routes/admin/ai.tsx": {},
  "src/routes/admin/economics.tsx": {
    syncCloudflareBillableUsage: ["admin/economics-manual", "admin/economics/${days}"],
    syncSupabaseUsage: ["admin/economics/${days}"],
    addEconomicsManualCost: ["admin/economics", "admin/economics-manual"],
    // Moved from the old AI cost page with unit economics.
    saveOperatingCosts: ["admin/unit-economics"],
  },
};

describe("AI console refresh lists", () => {
  it("covers every file in the AI hub", () => {
    const hub = FILES.filter(
      (file) =>
        (file.startsWith("src/routes/admin/ai/") || file === "src/routes/admin/ai.tsx") &&
        !file.includes("/-"),
    );
    expect(hub.sort()).toEqual(
      Object.keys(PINNED)
        .filter((file) => file.startsWith("src/routes/admin/ai"))
        .sort(),
    );
  });

  for (const [file, expected] of Object.entries(PINNED)) {
    it(`${file} refreshes exactly the pinned queries`, () => {
      const sorted = Object.fromEntries(
        Object.entries(expected).map(([fn, keys]) => [fn, [...keys].sort()]),
      );
      expect(refreshesIn(file)).toEqual(sorted);
    });
  }
});
