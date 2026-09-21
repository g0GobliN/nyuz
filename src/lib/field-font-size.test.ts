import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The 16px floor under every text field, held as an invariant rather than a
 * comment.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * iOS Safari zooms the whole page in when a text control smaller than 16px
 * takes focus, and it does not zoom back out on blur: the reader is left on a
 * magnified page with both edges cut off until they pinch it back. A control
 * that renders at 14px is therefore not a small typographic choice on a phone,
 * it is a broken page — and it is invisible in review, because 14px is correct
 * everywhere else.
 *
 * `src/styles.css` carries a backstop for it: inside `@layer base`, a
 * phone-width media query sets `font-size: max(16px, 1em)` on `input`, `select`
 * and `textarea`. That catches fields which *inherit* their size from a
 * `text-sm` label, and it is deliberately placed in `base` so a field that
 * means to be smaller on desktop can still say `md:text-sm` on the element and
 * win.
 *
 * What the backstop cannot catch is a field that sets its own phone size, since
 * a utility on the element beats a rule in an earlier layer. That is the case
 * this file exists for, and it is not hypothetical: the admin console's shared
 * `inputClass` carried `text-[14px]`, which put roughly seventy fields across
 * eleven console pages under the floor while the backstop sat there looking
 * correct.
 *
 * ---------------------------------------------------------------------------
 * Why this reads source text
 * ---------------------------------------------------------------------------
 *
 * The real enforcement is a computed style in a browser, and the suite has no
 * browser (the same reason `security-invariants.test.ts` reads SQL instead of
 * connecting to a database). What CAN be checked is the thing that decides the
 * rendered size: Tailwind emits one rule per utility, ordered by value, with
 * the later rule winning. So a phone-applicable font size below 16px anywhere
 * in a control's class string is a violation *regardless of class order*, which
 * makes the check structural rather than a proxy — no ordering model required,
 * and none assumed.
 *
 * Two halves:
 *
 *   1. The backstop itself — present, phone-scoped, inside `base`, covering the
 *      three control types, with a floor of at least 16px — so the rule cannot
 *      be deleted or quietly loosened.
 *   2. Every `<input>`, `<select>` and `<textarea>` in `src/`, including the
 *      ones whose class comes from a shared constant, must not name a
 *      phone-applicable font size under 16px.
 *
 * As in `security-invariants.test.ts`, the helpers are themselves asserted
 * first: a matcher that silently found nothing would turn this entire file
 * green while checking nothing at all.
 */

const STYLES = readFileSync("src/styles.css", "utf8");

/** Tailwind's default scale, as pixel values at the 16px root this project uses. */
const NAMED_SIZES: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
};

/** `16px`, `0.875rem`, `14.5px` — an absolute length, or null if it is relative. */
function lengthInPx(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "rem" ? amount * 16 : amount;
}

/**
 * The floor a `font-size` declaration guarantees, in px.
 *
 * `max(16px, 1em)` guarantees 16: `max` never goes below its largest term, and
 * the relative half can only raise it. A bare `1em` guarantees nothing, so it
 * returns null and is treated as "no floor stated" rather than as safe.
 */
function pxFloor(declaration: string): number | null {
  const match = /font-size\s*:\s*([^;]+)/.exec(declaration);
  if (!match) return null;
  const value = (match[1] ?? "").trim();
  const fn = /^max\(([^)]*)\)$/.exec(value);
  const terms = (fn ? (fn[1] ?? "").split(",") : [value])
    .map((term) => lengthInPx(term))
    .filter((term): term is number => term !== null);
  return terms.length ? Math.max(...terms) : null;
}

/** The body of the block whose text starts at `at`, brace-matched. */
function bodyAfter(text: string, at: number): string {
  const open = text.indexOf("{", at);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return "";
}

/** Every `selector { declarations }` pair in a block, in source order. */
function rules(block: string): { selector: string; declaration: string }[] {
  const out: { selector: string; declaration: string }[] = [];
  let cursor = 0;
  while (cursor < block.length) {
    const open = block.indexOf("{", cursor);
    if (open < 0) break;
    const selector = block.slice(cursor, open).trim();
    const declaration = bodyAfter(block, open);
    const end = open + 1 + declaration.length + 1;
    if (selector !== "") out.push({ selector, declaration });
    cursor = end;
  }
  return out;
}

/** A media query that applies on a phone: below Tailwind's `md` breakpoint. */
function isPhoneQuery(query: string): boolean {
  const width = /\(\s*(?:width\s*<\s*|max-width\s*:)\s*([\d.]+)(rem|px)\s*\)?/.exec(query);
  if (!width) return false;
  const value = Number(width[1]) * (width[2] === "rem" ? 16 : 1);
  return value <= 768;
}

/** Where a rule lives, so nesting can be asserted and not just the declaration. */
function phoneBackstop(css: string): {
  inBaseLayer: boolean;
  rules: { selector: string; declaration: string }[];
} {
  const baseAt = css.indexOf("@layer base");
  const base = baseAt < 0 ? "" : bodyAfter(css, baseAt);
  const found: { selector: string; declaration: string }[] = [];
  let cursor = 0;
  while (cursor < base.length) {
    const at = base.indexOf("@media", cursor);
    if (at < 0) break;
    const query = base.slice(at, base.indexOf("{", at));
    const body = bodyAfter(base, at);
    if (isPhoneQuery(query)) found.push(...rules(body));
    cursor = at + 1;
  }
  return { inBaseLayer: baseAt >= 0, rules: found };
}

/** Which of the three text-control types a selector list covers. */
function covers(selector: string): Record<string, boolean> {
  return {
    input: /(^|,)\s*input\b/.test(selector) || /(^|,)\s*input:/.test(selector),
    select: /(^|,)\s*select\b/.test(selector),
    textarea: /(^|,)\s*textarea\b/.test(selector),
  };
}

/**
 * The font size a class string puts on a phone, or null when it names none.
 *
 * Only widths below Tailwind's `md` breakpoint count: a bare utility applies at
 * every width, and `max-sm:`/`max-md:` apply on phones. `sm:`, `md:`, `lg:` and
 * the state or pseudo-element variants (`hover:`, `focus:`, `file:`,
 * `placeholder:`, `dark:`) do not describe a phone, so `md:text-sm` and
 * `file:text-sm` are both correctly ignored.
 *
 * Returns the *offending* value rather than the winning one on purpose. Two
 * font-size utilities on the same element are resolved by Tailwind's own
 * ordering, which this test should not have to model: if any phone-applicable
 * size in the string is under the floor, the class string is wrong however the
 * cascade happens to land.
 */
function phoneFontSizes(className: string): number[] {
  const sizes: number[] = [];
  for (const token of className.split(/\s+/)) {
    const match = /^((?:[\w-]+:)*)text-(.+)$/.exec(token);
    if (!match) continue;
    const variants = (match[1] ?? "").replace(/:$/, "").split(":").filter(Boolean);
    const appliesOnPhone = variants.every((variant) => variant.startsWith("max-"));
    if (!appliesOnPhone) continue;
    const size = match[2] ?? "";
    if (size.startsWith("[")) {
      const px = lengthInPx(size.slice(1, -1));
      if (px !== null) sizes.push(px);
      continue;
    }
    const named = NAMED_SIZES[size];
    if (named !== undefined) sizes.push(named);
  }
  return sizes;
}

const BELOW_FLOOR = 16;

/** Control types that do not take typed text, so iOS never zooms for them. */
const NOT_TEXT_ENTRY = new Set([
  "checkbox",
  "radio",
  "range",
  "file",
  "submit",
  "button",
  "reset",
  "image",
  "hidden",
  "color",
]);

/** Every JavaScript/TypeScript file under a directory, tests excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * The opening tag of every text control, with quotes and braces balanced so an
 * attribute containing `>` cannot end a tag early.
 *
 * The capitalised names are the shared wrappers in `components/ui`. They are
 * barely used today — the product writes raw `input` and `textarea` elements —
 * but a wrapper is exactly the shape a new field is most likely to take, and
 * one that arrived with its own `text-sm` would be under the floor on every
 * screen that used it.
 */
function controlTags(source: string): string[] {
  const out: string[] = [];
  const open = /<(input|select|textarea|Input|Textarea|Select)\b/g;
  let match = open.exec(source);
  while (match) {
    let index = match.index + match[0].length;
    let quote = "";
    let depth = 0;
    while (index < source.length) {
      const char = source[index];
      if (quote) {
        if (char === quote && source[index - 1] !== "\\") quote = "";
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth <= 0) break;
      index += 1;
    }
    out.push(source.slice(match.index, index + 1));
    match = open.exec(source);
  }
  return out;
}

/** String literals written directly in a tag, including inside `${}` templates. */
function inlineLiterals(tag: string): string[] {
  const literals: string[] = [];
  const pattern = /"([^"\n]*)"|`([^`\n]*)`/g;
  for (const match of tag.matchAll(pattern)) literals.push(match[1] ?? match[2] ?? "");
  return literals;
}

/** Identifiers passed to `className={...}`, which the compiler resolves by hand. */
function classNameIdentifiers(tag: string): string[] {
  const expression = /className=\{([^}]*)\}/.exec(tag)?.[1];
  if (!expression) return [];
  const withoutQuoted = expression.replace(/"[^"]*"|`[^`]*`|'[^']*'/g, " ");
  return (
    [...withoutQuoted.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)]
      .map((match) => match[1] ?? "")
      // `cn` merges classes rather than being one, and `className` is the prop
      // being forwarded: whatever a caller passes is checked at the call site.
      .filter((name) => name !== "cn" && name !== "className" && !name.startsWith("_"))
  );
}

/** String constants a module declares at the top level, by name. */
function declaredConstants(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern =
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:\n\s*)?("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  for (const match of source.matchAll(pattern)) {
    out.set(match[1] ?? "", (match[2] ?? "").slice(1, -1));
  }
  return out;
}

/** Named imports, as local name → the module they came from. */
function namedImports(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const from = match[2] ?? "";
    for (const spec of (match[1] ?? "").split(",")) {
      const [original, alias] = spec.trim().split(/\s+as\s+/);
      if (!original) continue;
      out.set(alias ?? original, from);
    }
  }
  return out;
}

/** A module specifier as a file on disk. Only the two forms this codebase uses. */
function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith(".")
      ? `${from.slice(0, from.lastIndexOf("/"))}/${specifier}`
      : null;
  if (!base) return null;
  const normalized = base.replace(/\/\.\//g, "/");
  for (const candidate of [`${normalized}.tsx`, `${normalized}.ts`, normalized]) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/**
 * Resolve a class identifier the way the bundler would, or say why it cannot.
 *
 * `from` is the module the string was written in, so a failure can name the
 * constant rather than the seventy call sites that inherit it.
 */
function resolveClass(
  file: string,
  name: string,
): { text: string; from: string } | { unresolved: string } {
  const own = declaredConstants(readFileSync(file, "utf8")).get(name);
  if (own !== undefined) return { text: own, from: `${file} (${name})` };
  const imported = namedImports(readFileSync(file, "utf8")).get(name);
  if (imported) {
    const path = resolveModule(file, imported);
    if (!path) return { unresolved: `${name} from "${imported}"` };
    const constant = declaredConstants(readFileSync(path, "utf8")).get(name);
    if (constant !== undefined) return { text: constant, from: `${path} (${name})` };
    return { unresolved: `${name} exported by ${path}` };
  }
  return { unresolved: name };
}

const CONTROLS = sourceFiles("src").flatMap((file) =>
  controlTags(readFileSync(file, "utf8"))
    .filter((tag) => {
      const type = /type="([^"]+)"/.exec(tag)?.[1];
      return !(type && NOT_TEXT_ENTRY.has(type));
    })
    .flatMap((tag) => {
      const classes = inlineLiterals(tag).map((text) => ({ text, from: file }));
      const unresolved: string[] = [];
      for (const name of classNameIdentifiers(tag)) {
        const resolved = resolveClass(file, name);
        if ("text" in resolved) classes.push(resolved);
        else unresolved.push(resolved.unresolved);
      }
      return [{ file, tag, classes, unresolved }];
    }),
);

describe("the helpers these tests depend on actually work", () => {
  it("reads a guaranteed floor out of the declarations in use", () => {
    expect(pxFloor("font-size: max(16px, 1em)")).toBe(16);
    expect(pxFloor("font-size: 16px")).toBe(16);
    expect(pxFloor("font-size: 1rem")).toBe(16);
    expect(pxFloor("font-size: 14px")).toBe(14);
    expect(pxFloor("font-size: max(14px, 1em)")).toBe(14);
    // A purely relative size guarantees nothing, and must not read as safe.
    expect(pxFloor("font-size: 1em")).toBeNull();
    expect(pxFloor("color: red")).toBeNull();
  });

  it("recognises a phone breakpoint and not the others", () => {
    expect(isPhoneQuery("@media (width < 48rem)")).toBe(true);
    expect(isPhoneQuery("@media (max-width: 767.98px)")).toBe(true);
    expect(isPhoneQuery("@media (min-width: 48rem)")).toBe(false);
    expect(isPhoneQuery("@media (prefers-reduced-motion: reduce)")).toBe(false);
  });

  it("separates phone sizes from desktop ones", () => {
    expect(phoneFontSizes("text-[14px]")).toEqual([14]);
    expect(phoneFontSizes("text-sm")).toEqual([14]);
    expect(phoneFontSizes("text-base md:text-sm")).toEqual([16]);
    expect(phoneFontSizes("text-[16px] md:text-[14.5px]")).toEqual([16]);
    expect(phoneFontSizes("max-md:text-[14px]")).toEqual([14]);
    expect(phoneFontSizes("md:text-sm")).toEqual([]);
    // The file-selector button and the placeholder are not the field itself.
    expect(phoneFontSizes("file:text-sm placeholder:text-muted-foreground")).toEqual([]);
    expect(phoneFontSizes("text-[17px]")).toEqual([17]);
    expect(phoneFontSizes("tabular-nums resize-y")).toEqual([]);
  });

  it("finds control tags without tripping on an angle bracket in an attribute", () => {
    const tags = controlTags('<input value={a > b} className="text-sm" />\n<textarea />');
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain("text-sm");
  });

  it("resolves the shared field constants the console depends on", () => {
    // A resolver that quietly returned nothing would make every assertion below
    // vacuous, which is the exact failure `security-invariants.test.ts` guards
    // against in its own first describe block.
    const field = resolveClass("src/components/topic-controls.tsx", "FIELD");
    expect(field).toHaveProperty("text");
    const input = resolveClass("src/routes/admin/economics.tsx", "inputClass");
    expect(input).toHaveProperty("text");
    // And it names the module the string was written in, so a failure can point
    // at the constant instead of at every control that inherits it.
    expect(input).toEqual({
      text: expect.any(String),
      from: "src/components/admin/shell.tsx (inputClass)",
    });
    // One that does not exist must report itself rather than pass silently.
    expect(resolveClass("src/routes/admin/economics.tsx", "noSuchClass")).toEqual({
      unresolved: "noSuchClass",
    });
  });

  it("actually inspected the product's fields", () => {
    expect(CONTROLS.length).toBeGreaterThan(50);
    expect(
      CONTROLS.some((control) => control.classes.some((entry) => entry.text.includes("text-"))),
    ).toBe(true);
    // Including the shared constants, not just the literals: they are where the
    // product's field sizing actually lives.
    expect(
      CONTROLS.some((control) =>
        control.classes.some((entry) => entry.from.includes("admin/shell.tsx")),
      ),
    ).toBe(true);
  });
});

describe("the phone backstop in the stylesheet", () => {
  const backstop = phoneBackstop(STYLES);

  it("lives in @layer base, so a field can still override it deliberately", () => {
    // Outside `base` the rule would beat the element's own utilities and start
    // overriding a deliberate `md:` size instead of catching a forgotten one.
    expect(backstop.inBaseLayer).toBe(true);
    expect(backstop.rules.length).toBeGreaterThan(0);
  });

  it("covers input, select and textarea", () => {
    const covered = { input: false, select: false, textarea: false };
    for (const rule of backstop.rules) {
      const found = covers(rule.selector);
      for (const key of Object.keys(covered))
        covered[key as keyof typeof covered] ||= found[key] ?? false;
    }
    expect(covered).toEqual({ input: true, select: true, textarea: true });
  });

  it("never declares a floor below 16px", () => {
    const floors = backstop.rules.map((rule) => pxFloor(rule.declaration));
    expect(floors.filter((floor) => floor !== null).length).toBeGreaterThan(0);
    for (const floor of floors) {
      if (floor === null) continue;
      expect(floor).toBeGreaterThanOrEqual(BELOW_FLOOR);
    }
  });

  it("would reject a backstop that had been loosened", () => {
    // The assertion above is only worth something if it can fail. This is the
    // same check, run against the stylesheet as it would read with the floor
    // dropped to 14px and the media query widened to every width.
    const loosened = STYLES.replace("font-size: max(16px, 1em)", "font-size: 14px");
    const weakened = phoneBackstop(loosened);
    expect(weakened.rules.map((rule) => pxFloor(rule.declaration))).toContain(14);
    expect(weakened.rules.every((rule) => (pxFloor(rule.declaration) ?? 16) >= BELOW_FLOOR)).toBe(
      false,
    );
  });
});

describe("no field opts itself under the floor on a phone", () => {
  it("resolves every class it cannot read, rather than skipping it", () => {
    // A control whose className comes from a constant this test cannot follow is
    // an unchecked control. Failing here is the point: the constant either
    // becomes resolvable or moves into the open.
    const unresolved = CONTROLS.flatMap((control) =>
      control.unresolved.map((name) => `${control.file}: ${name}`),
    );
    expect(unresolved).toEqual([]);
  });

  it("leaves no phone-applicable font size under 16px", () => {
    const offenders = new Set<string>();
    for (const control of CONTROLS) {
      for (const { text, from } of control.classes) {
        for (const size of phoneFontSizes(text)) {
          if (size >= BELOW_FLOOR) continue;
          offenders.add(
            `${from}: ${size}px — a field must be 16px on a phone, with the smaller size restored from md:`,
          );
        }
      }
    }
    expect([...offenders]).toEqual([]);
  });
});
