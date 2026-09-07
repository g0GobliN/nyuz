import { deletePushSubscription, savePushSubscription } from "@/lib/server/push/account";

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

function keyB64(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Whether this browser can show push notifications.
 *
 * Pure capability detection — no user-agent or OS-version tests. Apple has
 * shipped Web Push for Home Screen web apps since iOS 16.4, and the only
 * honest way to know whether a given WebKit build has it is to look for the
 * APIs themselves.
 *
 * `PushManager` is a Window global, not a Navigator property. Testing
 * `"PushManager" in navigator` is false in every browser ever shipped, which
 * is what previously made every environment resolve to unsupported.
 */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator === "undefined") return false;
  // Push requires a secure context. Localhost counts as one, so this does not
  // get in the way of development.
  if (window.isSecureContext === false) return false;
  if (!("Notification" in window)) return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!("PushManager" in window)) return false;
  return true;
}

/**
 * Whether the browser can show notifications at all (even non-push ones).
 *
 * Used to give a better message on browsers where PushManager is missing but
 * Notification is available — the user can still receive email and Telegram,
 * just not browser push.
 */
export function notificationsAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return "Notification" in window;
}

/**
 * Whether the browser is an iOS WebKit browser (Chrome on iOS, Safari).
 *
 * Used only for UX messaging — to explain the Home Screen requirement Apple
 * actually imposes. Feature detection via `pushSupported()` is the
 * authoritative gate for whether the toggle does anything.
 */
export function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return (
    /iP(hone|od|ad)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Whether the app is running as a Home Screen–installed web app.
 *
 * iOS exposes the push APIs only to standalone web apps, not to browser tabs,
 * so this is what separates "add to Home Screen" from "not supported here."
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  if (mm?.("(display-mode: standalone)").matches) return true;
  if (mm?.("(display-mode: fullscreen)").matches) return true;
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Current notification permission, or "unavailable" when there is no API. */
export function pushPermission(): NotificationPermission | "unavailable" {
  if (typeof window === "undefined") return "unavailable";
  if (!("Notification" in window)) return "unavailable";
  return Notification.permission;
}

/**
 * Why push cannot be offered here, or null when it can.
 *
 * `ios-needs-install` is the one place the OS matters: on iOS the APIs are
 * genuinely absent in a browser tab and genuinely present once the app is on
 * the Home Screen, so an unsupported iOS tab is an instruction, not a dead end.
 */
export type PushBlock = "ios-needs-install" | "insecure-context" | "unsupported";

export function pushBlock(
  supported = pushSupported(),
  ios = isIOS(),
  standalone = isStandalone(),
  // On the server there is no context to judge, so it must not read as an
  // https problem — the render there is a placeholder either way.
  secure = typeof window === "undefined" ? true : window.isSecureContext !== false,
): PushBlock | null {
  if (supported) return null;
  if (ios && !standalone) return "ios-needs-install";
  if (!secure) return "insecure-context";
  return "unsupported";
}

const BLOCK_MESSAGES: Record<PushBlock, string> = {
  "ios-needs-install":
    "Push notifications require adding Nyuz to your Home Screen. Open it from there to enable them.",
  "insecure-context": "Push notifications need a secure (https) connection.",
  unsupported: "This browser cannot show notifications. Use email or Telegram instead.",
};

export function pushBlockMessage(block: PushBlock): string {
  return BLOCK_MESSAGES[block];
}

/**
 * Everything the capability checks actually resolved to on this device.
 *
 * Temporary diagnostics: rendered on the Delivery page in development, or on
 * any build with `?pushdebug=1`, so an unexpected "unsupported" can be read
 * off the device that produced it instead of guessed at.
 */
export type PushDiagnostics = Record<string, string | boolean>;

export function pushDiagnostics(): PushDiagnostics {
  if (typeof window === "undefined") return { environment: "server" };
  const nav = typeof navigator === "undefined" ? null : navigator;
  const mm = typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  return {
    isSecureContext: window.isSecureContext !== false,
    protocol: window.location?.protocol ?? "?",
    "Notification in window": "Notification" in window,
    "PushManager in window": "PushManager" in window,
    "serviceWorker in navigator": nav ? "serviceWorker" in nav : false,
    "display-mode: standalone": mm?.("(display-mode: standalone)").matches ?? false,
    "display-mode: fullscreen": mm?.("(display-mode: fullscreen)").matches ?? false,
    "navigator.standalone": String(
      (nav as (Navigator & { standalone?: boolean }) | null)?.standalone,
    ),
    isIOS: isIOS(),
    isStandalone: isStandalone(),
    pushSupported: pushSupported(),
    permission: pushPermission(),
    block: pushBlock() ?? "none",
    userAgent: nav?.userAgent ?? "?",
  };
}

/**
 * Register the service worker and return its registration, handling
 * the case where it is already controlled.
 */
async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await reg.update();
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

/**
 * Why enabling push failed, so the caller can say something true about it
 * rather than collapsing every failure into one sentence.
 */
export type PushFailure =
  | PushBlock
  | "permission-denied"
  | "permission-dismissed"
  | "service-worker"
  | "subscribe-failed"
  | "save-failed";

export type EnablePushResult =
  { ok: true } | { ok: false; reason: PushFailure; error: string; detail?: string };

/**
 * Ask for permission and register the subscription.
 *
 * Must be called straight from the toggle's click handler: the permission
 * prompt needs the user gesture, and WebKit drops the gesture across an await,
 * so nothing asynchronous may run before `requestPermission`.
 */
export async function enablePush(publicKey: string): Promise<EnablePushResult> {
  const block = pushBlock();
  if (block) return { ok: false, reason: block, error: pushBlockMessage(block) };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (error) {
    return {
      ok: false,
      reason: "permission-dismissed",
      error: "The browser did not answer the permission request. Try again.",
      detail: String(error),
    };
  }
  if (permission === "denied") {
    return {
      ok: false,
      reason: "permission-denied",
      error: "Notifications are blocked for Nyuz. Allow them in the system settings, then retry.",
    };
  }
  if (permission !== "granted") {
    return {
      ok: false,
      reason: "permission-dismissed",
      error: "Notifications were not allowed yet. Tap the toggle again to ask once more.",
    };
  }

  const reg = await getServiceWorkerRegistration();
  if (!reg) {
    return {
      ok: false,
      reason: "service-worker",
      error: "Could not start the notification service worker. Reload the page and try again.",
    };
  }

  let sub: PushSubscription;
  try {
    const ready = await navigator.serviceWorker.ready;
    sub = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  } catch (error) {
    // Only reachable after permission was granted, so this is a push service or
    // VAPID key problem, not a user decision. Previously this rejection escaped
    // enablePush entirely and surfaced as an unhandled promise rejection.
    return {
      ok: false,
      reason: "subscribe-failed",
      error: "Notifications were allowed, but this device could not be registered. Try again.",
      detail: String(error),
    };
  }

  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (!endpoint || !p256dh || !auth) {
    return {
      ok: false,
      reason: "subscribe-failed",
      error: "The browser did not return a complete push subscription.",
    };
  }

  try {
    await savePushSubscription({ data: { endpoint, keys: { p256dh, auth } } });
  } catch (error) {
    return {
      ok: false,
      reason: "save-failed",
      error: "This device was registered but could not be saved. Try again in a moment.",
      detail: String(error),
    };
  }
  return { ok: true };
}

/**
 * Whether this browser holds a push subscription of its own.
 *
 * The only honest answer to "are notifications on here". The account's
 * subscription count says nothing about this device, because every browser
 * gets its own endpoint — reading the count instead is what made a phone show
 * the toggle already on because a desktop had subscribed, leaving no way to
 * register the phone at all.
 *
 * Deliberately does not register the service worker: this runs on every
 * Delivery render and only reports. It reads an existing registration or
 * answers null.
 */
export async function getDeviceSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const ready = await navigator.serviceWorker.ready.catch(() => null);
  if (!ready) return null;
  return (await ready.pushManager.getSubscription().catch(() => null)) ?? null;
}

export async function isDeviceSubscribed(): Promise<boolean> {
  return (await getDeviceSubscription()) !== null;
}

/**
 * Unsubscribes this browser, and only this browser.
 *
 * The endpoint is the whole point. Sending none used to be the fallback
 * whenever this device had nothing to unsubscribe, and the server read a
 * missing endpoint as "every row for this user" — so tapping the toggle off on
 * a phone that had never subscribed deleted the desktop's subscription. A
 * device with no subscription now has nothing to delete, which is the truth.
 */
export async function disablePush(): Promise<void> {
  const sub = await getDeviceSubscription();
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe().catch(() => false);
  await deletePushSubscription({ data: { endpoint } });
}

/**
 * Re-save this device's existing endpoint.
 *
 * Runs on every dashboard visit so that if the browser rotated the
 * push endpoint (which happens after browser updates or long idle
 * periods), the server always has a current subscription. Without
 * this, a device that silently rotated its endpoint stops receiving
 * notifications and the server keeps sending to a dead endpoint.
 *
 * A device with no subscription is left alone: "not subscribed here" is a
 * per-device state the reader chose, not a gap to repair.
 */
export async function refreshPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await getServiceWorkerRegistration();
  if (!reg) return;
  const ready = await navigator.serviceWorker.ready;
  // Refresh only. Subscribing here would silently re-enable a device the
  // reader had just turned off — permission stays granted after an
  // unsubscribe, so the toggle would come back on by itself on the next visit.
  const sub = await ready.pushManager.getSubscription();
  if (!sub) return;
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dhBuf = sub.getKey("p256dh");
  const authBuf = sub.getKey("auth");
  const p256dh = json.keys?.["p256dh"] ?? (p256dhBuf ? keyB64(p256dhBuf) : "");
  const auth = json.keys?.["auth"] ?? (authBuf ? keyB64(authBuf) : "");
  if (!endpoint || !p256dh || !auth) return;
  await savePushSubscription({ data: { endpoint, keys: { p256dh, auth } } });
}
