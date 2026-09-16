import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.[cm]?tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")
        ? [join(dir, e.name)]
        : [],
  );
}
describe("only shared stories and explicit admin tests may invoke providers", () => {
  it("keeps provider imports confined to the approved boundary across application and scripts", () => {
    const allowed = new Set([
      "src/lib/ai/config.ts",
      "src/lib/ai/deepseek.ts",
      "src/lib/server/understanding.ts",
      "src/lib/server/ai-config.ts",
    ]);
    const violations: string[] = [];
    for (const file of [...files("src"), ...files("scripts")]) {
      if (file.includes("test-support") || file === "src/test-setup.ts") continue;
      const parsed = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        if (
          ts.isImportDeclaration(node) &&
          !node.importClause?.isTypeOnly &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const target = node.moduleSpecifier.text;
          const names = node.importClause?.namedBindings;
          const importsProvider =
            target === "openai" ||
            target.endsWith("/ai/deepseek") ||
            target === "./deepseek" ||
            (names &&
              ts.isNamedImports(names) &&
              names.elements.some(
                (e) =>
                  !e.isTypeOnly &&
                  /^(complete|completeJson|completeRouted|completeRoutedJson|meterProviderProbe|providerFetch|realProviderFetch)$/.test(
                    (e.propertyName ?? e.name).text,
                  ),
              ));
          if (importsProvider && !allowed.has(file)) violations.push(file + ": " + target);
        }
        if (
          ts.isStringLiteral(node) &&
          /chat\/completions|api\.(?:deepseek|openai)\.com/.test(node.text) &&
          !allowed.has(file) &&
          file !== "src/lib/ai/transport.ts" &&
          file !== "src/lib/ai/credit.ts"
        ) {
          // Configuration URLs are allowed; hand-written completion transports are not.
          if (node.text.includes("chat/completions")) violations.push(file + ": direct transport");
        }
        ts.forEachChild(node, visit);
      }
      visit(parsed);
    }
    expect(violations).toEqual([]);
  });
  it("metadata, prefetch, onboarding and dashboard handlers cannot initiate generation", () => {
    const source = readFileSync("src/lib/server/briefing.ts", "utf8");
    const generation = source.slice(
      source.indexOf("export const generateStory"),
      source.indexOf("async function understandOnDemandEnabled"),
    );
    expect(generation).toContain("signedInOnly");
    expect(generation).toContain("z.literal(true)");
    expect(generation).toContain("storyVisible");
    expect(source.replace(generation, "")).not.toMatch(/await ensureUnderstanding\s*\(/);
    expect(
      source.slice(
        source.indexOf("export const loadStory"),
        source.indexOf("export const generateStory"),
      ),
    ).not.toContain("await ensureUnderstanding");
  });
});
