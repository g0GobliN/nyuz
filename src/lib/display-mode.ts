import { useSyncExternalStore } from "react";

/**
 * Whether this window is an installed app rather than a browser tab.
 *
 * There used to be two copies of this check — one in `src/lib/push/client.ts`,
 * where push needed it because iOS exposes the push APIs to Home Screen web
 * apps only, and one inline in `src/lib/device-install.ts`, where it decides
 * whether a device label ends in "· PWA". The app shell now needs the same
 * answer to choose its chrome, and a third copy is how the three drift: a
 * browser that reports itself one way to the push toggle and another way to the
 * layout is a bug nobody would think to look for.
 *
 * `isStandalone` and `useStandalone` are the only definitions; the other two
 * modules delegate here and keep their own public signatures.
 */

export const STANDALONE_QUERY = "(display-mode: standalone)";
export const FULLSCREEN_QUERY = "(display-mode: fullscreen)";

/**
 * The attribute `SHELL_INIT_SCRIPT` puts on `<html>`.
 *
 * This is how the *document* knows it is an installed window, for the things
 * that cannot wait for React: `html[data-standalone]` rules in src/styles.css,
 * and the `theme-color` the head scripts choose. Exported so those readers name
 * the same attribute the script writes, rather than re-typing it.
 */
export const STANDALONE_ATTRIBUTE = "data-standalone";

/**
 * The synchronous answer, for callers that are not React.
 *
 * Three signals, in descending order of modernity, because no single one covers
 * every browser that can install a web app:
 *
 * - `display-mode: standalone` — the standard, and what Android and iOS both
 *   report once the app is on the Home Screen.
 * - `display-mode: fullscreen` — an installed app that asked for fullscreen
 *   instead of standalone. Still not a tab, so it still gets the app shell.
 * - `navigator.standalone` — the legacy iOS flag, still set by older WebKit
 *   builds that predate the media query.
 *
 * Capability checks throughout, never a user-agent sniff: the only honest way to
 * know how a browser is currently displaying a page is to ask it.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  try {
    if (mm?.(STANDALONE_QUERY).matches) return true;
    if (mm?.(FULLSCREEN_QUERY).matches) return true;
  } catch {
    // A stub or a locked-down webview can throw here. The legacy flag below is
    // still worth checking rather than treating an exception as "not installed".
  }
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Tells the caller when the display mode changes.
 *
 * Exported separately from the hook because it is the part that can be tested
 * without a renderer, and because a reader can genuinely move between modes
 * inside one window: Chrome's device toolbar toggles it, and on Android a
 * browser tab can be installed and relaunched. Only the two media queries are
 * watched — `navigator.standalone` is written once at load and never changes.
 */
export function subscribeToDisplayMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mm = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  if (!mm) return () => {};

  const queries: MediaQueryList[] = [];
  try {
    queries.push(mm(STANDALONE_QUERY), mm(FULLSCREEN_QUERY));
  } catch {
    return () => {};
  }
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

/**
 * The hook the shells read.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because the effect
 * version paints one frame of the wrong chrome: state would start at the server
 * value and only flip after the browser's first paint, which on a cold launch is
 * a website sidebar appearing and vanishing. This returns the real answer on the
 * first client render.
 *
 * That is only safe because **the dashboard shell never renders during SSR** —
 * `DashboardGuard` returns a whole-screen loader until the session resolves, and
 * the session lives in browser storage, so the server has nobody to render for.
 * The server snapshot below exists to keep that honest for any future caller
 * that *is* server-rendered: it reports "not installed", which is the correct
 * answer for a render that has no window.
 */
export function useStandalone(): boolean {
  return useSyncExternalStore(subscribeToDisplayMode, isStandalone, () => false);
}

/**
 * The same answer, on `<html>`, before the first paint.
 *
 * Source text to inline in <head>, in the same shape and for the same reason as
 * `THEME_INIT_SCRIPT` in src/lib/theme.ts: it must run before the body is
 * parsed. React can pick the chrome, but CSS cannot wait for React — rules that
 * have to apply to the document itself (`overscroll-behavior`, the ink behind
 * the status bar) key off this attribute, and a stylesheet that arrives after
 * the first paint is a flash of the wrong thing on the one screen the reader
 * opened deliberately.
 *
 * Unconditional in the sense that it only ever *adds* the attribute: a browser
 * that is not installed gets nothing, which is what every `[data-standalone]`
 * rule assumes.
 */
export const SHELL_INIT_SCRIPT = `(function(){try{var m=window.matchMedia,s=(typeof m==="function"&&(m(${JSON.stringify(
  STANDALONE_QUERY,
)}).matches||m(${JSON.stringify(
  FULLSCREEN_QUERY,
)}).matches))||navigator.standalone===true;if(s)document.documentElement.setAttribute(${JSON.stringify(
  STANDALONE_ATTRIBUTE,
)},"true")}catch(e){}})();`;
