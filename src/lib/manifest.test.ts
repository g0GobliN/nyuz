import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { THEME_COLORS } from "@/lib/theme";

/**
 * The manifest is read by the browser, never by this bundle, so nothing else in
 * the suite would notice it breaking — the same reason
 * `src/lib/brand-assets.test.ts` exists for the icons in `public/`.
 *
 * Two of these assertions are here because the mistakes they catch are silent
 * rather than loud:
 *
 * 1. `start_url` must be inside `scope`. A `start_url` outside its scope is not
 *    an error anywhere — the browser simply discards it and launches the icon at
 *    whatever URL it was installed from, which is invisible until somebody
 *    installs from /pricing and gets /pricing every time they tap the icon.
 *    The trap is one character wide: `scope: "/dashboard/"` excludes
 *    `/dashboard` itself, because scope is a path prefix.
 * 2. A declared icon size that does not match the file. Android scales what it
 *    is given, so a 192 file advertised as 512 installs a blurry icon and
 *    nothing anywhere complains.
 */

const PUBLIC = join(process.cwd(), "public");
const MANIFEST_PATH = join(PUBLIC, "manifest.webmanifest");

type Icon = { src: string; sizes: string; type: string; purpose?: string };

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Icon[];
};

/** Width and height straight out of the PNG IHDR, with no image dependency. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8).equals(signature)).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the manifest suits the app it installs", () => {
  it("opens the dashboard, standalone", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/dashboard");
  });

  it("keeps start_url inside scope", () => {
    // Path-prefix semantics, spelled out: /dashboard is inside /dashboard, and
    // would NOT be inside /dashboard/ — which is why the trailing slash is
    // absent from the manifest and asserted against here.
    const scope = manifest.scope;
    expect(manifest.start_url === scope || manifest.start_url.startsWith(`${scope}/`)).toBe(true);
    expect(scope.endsWith("/")).toBe(false);
  });

  it("pins an id, so a future start_url change cannot register a second app", () => {
    // Left unset, the id defaults to start_url, and changing start_url later
    // installs a second nyuz beside the first.
    expect(manifest.id).toBe("/");
  });

  it("shows the reader the same name the product uses", () => {
    expect(manifest.name).toBe("nyuz");
    expect(manifest.short_name).toBe("nyuz");
    // Android truncates a long short_name under the icon; iOS takes its label
    // from apple-mobile-web-app-title in src/routes/__root.tsx instead.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });
});

describe("launch colours come from the theme tokens", () => {
  it("uses the dark background for both chrome and splash", () => {
    // These are the sRGB values of --background dark. Hard-coded in the manifest
    // for the same reason THEME_COLORS is: a JSON file cannot read a custom
    // property. Change them together.
    expect(manifest.theme_color).toBe(THEME_COLORS.dark);
    expect(manifest.background_color).toBe(THEME_COLORS.dark);
  });

  it("still agrees with the dark --background in the stylesheet", () => {
    // theme.ts says the two are changed together; nothing held it to that. The
    // hex is the sRGB form of the oklch value below, which is the pair a future
    // retune of the dark surface has to move as one.
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    const dark = css.slice(css.indexOf(".dark {"));
    expect(dark).toContain("--background: oklch(0.145 0 0)");
    expect(THEME_COLORS.dark).toBe("#0a0a0a");
  });
});

describe("the icons Android and iOS will actually use", () => {
  it("declares the three sizes the install criteria expect", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("includes a maskable icon", () => {
    // Without one, Android puts the square icon inside a white circle and the
    // ink field reads as a bug.
    expect(manifest.icons.some((i) => i.purpose?.includes("maskable"))).toBe(true);
  });

  it.each(manifest.icons)("$src exists at the size it advertises", (icon) => {
    const file = join(PUBLIC, icon.src.replace(/^\//, ""));
    expect(existsSync(file)).toBe(true);

    const { width, height } = pngSize(file);
    expect(icon.sizes).toBe(`${width}x${height}`);
    expect(icon.type).toBe("image/png");
  });

  it("keeps the touch icon iOS ignores the manifest for", () => {
    // iOS takes the Home Screen icon from apple-touch-icon alone; the manifest
    // icons are not consulted at all.
    const touch = pngSize(join(PUBLIC, "apple-touch-icon.png"));
    expect(touch).toEqual({ width: 180, height: 180 });
  });
});

describe("the viewport the safe areas depend on", () => {
  const root = readFileSync(join(process.cwd(), "src/routes/__root.tsx"), "utf8");

  it("sets viewport-fit=cover", () => {
    // Every env(safe-area-inset-*) in the product resolves to 0 without this,
    // so dropping it would quietly disable the app shell's full-bleed top bar
    // and the bottom strip's home-indicator padding in one edit.
    expect(root).toMatch(/width=device-width, initial-scale=1, viewport-fit=cover/);
  });

  it("links the manifest and names the iOS app", () => {
    expect(root).toMatch(/rel: "manifest", href: "\/manifest\.webmanifest"/);
    expect(root).toMatch(/apple-mobile-web-app-title/);
    expect(root).toMatch(/apple-mobile-web-app-status-bar-style/);
  });
});
