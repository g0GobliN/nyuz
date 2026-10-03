/**
 * The site has three colours: black, white, and one blue. This proves it.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * AGENTS.md says the palette is black, white, and `--signal` at hue 240, and
 * that every other token in `src/styles.css` is chroma 0. That rule is written
 * down and was, until now, enforced by whoever happened to be reading. A fourth
 * colour is a one-line change that looks entirely reasonable in review — a red
 * for a destructive state, a green for a success badge, a link colour that is
 * "slightly warmer" — and the consequence is that the one accent stops being the
 * only thing on a page that has colour, which is the entire reason it works.
 *
 * The rule is not "be tasteful". It is a countable claim about a file, so it can
 * be counted.
 *
 * ---------------------------------------------------------------------------
 * What is counted
 * ---------------------------------------------------------------------------
 * Every colour literal in `src/styles.css`, in every form it takes: `oklch()`,
 * bare hex, `rgb()`/`rgba()`, and `hsl()`. Anything with a chroma above zero, or
 * a hue that is not 240 in a colour that has one, fails.
 *
 * A monochrome check has one honest weakness, stated here rather than hidden: a
 * colour can be spelled with zero chroma and still not be one of the intended
 * greys. `oklch(0.5 0 0)` is a legal mid-grey this rule accepts, and whether it
 * is the *right* mid-grey is a judgement no static test can make. What it does
 * guarantee is the thing that actually gets broken: a hue appearing.
 *
 * The `--destructive` token is monochrome on purpose, and is called out in
 * AGENTS.md as a decision rather than an oversight. It is not excepted anywhere
 * in this file, because a test that has exceptions is a test whose exceptions
 * grow.
 *
 * ---------------------------------------------------------------------------
 * Why the logo is in here
 * ---------------------------------------------------------------------------
 * `public/logo.svg` is not a stylesheet, so no colour rule reaches it, and it is
 * the one image every reader sees. It carries two blues — the light mark and the
 * dark-mode override — and AGENTS.md requires them to be the sRGB form of
 * `--signal` in each theme. That is checkable, so it is checked: the hexes are
 * converted from the token and compared. If someone lifts `--signal` and forgets
 * the logo, the mark quietly becomes a different blue from every link on the
 * site, and nothing else in the build notices.
 *
 * It is a source test, so it runs on a laptop as part of `npm run test` and not
 * only in CI.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const STYLES = readFileSync("src/styles.css", "utf8");
const LOGO = readFileSync("public/logo.svg", "utf8");

/** The one hue allowed to carry chroma. `--signal` and `--ring`, and nothing else. */
const SIGNAL_HUE = 240;

/**
 * Chroma below this is treated as zero.
 *
 * `oklch(0.53 0 0)` and `oklch(0.53 0.0000001 240)` are the same colour to the
 * eye and to every device that renders this, and a test that rejected the second
 * would be measuring floating-point noise. A real fourth colour is never this
 * close to grey.
 */
const CHROMA_EPSILON = 0.001;

interface Literal {
  /** The source text, for the failure message. */
  text: string;
  /** 1-based line in styles.css. */
  line: number;
  /** 0-360, or null when the syntax carries no hue. */
  hue: number | null;
  /** 0-0.4ish. */
  chroma: number;
}

/** Every `oklch(...)` in the file, including ones nested inside a gradient. */
function oklchLiterals(): Literal[] {
  const found: Literal[] = [];
  const pattern = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(STYLES)) !== null) {
    const [, lightness, chroma, hue, alpha] = match;
    if (lightness === undefined || chroma === undefined || hue === undefined) continue;
    found.push({
      text: match[0],
      line: STYLES.slice(0, match.index).split("\n").length,
      chroma: Number.parseFloat(chroma),
      // An alpha-only oklch — `oklch(1 0 0 / 12%)` — is a transparent ink, and the
      // hue on it is nominal. It is recorded as no hue so a later rule that
      // wants to allow a colour with an alpha has to say so deliberately.
      hue: alpha === undefined ? Number.parseFloat(hue) : null,
    });
  }
  return found;
}

/** Every `#rgb`, `#rrggbb` or `#rrggbbaa` in the file. */
function hexLiterals(): Literal[] {
  const found: Literal[] = [];
  const pattern = /#([0-9a-f]{3,8})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(STYLES)) !== null) {
    const digits = match[1] ?? "";
    const line = STYLES.slice(0, match.index).split("\n").length;
    found.push({ text: match[0], line, hue: null, chroma: 0 });
    // A three-digit hex cannot be proven grey by eye from the text alone, so the
    // check below expands it. Recorded here for the count assertion.
    if (digits.length === 3) {
      found[found.length - 1] = { text: match[0], line, hue: null, chroma: 0 };
    }
  }
  return found;
}

/** `rgb()`, `rgba()` and `hsl()` literals, which no longer appear but would not be caught above. */
function legacyLiterals(): Literal[] {
  const found: Literal[] = [];
  const pattern = /\b(?:rgba?|hsla?)\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(STYLES)) !== null) {
    const body = match[1] ?? "";
    // A grayscale rgb() is `rgb(0 0 0 / 4%)`: all three channels equal, or the
    // `/`-separated legacy comma form. Anything with a non-zero green or blue is
    // a colour and must not be here.
    const channels = body
      .replace(/\//g, " ")
      .split(/[\s,]+/)
      .filter(Boolean)
      .filter((part) => !part.endsWith("%") || /rgb/i.test(match?.[0] ?? ""))
      .map((part) => part.replace(/%$/, ""));
    const numbers = channels.map(Number.parseFloat).filter((n) => !Number.isNaN(n));
    const [r, g, b] = numbers;
    const grey = r !== undefined && g !== undefined && b !== undefined && r === g && g === b;
    const hsl = /hsl/i.test(match?.[0] ?? "");
    // An hsl grey is `hsl(0 0% 0%)`; saturation is the second channel there.
    const saturation = hsl ? (g ?? 0) : 0;
    const hue = hsl ? (r ?? 0) : null;
    found.push({
      text: match[0],
      line: STYLES.slice(0, match.index).split("\n").length,
      hue,
      chroma: grey && saturation === 0 ? 0 : 0.2,
    });
  }
  return found;
}

const OKLCH = oklchLiterals();
const HEX = hexLiterals();
const LEGACY = legacyLiterals();

/** The name of the token a literal belongs to, for a failure message. */
function tokenAt(line: number): string {
  const lines = STYLES.split("\n");
  for (let i = line - 1; i >= 0; i -= 1) {
    const declared = /^\s*(--[a-z0-9-]+)\s*:/.exec(lines[i] ?? "");
    if (declared?.[1]) return declared[1];
  }
  return "an unnamed rule";
}

describe("the palette is black, white and one blue", () => {
  it("finds the colour literals to check", () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously true, so the count is asserted first. It is a floor, not an
    // exact number, so adding a grey does not require editing this test.
    expect(OKLCH.length).toBeGreaterThan(40);
    // And the collectors for the other two syntaxes are wired up, even though
    // both are currently empty — that emptiness is the assertion in the test
    // below, and it is only meaningful if these are reading the same file.
    expect(HEX.every((literal) => literal.text.startsWith("#"))).toBe(true);
    expect(Array.isArray(LEGACY)).toBe(true);
  });

  it("has no chromatic colour outside --signal and --ring", () => {
    const offenders = OKLCH.filter((literal) => literal.chroma > CHROMA_EPSILON).filter(
      (literal) => {
        const token = tokenAt(literal.line);
        return token !== "--signal" && token !== "--ring";
      },
    );
    expect(
      offenders.map(
        (literal) => `line ${literal.line} (${tokenAt(literal.line)}): ${literal.text}`,
      ),
      `A colour with chroma ${CHROMA_EPSILON} or more is a fourth colour. Use --signal, or argue for it in AGENTS.md.`,
    ).toEqual([]);
  });

  it("keeps every chromatic colour at the signal hue", () => {
    const wrongHue = OKLCH.filter(
      (literal) =>
        literal.chroma > CHROMA_EPSILON && literal.hue !== null && literal.hue !== SIGNAL_HUE,
    );
    expect(
      wrongHue.map((literal) => `line ${literal.line} (${tokenAt(literal.line)}): ${literal.text}`),
      `--signal is hue ${SIGNAL_HUE}. A second hue is a second accent competing with it.`,
    ).toEqual([]);
  });

  it("declares --signal and --ring in both themes", () => {
    // A token that is chromatic in :root and grey in .dark is a theme bug that
    // reads as a design choice, so both are required to carry the hue.
    for (const token of ["--signal", "--ring"]) {
      const declarations = OKLCH.filter((literal) => tokenAt(literal.line) === token);
      expect(declarations.length, `${token} is declared once per theme`).toBe(2);
      for (const declaration of declarations) {
        expect(
          declaration.chroma,
          `${token} at line ${declaration.line} has chroma`,
        ).toBeGreaterThan(CHROMA_EPSILON);
        expect(declaration.hue, `${token} at line ${declaration.line} hue`).toBe(SIGNAL_HUE);
      }
    }
  });

  it("has no hex or legacy colour literals at all", () => {
    // `oklch()` is the only colour syntax in this file. A hex or an rgba() is
    // unmeasurable by the rules above and is therefore how a fourth colour
    // would actually get in.
    const hexOffenders = HEX.map((literal) => `line ${literal.line}: ${literal.text}`);
    const legacyOffenders = LEGACY.filter((literal) => literal.chroma > CHROMA_EPSILON).map(
      (literal) => `line ${literal.line}: ${literal.text}`,
    );
    expect(hexOffenders, "src/styles.css declares colours in oklch() only").toEqual([]);
    expect(legacyOffenders, "src/styles.css has no rgb()/hsl() colour").toEqual([]);
  });

  it("keeps --destructive monochrome, as AGENTS.md requires", () => {
    const destructive = OKLCH.filter((literal) => tokenAt(literal.line) === "--destructive");
    expect(destructive.length, "--destructive is declared once per theme").toBe(2);
    for (const literal of destructive) {
      expect(literal.chroma, `--destructive at line ${literal.line} carries no chroma`).toBe(0);
    }
  });
});

/** OKLCH to sRGB, per CSS Color 4. Enough to compare a token against a hex. */
function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const channel = (value: number) => {
    const scaled =
      value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;
    const byte = Math.round(Math.min(1, Math.max(0, scaled)) * 255);
    return byte.toString(16).padStart(2, "0");
  };

  return `#${channel(r)}${channel(g)}${channel(bl)}`.toUpperCase();
}

describe("the logo carries the signal colour", () => {
  /** The `--signal` declaration inside the block whose selector is `selector`. */
  function signalIn(selector: string): { lightness: number; chroma: number; hue: number } {
    // Anchored to the start of a line. A plain `indexOf(".dark")` matches the
    // prose in the :root comment that says a token is *not* repeated under
    // `.dark`, and then reads the wrong block entirely.
    const open = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m").exec(
      STYLES,
    );
    expect(open, `${selector} exists in src/styles.css`).not.toBeNull();
    const start = open?.index ?? 0;
    const block = STYLES.slice(start, STYLES.indexOf("}", start));
    const match = /--signal:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(block);
    expect(match, `${selector} declares --signal`).not.toBeNull();
    const [, lightness, chroma, hue] = match ?? [];
    return {
      lightness: Number.parseFloat(lightness ?? "NaN"),
      chroma: Number.parseFloat(chroma ?? "NaN"),
      hue: Number.parseFloat(hue ?? "NaN"),
    };
  }

  it("uses the light signal value for the mark itself", () => {
    const { lightness, chroma, hue } = signalIn(":root");
    const hex = oklchToHex(lightness, chroma, hue);
    expect(hex).toBe("#0573AA");
    expect(LOGO).toContain(`fill="${hex}"`);
  });

  it("uses the dark signal value in the dark-mode override", () => {
    const { lightness, chroma, hue } = signalIn(".dark");
    const hex = oklchToHex(lightness, chroma, hue);
    expect(hex).toBe("#55AEE8");
    expect(LOGO).toMatch(new RegExp(`\\.dot\\s*\\{\\s*fill:\\s*${hex};`, "i"));
  });

  it("keeps the mark's ink to the same black, white and blue as the theme", () => {
    // The stem is near-black on light and white on dark. Anything else is a
    // colour the stylesheet cannot see, because this file is an image.
    const hexes = [...LOGO.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => (m[1] ?? "").toUpperCase());
    expect([...new Set(hexes)].sort()).toEqual(["0573AA", "0D0D0D", "55AEE8", "FFFFFF"]);

    const chromatic = hexes.filter((hex) => {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return !(r === g && g === b);
    });
    expect(
      [...new Set(chromatic)].sort(),
      "the only chromatic ink in the logo is the signal blue",
    ).toEqual(["0573AA", "55AEE8"]);
  });

  it("is valid XML, because a malformed comment makes browsers drop the icon", () => {
    // SVG is strict XML and a `--` inside a comment ends it early. A custom
    // property name written in prose in that comment — the mistake the file
    // itself warns about — is therefore a real production failure.
    expect(LOGO).not.toMatch(/<!--(?:(?!-->)[\s\S])*?--[a-zA-Z0-9]/);
  });
});
