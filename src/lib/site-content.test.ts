import { describe, expect, it } from "vitest";
import {
  HERO_DEFAULT,
  MEDIA_DEFAULT,
  SECTIONS_DEFAULT,
  SECTION_KEYS,
  heroSchema,
  mediaSchema,
  moveSection,
  parseSetting,
  sectionsSchema,
} from "@/lib/site-content";

/**
 * These schemas sit between the admin console and the public site, so a gap in
 * them is a broken landing page for every visitor. The cases below are the ones
 * where "it validated" and "it renders correctly" can come apart.
 */

describe("sectionsSchema", () => {
  it("accepts the ordered list form", () => {
    const stored = [
      { key: "noise", enabled: false },
      { key: "comparison", enabled: true },
    ];
    const parsed = sectionsSchema.parse(stored);
    expect(parsed[0]).toEqual({ key: "noise", enabled: false });
    expect(parsed[1]).toEqual({ key: "comparison", enabled: true });
  });

  it("still accepts the legacy boolean-map form", () => {
    // 0003 seeds rows in this shape. Rejecting it would blank the landing page
    // of any database seeded before the ordered list landed.
    const parsed = sectionsSchema.parse({ noise: false, comparison: true });
    const noise = parsed.find((s) => s.key === "noise");
    expect(noise?.enabled).toBe(false);
  });

  it("fills in sections the stored value never mentioned, switched on", () => {
    const parsed = sectionsSchema.parse([{ key: "noise", enabled: false }]);
    expect(parsed).toHaveLength(SECTION_KEYS.length);
    // A newly shipped section appears without anyone editing every stored row.
    expect(parsed.find((s) => s.key === "finalCta")?.enabled).toBe(true);
  });

  it("preserves the stored order and appends the rest", () => {
    const parsed = sectionsSchema.parse([
      { key: "finalCta", enabled: true },
      { key: "noise", enabled: true },
    ]);
    expect(parsed[0]?.key).toBe("finalCta");
    expect(parsed[1]?.key).toBe("noise");
  });

  it("collapses duplicates so a component cannot mount twice", () => {
    const parsed = sectionsSchema.parse([
      { key: "noise", enabled: true },
      { key: "noise", enabled: false },
    ]);
    expect(parsed.filter((s) => s.key === "noise")).toHaveLength(1);
    // First occurrence wins.
    expect(parsed.find((s) => s.key === "noise")?.enabled).toBe(true);
  });

  it("rejects a key the bundle has no component for", () => {
    expect(() => sectionsSchema.parse([{ key: "nonexistent", enabled: true }])).toThrow();
  });
});

describe("moveSection", () => {
  it("swaps a section with its neighbour", () => {
    const moved = moveSection(SECTIONS_DEFAULT, 1, -1);
    expect(moved[0]?.key).toBe(SECTIONS_DEFAULT[1]?.key);
    expect(moved[1]?.key).toBe(SECTIONS_DEFAULT[0]?.key);
  });

  it("is a no-op at either end rather than dropping a section", () => {
    const last = SECTIONS_DEFAULT.length - 1;
    expect(moveSection(SECTIONS_DEFAULT, 0, -1)).toEqual(SECTIONS_DEFAULT);
    expect(moveSection(SECTIONS_DEFAULT, last, 1)).toEqual(SECTIONS_DEFAULT);
  });

  it("never changes how many sections there are", () => {
    const moved = moveSection(SECTIONS_DEFAULT, 3, 1);
    expect(moved).toHaveLength(SECTIONS_DEFAULT.length);
    expect(new Set(moved.map((s) => s.key)).size).toBe(SECTIONS_DEFAULT.length);
  });
});

describe("mediaSchema", () => {
  const slot = (url: string, alt = "Some alt text") => ({
    hero: { url, alt, caption: "" },
    midpage: { url: "", alt: "", caption: "" },
    closing: { url: "", alt: "", caption: "" },
  });

  it("accepts a root-relative path and an https URL", () => {
    expect(() => mediaSchema.parse(slot("/hero.jpg"))).not.toThrow();
    expect(() => mediaSchema.parse(slot("https://cdn.example/hero.jpg"))).not.toThrow();
  });

  it("rejects a javascript: URL", () => {
    // This value reaches an attribute in every visitor's DOM. The console is
    // staff-only, which is a reason to check it, not a reason to skip it.
    expect(() => mediaSchema.parse(slot("javascript:alert(1)"))).toThrow();
  });

  it("rejects a data: URL", () => {
    expect(() => mediaSchema.parse(slot("data:text/html;base64,PHNjcmlwdD4="))).toThrow();
  });

  it("requires alt text once an image is set", () => {
    expect(() => mediaSchema.parse(slot("/hero.jpg", ""))).toThrow();
    expect(() => mediaSchema.parse(slot("/hero.jpg", "   "))).toThrow();
  });

  it("allows an empty slot to have no alt text", () => {
    expect(() => mediaSchema.parse(MEDIA_DEFAULT)).not.toThrow();
  });
});

describe("parseSetting", () => {
  it("returns the stored value and reports that it was used", () => {
    const stored = { ...HERO_DEFAULT, headline: "Edited headline" };
    const [value, used] = parseSetting(heroSchema, stored, HERO_DEFAULT);
    expect(value.headline).toBe("Edited headline");
    expect(used).toBe(true);
  });

  it("falls back to the bundled copy for a malformed row instead of throwing", () => {
    // A jsonb column will happily store this. The marketing site must survive it.
    const [value, used] = parseSetting(heroSchema, { headline: 42 }, HERO_DEFAULT);
    expect(value).toEqual(HERO_DEFAULT);
    expect(used).toBe(false);
  });

  it("falls back when the key is absent", () => {
    const [value, used] = parseSetting(heroSchema, null, HERO_DEFAULT);
    expect(value).toEqual(HERO_DEFAULT);
    expect(used).toBe(false);
  });
});
