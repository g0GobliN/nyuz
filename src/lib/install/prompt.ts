import { useSyncExternalStore } from "react";

import { isStandalone } from "../display-mode";

/**
 * The browser's install prompt, and whether this device already has Nyuz on its
 * Home Screen.
 *
 * ---------------------------------------------------------------------------
 * Why the event is captured by an inline script
 * ---------------------------------------------------------------------------
 *
 * `beforeinstallprompt` fires once. A browser refuses to offer installation
 * again until its own heuristics allow it, so an event that arrives while the
 * bundle is still downloading is not late — it is gone, and the Install button
 * this module exists to enable silently never appears. On a cold launch on a
 * phone that is a real race: Chrome fires it as soon as the manifest is
 * processed, which can be seconds before the entry chunk has executed.
 *
 * So the listener is attached in `<head>`, by [INSTALL_INIT_SCRIPT] below,
 * before the body is parsed — the same reasoning as `SHELL_INIT_SCRIPT` in
 * src/lib/display-mode.ts, and the same shape. This module reads the event back
 * off the global the script parked it on.
 *
 * The window global is deliberately untyped and unvalidated on the way in: any
 * script could put anything there. `runInstallPrompt` therefore treats a
 * failure to prompt as "unavailable" rather than assuming the object is one, and
 * the UI only ever offers an Install button when `promptAvailable` is true.
 *
 * ---------------------------------------------------------------------------
 * What this module will not claim
 * ---------------------------------------------------------------------------
 *
 * There is no "is Nyuz installed on this device" API that works everywhere.
 * `isStandalone()` answers for the window the reader is in, not for the device:
 * an iPhone with Nyuz already on its Home Screen, opened in Safari, reports
 * false, and iOS has no `appinstalled` event and no way to ask. What is left is
 * memory — an installed launch, or an `appinstalled` event, writes a marker — so
 * a reader who is already installed sees "already on your Home Screen" rather
 * than being taught how to install something they installed last week. Where
 * that memory is absent (a different browser, or storage that iOS does not share
 * between a Home Screen app and Safari) the worst case is showing the steps
 * again, which is a wasted glance rather than a wrong claim.
 */

/** The deferred event, in the one shape both Chromium and this module agree on. */
export type InstallPromptEvent = {
  prompt: () => Promise<{ outcome: string }>;
  userChoice?: Promise<{ outcome: string }>;
  platforms?: string[];
};

/** Where the inline script parks the event, and this module picks it up. */
export const PROMPT_GLOBAL = "__nyuzInstallPrompt";

/**
 * The ping the inline script sends when it captures an event.
 *
 * Two arrival orders have to work, and only one of them is covered by parking
 * the event on a global:
 *
 * - **Before this module loads** — the parked event is read by the `recompute()`
 *   at the bottom of this file, the first time a snapshot is taken. Nothing else
 *   is needed.
 * - **After React is on the page** — Chrome is free to fire the event at any
 *   moment, including long after mount. Writing to the global cannot update a
 *   React snapshot by itself, and nothing in this module would ever know to look
 *   again, so the Install button would simply never appear. Hence a plain DOM
 *   event the script dispatches and `attachInstallEvents` listens for.
 *
 * A plain `Event`, not a `CustomEvent` carrying the prompt: the event object
 * stays on the global, and one source of truth is enough.
 */
export const INSTALL_EVENT = "nyuz:installprompt";

/**
 * The marker that says Nyuz is on this device's Home Screen.
 *
 * Written by the inline script on `appinstalled` and by this module when a
 * launch is standalone. `src/lib/install/prompt.test.ts` runs the script and
 * asserts it writes this exact key, the same way src/lib/sw.test.ts holds the
 * worker's copy of `SW_CACHE` to `sw-config.ts`.
 */
export const INSTALLED_KEY = "nyuz.installed-here";

/**
 * The listener that has to exist before the bundle does.
 *
 * `preventDefault()` is not optional: without it Chromium shows its own
 * mini-infobar and treats the prompt as consumed, and our button would then have
 * nothing left to call. Wrapped in try/catch because a locked-down webview can
 * throw on any of this, and an exception here would take the rest of the head
 * with it.
 */
export const INSTALL_INIT_SCRIPT = `(function(){try{window.addEventListener("beforeinstallprompt",function(e){try{e.preventDefault()}catch(x){};window[${JSON.stringify(
  PROMPT_GLOBAL,
)}]=e;try{window.dispatchEvent(new Event(${JSON.stringify(
  INSTALL_EVENT,
)}))}catch(x){}});window.addEventListener("appinstalled",function(){try{localStorage.setItem(${JSON.stringify(
  INSTALLED_KEY,
)},"1")}catch(x){}})}catch(e){}})();`;

let installedThisSession = false;
let attached = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * The window, as a bag with one extra global in it.
 *
 * Cast through `unknown` because `Window` has no string index signature and the
 * global the head script parks the event on is not part of any DOM type — it is
 * ours. The key is never re-typed here; [PROMPT_GLOBAL] is read from this object
 * by name at every use, so there is one definition of it.
 */
function browserWindow(): (Window & Record<string, unknown>) | null {
  return typeof window === "undefined"
    ? null
    : (window as unknown as Window & Record<string, unknown>);
}

/** The event the head script captured, if it captured one. */
function deferredPrompt(): InstallPromptEvent | null {
  const win = browserWindow();
  const event = win?.[PROMPT_GLOBAL];
  if (!event || typeof event !== "object") return null;
  // Called once, and by us. A captured event that cannot prompt is not "an
  // available prompt" — treating it as one would draw a button that does
  // nothing, which is exactly what this module refuses to do.
  return typeof (event as InstallPromptEvent).prompt === "function"
    ? (event as InstallPromptEvent)
    : null;
}

function readMarker(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    // Private modes refuse to read. Unknown means "not known to be installed",
    // which errs toward showing the offer rather than silently withholding it.
    return false;
  }
}

/**
 * Whether this device is known to have Nyuz on its Home Screen.
 *
 * Three sources, any of which is enough: the window is standalone right now, the
 * marker is stored, or an `appinstalled` event was seen in this session. None of
 * them is proof of the opposite when they are absent — see the header.
 */
export function installedHere(): boolean {
  if (installedThisSession) return true;
  if (isStandalone()) return true;
  return readMarker();
}

/** Called on `appinstalled`, and on any standalone launch. */
export function markInstalled(): void {
  installedThisSession = true;
  try {
    localStorage.setItem(INSTALLED_KEY, "1");
  } catch {
    /* Private modes refuse to store; the in-memory flag still covers this session. */
  }
  emit();
}

/**
 * Listen for `appinstalled`, which is the only live signal there is.
 *
 * Called once from the root route, after mount. Deliberately not a module-scope
 * side effect: the event fires in response to an install that this app either
 * started (so the module is already loaded and mounted) or that the browser
 * started on its own (where the marker is written by the inline script, and the
 * UI would only be confirming something the reader just did by hand).
 */
export function attachInstallEvents(): void {
  if (attached) return;
  const win = browserWindow();
  if (!win || typeof win.addEventListener !== "function") return;
  attached = true;
  win.addEventListener("appinstalled", () => markInstalled());
  // A prompt that arrived after mount. See INSTALL_EVENT: without this, an event
  // Chrome fires late would be parked on the global and never noticed.
  win.addEventListener(INSTALL_EVENT, () => {
    recompute();
    emit();
  });
  // A launch that is already standalone is proof, and worth remembering for the
  // next time this device opens a browser tab.
  if (isStandalone()) markInstalled();
}

/**
 * What the surfaces read.
 *
 * A cached object rather than a fresh one per call, because `useSyncExternalStore`
 * compares snapshots by identity: returning a new object each time would re-render
 * on every notification and, worse, loop. `emit()` recomputes it.
 */
export type InstallFacts = {
  /** A deferred prompt is in hand, so a real Install button can be shown. */
  promptAvailable: boolean;
  /** Nyuz is known to be on this device's Home Screen. */
  installed: boolean;
};

let snapshot: InstallFacts = { promptAvailable: false, installed: false };

function recompute(): void {
  snapshot = { promptAvailable: deferredPrompt() !== null, installed: installedHere() };
}

recompute();

export function installFacts(): InstallFacts {
  return snapshot;
}

export function subscribeToInstall(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function useInstallFacts(): InstallFacts {
  return useSyncExternalStore(subscribeToInstall, installFacts, installFacts);
}

/** What asking the browser to install resulted in. */
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/**
 * Show the browser's install prompt, if one was captured.
 *
 * The captured event is single-use: its own documentation is that `prompt()` can
 * be called once and the event must then be discarded. So it is cleared before
 * the await, which also means the Install button disappears while the browser's
 * dialog is up — the honest state, since there is nothing left to call.
 *
 * The outcome is never inferred from `userChoice` alone: on some Chromium builds
 * `prompt()` resolves with the answer and `userChoice` is absent, on others the
 * reverse. Both are awaited, and a browser that answers neither is reported as
 * unavailable rather than as a dismissal the reader never made.
 */
export async function runInstallPrompt(): Promise<InstallOutcome> {
  const win = browserWindow();
  const event = deferredPrompt();
  if (!win || !event) return "unavailable";

  delete win[PROMPT_GLOBAL];
  recompute();
  emit();

  try {
    const answer = await event.prompt();
    const choice = await (event.userChoice?.catch(() => null) ?? null);
    const outcome = choice?.outcome ?? answer?.outcome;
    if (outcome === "accepted" || outcome === "dismissed") return outcome;
  } catch {
    /* Falls through to "unavailable": the browser did not complete the prompt. */
  }
  return "unavailable";
}
