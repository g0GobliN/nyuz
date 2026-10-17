import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Build output, plus the two scratch directories. `tmp/` and `.scratch/` are
  // gitignored (see .gitignore) and hold investigation scripts that are never
  // reviewed, committed, or shipped -- but `eslint .` walks them anyway, so one
  // leftover probe turned `npm run ci` red with 51 formatting errors in files
  // outside the diff. That is a red gate that names the wrong cause: the person
  // reading it goes looking for a code defect instead of this file. Anything
  // under these paths is throwaway by definition, so it is ignored by pattern
  // rather than by remembering to delete it. The Playwright artifacts belong
  // here for the same reason: a killed `npm run e2e` leaves minified bundles in
  // `test-results/`, and the next `npm run ci` then reports 88 Prettier errors in
  // files nobody wrote. Generated, gitignored, never reviewed -- ignored.
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "tmp/**",
      ".scratch/**",
      "test-results/**",
      "playwright-report/**",
      "blob-report/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
