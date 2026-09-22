import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The two install surfaces, held to the boundary between them.
 *
 * Source text, in the same spirit as `src/lib/offline/offline-wiring.test.ts` and
 * for the same reason: every mistake below is a comment in the code today and
 * invisible at runtime tomorrow.
 *
 * - The Home card's memory is device-local advice about an icon. If the Settings
 *   section ever read the card's dismissal, a reader who said "Not now" on Home
 *   would find Nyuz's installation option gone from the one page that is supposed
 *   to keep it — the exact reason the dismissal is allowed to be permanent.
 * - `if (offer === "none") return null` must stay *below* the hooks. React counts
 *   hooks per render, and the offer changes at the worst moment: the moment a
 *   reader taps Install, the captured prompt is consumed and the section goes from
 *   a button to `none`. An early return above a hook throws on that switch, which
 *   is the first tap this feature ever gets.
 * - `recordSession` measures visits to Home — the destination the card lives on.
 *   Called from the shell or a route it would count page views instead, and the
 *   "two sessions" rule would mean two page opens.
 */

const CARD = "src/components/dashboard/install-card.tsx";
const SECTION = "src/components/dashboard/install-section.tsx";

const read = (path: string) => readFileSync(path, "utf8");

/** Every non-test TypeScript file under `src`, for whole-repo claims. */
function sourceFiles(): string[] {
  return readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name))
    .map((name) => `src/${name}`)
    .sort();
}

describe("the card's memory stays on the card", () => {
  it("is imported by exactly one file", () => {
    // The whole-repo form matters: a second importer could be the shell, or a
    // route, and either would count sessions against page views instead of
    // visits to Home.
    const importers = sourceFiles().filter((path) => read(path).includes("install/storage"));
    expect(importers).toEqual([CARD]);
  });

  it("is not what the Settings section consults", () => {
    const section = read(SECTION);
    expect(section).not.toContain("cardDismissed");
    expect(section).not.toContain("dismissInstallCard");
    expect(section).not.toContain("recordSession");
  });
});

describe("a section that renders nothing still renders its hooks", () => {
  it("returns null, and does it below every hook", () => {
    const section = read(SECTION);
    const earlyReturn = section.indexOf('if (offer === "none") return null;');
    expect(earlyReturn).toBeGreaterThan(-1);

    const lastHook = Math.max(
      section.lastIndexOf("useState("),
      section.lastIndexOf("useStandalone()"),
      section.lastIndexOf("useInstallFacts()"),
    );
    // A hook below the return is a conditional hook: React counts fewer hooks on
    // the render where the offer became `none`, and throws.
    expect(lastHook).toBeLessThan(earlyReturn);
  });

  it("renders nothing at all, not an empty section", () => {
    // No heading, no border, no gap: the first JSX in the file is after the
    // return, so `none` cannot reach it.
    const section = read(SECTION);
    expect(section.slice(0, section.indexOf("<section"))).toContain(
      'if (offer === "none") return null;',
    );
  });
});

describe("what each surface decides from", () => {
  it("gives the card live connectivity, not a stored answer", () => {
    // The offline rule is only as real as the wiring into it: `online` has to
    // come from the live hook, so a reader who goes offline mid-session stops
    // being offered installation without a reload.
    expect(read(CARD)).toMatch(/shouldShowInstallCard\(\{[^}]*online[^}]*\}\)/);
  });
});
