import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The brand assets in public/ are loaded by browsers, not by this bundle, so
 * nothing else in the suite would notice them breaking.
 *
 * This exists because of a real outage: public/logo.svg carried "--signal" in a
 * comment, which is not well-formed XML. SVG is parsed as strict XML, so Firefox
 * refused the file outright and the tab fell back to the globe. The wording was
 * later copied into favicon.svg, which is the one the browser actually loads.
 */

const PUBLIC = join(process.cwd(), "public");

function read(name: string): string {
  return readFileSync(join(PUBLIC, name), "utf8");
}

describe("svg brand assets", () => {
  const svgs = readdirSync(PUBLIC).filter((f) => f.endsWith(".svg"));

  it("finds the marks it is meant to guard", () => {
    expect(svgs).toEqual(expect.arrayContaining(["favicon.svg", "logo.svg"]));
  });

  it.each(svgs)("%s has no double hyphen inside a comment", (name) => {
    // The XML rule that bit us: "--" may not appear within a comment's body.
    for (const [, body] of read(name).matchAll(/<!--([\s\S]*?)-->/g)) {
      expect(body).not.toContain("--");
    }
  });

  it.each(svgs)("%s declares an intrinsic size", (name) => {
    // A favicon with only a viewBox is rejected by some browsers.
    const svg = read(name);
    expect(svg).toMatch(/\bviewBox="/);
    expect(svg).toMatch(/\bwidth="/);
    expect(svg).toMatch(/\bheight="/);
  });

  it.each(svgs)("%s draws even if the style block is dropped", (name) => {
    // Colour lives in <style> for theme-switching, but an icon renderer that
    // ignores it must still get a stroked path rather than an invisible one.
    const svg = read(name);
    expect(svg).toMatch(/<path[^>]*\sstroke="#/);
    expect(svg).toMatch(/<circle[^>]*\sfill="#/);
  });
});

describe("favicon.ico", () => {
  const ico = readFileSync(join(PUBLIC, "favicon.ico"));

  it("is an icon file with at least the 16 and 32px sizes", () => {
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(2);

    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16]);
    expect(sizes).toEqual(expect.arrayContaining([16, 32]));
  });

  it("stores frames as DIB rather than PNG", () => {
    // Pillow defaults to PNG-compressed frames, which some decoders reject at
    // small sizes. Every frame here should be a plain bitmap.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const count = ico.readUInt16LE(4);
    for (let i = 0; i < count; i++) {
      const offset = ico.readUInt32LE(6 + i * 16 + 12);
      expect(ico.subarray(offset, offset + 8).equals(png)).toBe(false);
    }
  });
});

/**
 * The mark is drawn in three places: two SVG files and one inline React
 * component. Nothing links them, and every raster in public/ is generated from
 * the same geometry, so a drift here silently ships a different logo to email,
 * the tab and the social card.
 *
 * The path is deliberately two subpaths: a full-height stem, then the shoulder
 * springing off it partway down. The overlap is what leaves the notch at the top
 * left of the n. Collapsing it into one smooth arch erases that notch — which is
 * a mistake this repo has shipped twice.
 */
describe("the mark is one shape everywhere", () => {
  const STEM = "M7.89 34.95V5";
  const SHOULDER = "M7.89 18.85A12.11 12.11 0 0 1 32.11 18.85V29.7";
  const sources = {
    "public/logo.svg": read("logo.svg"),
    "public/favicon.svg": read("favicon.svg"),
    "nav.tsx <LogoMark>": readFileSync(
      join(process.cwd(), "src/components/landing/nav.tsx"),
      "utf8",
    ),
  };

  it.each(Object.entries(sources))("%s draws the agreed path", (_name, src) => {
    expect(src).toContain(STEM + SHOULDER);
  });

  it.each(Object.entries(sources))("%s keeps the stem above the springing point", (_name, src) => {
    // Two subpaths, not one. A single "M" means stem and shoulder were fused.
    const d = src.match(/d="(M7\.89[^"]*)"/)?.[1] ?? "";
    expect(d.match(/M/g) ?? []).toHaveLength(2);
    // Stem caps at y=5; the shoulder's centre line sits at y=18.85, far below it.
    expect(d).toMatch(/V5M/);
  });
});
