import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The chrome a phone can reach has to clear the phone's own bands.
 *
 * `viewport-fit=cover` (see the viewport meta in `src/routes/__root.tsx`) is what
 * lets the page reach under the status bar, the Dynamic Island, the notch and
 * the home indicator — and it is also what makes `env(safe-area-inset-*)`
 * resolve to anything but 0. A surface anchored to a screen edge without
 * reading its inset is correct in a browser tab and wrong on the Home Screen,
 * which is the worst kind of bug: the reviewer's device hides it and the
 * reader's shows it.
 *
 * Four of these were found on a real device and are named below. They are
 * asserted on the source rather than on rendered geometry because `env()`
 * resolves to 0 under a test runner, which would make every assertion pass
 * vacuously. What is asserted is the decision, not the pixels.
 *
 * Reachability, for the same reason: the dashboard routes swap to the app shell
 * when the display mode says installed (`if (standalone)` in
 * `src/components/dashboard/shell.tsx`), so the reader's phone surfaces are the
 * app shell, the console (reachable from the account menu) and the marketing
 * site (the sign-out redirect at `src/components/dashboard/account-menu.tsx`).
 * The glass dashboard header is not on that list — it renders only in tabs,
 * where the insets are 0 — so it is deliberately absent below.
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("chrome that a phone can reach clears the bands it overlaps", () => {
  it("never stacks the strip's own padding on top of the bottom inset", () => {
    // The strip used to read `calc(env(safe-area-inset-bottom) + 0.375rem)`.
    // On an installed phone that put the destinations 52pt above the bottom
    // edge -- a browser tab, where the inset is 0, never showed it. The inset
    // has to *replace* the padding, not add to it.
    //
    // Scoped to the strip's scroll row (`gutter-x-xs`). The content's reserve
    // for the strip (`TAB_BAR`) adds to the inset on purpose: that padding is
    // how a page's last line clears a strip that got taller, not a surface of
    // its own.
    const stacking = [
      "src/components/dashboard/app-shell.tsx",
      "src/components/dashboard/shell.tsx",
    ]
      .map((path) => [path, read(path)] as const)
      .flatMap(([path, source]) =>
        /gutter-x-xs[^"]*env\(safe-area-inset-bottom\)\s*\+/.test(source) ? [path] : [],
      );
    expect(stacking).toEqual([]);
  });

  it("gives the installed app's bottom strip an inset it replaces, not one it adds to", () => {
    expect(read("src/components/dashboard/app-shell.tsx")).toMatch(
      /pb-\[max\(0\.375rem,\s*env\(safe-area-inset-bottom\)_-_\s*0\.375rem\)\]/,
    );
  });

  it("keeps the installed app's header clear of the status bar", () => {
    expect(read("src/components/dashboard/app-shell.tsx")).toMatch(
      /sticky top-0[^"]*pt-\[env\(safe-area-inset-top\)\]/,
    );
  });

  it("keeps the marketing header below the status bar, and the page below the header", () => {
    const nav = read("src/components/landing/nav.tsx");
    // The header is `fixed`, so padding grows it downward instead of moving it
    // -- and the document is then given the same inset back, because a fixed
    // header does not push the page when it grows. Either half alone is wrong:
    // the padding alone hides the first screenful under the taller header, the
    // spacer alone leaves the wordmark inside the clock.
    expect(nav).toMatch(/pt-\[env\(safe-area-inset-top\)\]/);
    expect(nav).toMatch(/h-\[env\(safe-area-inset-top\)\]/);
  });

  it("keeps the search overlay clear of a landscape notch", () => {
    const overlay = read("src/components/dashboard/search-overlay.tsx");
    expect(overlay).toMatch(/env\(safe-area-inset-left\)/);
    expect(overlay).toMatch(/env\(safe-area-inset-right\)/);
  });

  it("keeps the console's header and drawer clear on a phone", () => {
    const shell = read("src/components/admin/shell.tsx");
    // The console is reachable from the installed app's account menu, so its
    // chrome runs in standalone too.
    expect(shell).toMatch(/sticky top-0[^"]*pt-\[env\(safe-area-inset-top\)\]/);
    expect(shell).toMatch(/env\(safe-area-inset-left\)/);
    expect(shell).toMatch(/env\(safe-area-inset-right\)/);
    expect(shell).toMatch(/pb-\[max\(1\.5rem,\s*env\(safe-area-inset-bottom\)\)\]/);
  });
});
