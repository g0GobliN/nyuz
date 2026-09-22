/**
 * Whether the browser is an iOS WebKit browser (Safari, or Chrome/Firefox on
 * iOS, which are all WebKit underneath).
 *
 * Used for UX messaging only — never as a capability test. The two places that
 * care are both instructions rather than gates: iOS exposes the push APIs to
 * Home Screen web apps alone, and iOS has no programmatic install prompt, so
 * "add to Home Screen" is a Share-sheet action rather than a button. Whether an
 * API actually exists is always asked directly, by looking for the API.
 *
 * Here rather than in src/lib/push/client.ts because the install affordance
 * needs the same answer and is not push: that module re-exports this so its own
 * callers keep their imports, in the same way it re-exports `isStandalone` from
 * src/lib/display-mode.ts. Two implementations of a user-agent test is how a
 * phone ends up being told to install for push and simultaneously not told to
 * install at all.
 */
export function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return (
    /iP(hone|od|ad)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
