import { describe, expect, it, vi, afterEach } from "vitest";

import {
  isStandalone,
  subscribeToDisplayMode,
  SHELL_INIT_SCRIPT,
  STANDALONE_QUERY,
  FULLSCREEN_QUERY,
} from "@/lib/display-mode";

/**
 * One question asked of a browser: is this window an installed app or a tab?
 *
 * Three callers act on the answer — the shell chooses its chrome, push decides
 * whether iOS will expose its APIs at all, and the device list labels a row
 * "· PWA" — so this file also holds the two answers to it together: the function
 * React reads, and the inline script that marks `<html>` before the first paint.
 * If those two ever disagree, an installed app gets ink chrome and a page-themed
 * document, and the only place that shows up is a real phone.
 */

type Stub = {
  displayMode?: string | null;
  standalone?: boolean;
  matchMedia?: boolean;
  secure?: boolean;
};

function stubBrowser({
  displayMode = null,
  standalone = false,
  matchMedia = true,
  secure = true,
}: Stub = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const removed: Array<{ query: string; fn: () => void }> = [];

  const win: Record<string, unknown> = {
    isSecureContext: secure,
    location: { protocol: secure ? "https:" : "http:" },
  };
  if (matchMedia) {
    win["matchMedia"] = (query: string) => ({
      matches: query === `(display-mode: ${displayMode})`,
      media: query,
      addEventListener: (_: string, fn: () => void) => {
        const set = listeners.get(query) ?? new Set();
        set.add(fn);
        listeners.set(query, set);
      },
      removeEventListener: (_: string, fn: () => void) => {
        removed.push({ query, fn });
        listeners.get(query)?.delete(fn);
      },
    });
  }

  const nav: Record<string, unknown> = { userAgent: "Mozilla/5.0" };
  if (standalone) nav["standalone"] = true;

  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", nav);
  return { listeners, removed };
}

/** Run the inline head script the way a parser does: in the global scope. */
function runShellScript() {
  const attributes: Record<string, string> = {};
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
    },
  });
  new Function(SHELL_INIT_SCRIPT)();
  return attributes;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isStandalone", () => {
  it("is true from the display-mode media query", () => {
    stubBrowser({ displayMode: "standalone" });
    expect(isStandalone()).toBe(true);
  });

  it("is true for an installed app that asked for fullscreen", () => {
    // Not standalone, but still not a browser tab — so still an app shell.
    stubBrowser({ displayMode: "fullscreen" });
    expect(isStandalone()).toBe(true);
  });

  it("is true from the legacy iOS flag", () => {
    // Older WebKit predates the media query and only sets this.
    stubBrowser({ standalone: true, displayMode: null });
    expect(isStandalone()).toBe(true);
  });

  it("is false in a browser tab", () => {
    stubBrowser();
    expect(isStandalone()).toBe(false);
  });

  it("is false when the browser has no matchMedia at all", () => {
    stubBrowser({ matchMedia: false });
    expect(isStandalone()).toBe(false);
  });

  it("is false outside a browser", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);
    expect(isStandalone()).toBe(false);
  });
});

describe("the subscription the hook lives on", () => {
  it("watches both display modes", () => {
    const { listeners } = stubBrowser();
    subscribeToDisplayMode(() => {});
    expect([...listeners.keys()].sort()).toEqual([STANDALONE_QUERY, FULLSCREEN_QUERY].sort());
  });

  it("forwards a mode change and stops on unsubscribe", () => {
    const { listeners, removed } = stubBrowser();
    const onChange = vi.fn();
    const unsubscribe = subscribeToDisplayMode(onChange);

    for (const set of listeners.values()) for (const fn of set) fn();
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(removed).toHaveLength(2);
    for (const set of listeners.values()) expect(set.size).toBe(0);
  });

  it("survives a browser that cannot report a display mode", () => {
    stubBrowser({ matchMedia: false });
    const unsubscribe = subscribeToDisplayMode(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("the inline script that marks <html>", () => {
  it("marks an installed window", () => {
    stubBrowser({ displayMode: "standalone" });
    expect(runShellScript()["data-standalone"]).toBe("true");
  });

  it("marks nothing in a browser tab", () => {
    stubBrowser();
    expect(runShellScript()).toEqual({});
  });

  it("agrees with isStandalone for every way a window can report itself", () => {
    // The invariant, not a restatement: whatever the function says, the script
    // says, because one decides the chrome and the other decides the document.
    const cases: Stub[] = [
      { displayMode: "standalone" },
      { displayMode: "fullscreen" },
      { standalone: true, displayMode: null },
      { displayMode: null },
      { matchMedia: false },
      { standalone: true, displayMode: "standalone" },
    ];

    for (const stub of cases) {
      stubBrowser(stub);
      const marked = Boolean(runShellScript()["data-standalone"]);
      expect(marked).toBe(isStandalone());
    }
  });

  it("is source text, because it has to run before the bundle", () => {
    // Not a style preference: an import would execute after hydration, which is
    // the flash this script exists to prevent.
    expect(SHELL_INIT_SCRIPT).toContain("data-standalone");
    expect(SHELL_INIT_SCRIPT).not.toContain("require(");
  });
});
