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
 */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Browser";

  const ua = navigator.userAgent ?? "";
  const standalone =
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches)) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  let operatingSystem = "Browser";
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

  let browser = "Browser";
  if (/EdgiOS|EdgA|Edg\//i.test(ua)) browser = "Edge";
  else if (/OPiOS|OPR\//i.test(ua)) browser = "Opera";
  else if (/FxiOS|Firefox\//i.test(ua)) browser = "Firefox";
  else if (/SamsungBrowser\//i.test(ua)) browser = "Samsung Internet";
  else if (/CriOS|Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  return [operatingSystem, browser, ...(standalone ? ["PWA"] : [])].join(" · ");
}
