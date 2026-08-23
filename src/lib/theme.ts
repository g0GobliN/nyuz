/**
 * Colour theme: dark by default, overridable per browser, applied before paint.
 *
 * The theme used to be set from a `useEffect` inside the toggle button, which
 * meant the server sent unthemed HTML, the browser painted it light, and React
 * flipped it to dark after hydration. That flash is not a styling detail — it is
 * the first thing every visitor sees. It also meant a page that happened not to
 * render the toggle got no theme at all.
 *
 * So the class is set by a blocking script in <head> instead, and this module
 * owns the two things that script and the toggle both have to agree on: where
 * the choice is stored, and what "applied" means.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "nyuz.theme";

/**
 * The document background in each theme, as hex, for the `theme-color` meta tag
 * that colours mobile browser chrome. These are the sRGB values of
 * `--background` in src/styles.css (oklch 1 / 0.145) — hard-coded because a
 * meta tag cannot read a custom property. Change them together.
 */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#0a0a0a",
};

/**
 * Dark unless this browser has explicitly chosen light.
 *
 * Deliberately not `prefers-color-scheme`. nyuz is a thing you open at 7am and
 * read for ninety seconds; dark is the house style and the design was built in
 * it. Following the OS would hand half of all first impressions to a theme
 * that is the fallback rather than the intent. Anyone who wants light gets it
 * from the toggle, and that choice then sticks.
 */
export function resolveTheme(stored: string | null): Theme {
  return stored === "light" ? "light" : "dark";
}

/**
 * Puts a theme onto the document: the class Tailwind's `dark` variant keys off,
 * the `color-scheme` that tells the browser to draw scrollbars and form
 * controls to match, and the chrome colour.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

/**
 * The same logic as `resolveTheme` + `applyTheme`, as source text to inline in
 * <head>.
 *
 * It has to be a string rather than an imported function because it must run
 * before the bundle loads — a parser-blocking inline script in <head> executes
 * before the body is parsed, so nothing has painted yet and there is no flash.
 * A module import would run after hydration, which is the bug this replaces.
 *
 * `dark` is assigned before the `localStorage` read rather than after, because
 * that read throws outright in some privacy modes. A browser that cannot tell
 * us anything should land on the default, not on the fallback theme.
 */
export const THEME_INIT_SCRIPT = `(function(){var t="dark";try{if(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="light")t="light"}catch(e){}var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?${JSON.stringify(
  THEME_COLORS.dark,
)}:${JSON.stringify(THEME_COLORS.light)})})();`;
