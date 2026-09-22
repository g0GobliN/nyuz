import { afterEach, describe, expect, it, vi } from "vitest";

import { SHELL_INIT_SCRIPT, STANDALONE_ATTRIBUTE } from "@/lib/display-mode";
import { APP_CHROME_COLOR, THEME_COLORS, THEME_INIT_SCRIPT, themeColorFor } from "@/lib/theme";

/**
 * The colour of the browser chrome, and the two head scripts that decide it.
 *
 * The interesting case is not the theme — it is the window. Android paints the
 * status bar from `theme-color`, and an installed Nyuz paints an ink top bar
 * directly beneath it in both themes, so a themed status bar over an unthemed
 * bar is a two-tone header on the one screen that is supposed to look like an
 * app. `themeColorFor` is that rule, and the inline script has to reach the same
 * answer before the first paint, which is why these tests run the script the way
 * a parser does and compare it with the function.
 */

/** A document with only what the two head scripts touch. */
function stubDocument() {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const style: Record<string, string> = {};
  const meta = {
    content: "",
    setAttribute: (_name: string, value: string) => (meta.content = value),
  };

  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      hasAttribute: (name: string) => attributes.has(name),
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
      style,
    },
    querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null),
  });

  return { attributes, classes, style, meta };
}

/** A window that reports itself as installed, or as a browser tab. */
function stubWindow({ standalone }: { standalone: boolean }) {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }),
  });
  vi.stubGlobal("navigator", standalone ? { standalone: true } : {});
}

/** Run one inline head script the way a parser does: in the global scope. */
function run(script: string) {
  new Function(script)();
}

/** `<head>`, in the order src/routes/__root.tsx emits them. */
function runHeadScripts({
  standalone,
  stored,
}: {
  standalone: boolean;
  stored?: string | undefined;
}) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "nyuz.theme" ? (stored ?? null) : null),
  });
  stubWindow({ standalone });
  const dom = stubDocument();

  run(SHELL_INIT_SCRIPT);
  run(THEME_INIT_SCRIPT);
  return dom;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("themeColorFor", () => {
  it("is ink for every theme once the window is installed", () => {
    expect(themeColorFor("light", true)).toBe(APP_CHROME_COLOR);
    expect(themeColorFor("dark", true)).toBe(APP_CHROME_COLOR);
  });

  it("follows the theme in a browser tab, as it always did", () => {
    expect(themeColorFor("light", false)).toBe("#ffffff");
    expect(themeColorFor("dark", false)).toBe("#0a0a0a");
  });

  it("paints the status bar the same ink as the shell's bars", () => {
    // The token's comment in src/styles.css claims `--app-chrome` is the dark
    // background; this is the half of that claim that can be checked here.
    expect(APP_CHROME_COLOR).toBe(THEME_COLORS.dark);
  });
});

describe("the head scripts, in the order they are emitted", () => {
  it("marks an installed window and then paints its chrome ink", () => {
    const dom = runHeadScripts({ standalone: true, stored: "light" });
    expect(dom.attributes.get(STANDALONE_ATTRIBUTE)).toBe("true");
    expect(dom.meta.content).toBe(APP_CHROME_COLOR);
    // The reading surface is still the reader's choice of theme; only the
    // chrome is fixed.
    expect(dom.classes.has("dark")).toBe(false);
    expect(dom.style["colorScheme"]).toBe("light");
  });

  it("leaves a browser tab themed", () => {
    const light = runHeadScripts({ standalone: false, stored: "light" });
    expect(light.attributes.has(STANDALONE_ATTRIBUTE)).toBe(false);
    expect(light.meta.content).toBe(THEME_COLORS.light);
    expect(light.style["colorScheme"]).toBe("light");

    const dark = runHeadScripts({ standalone: false });
    expect(dark.meta.content).toBe(THEME_COLORS.dark);
    expect(dark.classes.has("dark")).toBe(true);
  });

  it("agrees with themeColorFor for every combination", () => {
    // The invariant, not a restatement: the function is what React-driven theme
    // changes use, the script is what the first paint uses, and a divergence
    // shows up as a status bar that changes colour when the reader taps the
    // toggle.
    const cases = [
      { standalone: true, stored: "light" },
      { standalone: true, stored: undefined },
      { standalone: false, stored: "light" },
      { standalone: false, stored: undefined },
      { standalone: false, stored: "dark" },
    ] as const;

    for (const scenario of cases) {
      const dom = runHeadScripts({ standalone: scenario.standalone, stored: scenario.stored });
      const theme = scenario.stored === "light" ? "light" : "dark";
      expect(dom.meta.content).toBe(themeColorFor(theme, scenario.standalone));
    }
  });

  it("depends on the shell script having run first", () => {
    // Documenting the dependency rather than a feature: without the attribute,
    // the theme script falls back to the page colour. That is why the order in
    // src/routes/__root.tsx is asserted above rather than left to chance.
    vi.stubGlobal("localStorage", { getItem: () => "light" });
    stubWindow({ standalone: true });
    const dom = stubDocument();
    run(THEME_INIT_SCRIPT);
    expect(dom.meta.content).toBe(THEME_COLORS.light);
  });
});
