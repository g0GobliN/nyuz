import { isStandalone } from "@/lib/display-mode";

/** Random installation identity, stable across login and token refresh. No fingerprint. */
const KEY = "nyuz.install-id";

export function installId(): string {
  const existing = localStorage.getItem(KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(KEY, id);
  return id;
}

export function rememberInstallId(id: string) {
  localStorage.setItem(KEY, id);
}

/**
 * A useful label for the reader's device list, without collecting a fingerprint.
 *
 * This is deliberately coarse: OS family, browser family, and whether the app
 * is running as an installed PWA are enough to recognise a session without
 * storing the full user agent or a device model on the server.
 *
 * ---------------------------------------------------------------------------
 * What could not be identified is left out, not filled in
 * ---------------------------------------------------------------------------
 *
 * An Apple device running the app from the Home Screen sends **no browser token
 * at all**. iOS strips both `Version/…` and `Safari/…` from the user agent in a
 * standalone window, leaving `… AppleWebKit/605.1.15 (KHTML, like Gecko)
 * Mobile/15E148`. Filling that gap with the word this function uses to mean "I
 * don't know" put a browser called *Browser* in the middle of the reader's own
 * device list — "iPhone · Browser · PWA", reported by the installed app about
 * itself. The parts that were identified are now joined, and the placeholder
 * survives only as the whole name, when nothing at all was identified.
 *
 * Naming Safari in that gap would be a guess in a different direction: iOS 17.4
 * lets a Home Screen app be added and run by a browser other than Safari, and
 * the stripped user agent is identical either way. "iPhone · PWA" says only what
 * is certain — which device, and that this is the installed app, not a tab.
 *
 * A string is the label the *client* chose, so nothing here can rename rows that
 * already exist: a device takes its new name the next time that installation
 * registers. A reader who retires a device before then keeps the old name on
 * that row until they remove it.
 */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Browser";

  const ua = navigator.userAgent ?? "";
  const standalone = isStandalone();

  let operatingSystem: string | null = null;
  if (/iPhone|iPod/i.test(ua)) operatingSystem = "iPhone";
  else if (
    /iPad/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    operatingSystem = "iPad";
  } else if (/Android/i.test(ua)) {
    operatingSystem = "Android";
  } else if (/Windows/i.test(ua)) {
    operatingSystem = "Windows";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    operatingSystem = "macOS";
  } else if (/Linux/i.test(ua)) {
    operatingSystem = "Linux";
  }

  let browser: string | null = null;
  if (/EdgiOS|EdgA|Edg\//i.test(ua)) browser = "Edge";
  else if (/OPiOS|OPR\//i.test(ua)) browser = "Opera";
  else if (/FxiOS|Firefox\//i.test(ua)) browser = "Firefox";
  else if (/SamsungBrowser\//i.test(ua)) browser = "Samsung Internet";
  else if (/CriOS|Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  const parts = [operatingSystem, browser, standalone ? "PWA" : null].filter(
    (part): part is string => part !== null,
  );
  return parts.join(" · ") || "Browser";
}
