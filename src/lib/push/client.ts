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
 * iOS Chrome and Safari both use WebKit, which does not expose the
 * PushManager API. The check must be strict about that: a browser that
 * supports Notification and serviceWorker but not PushManager cannot
 * receive push deliveries, so we must not offer the toggle.
 */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!("PushManager" in navigator)) return false;
  return true;
}

/**
 * Whether the browser can show notifications at all (even non-push ones).
 *
 * Used to give a better message on iOS Chrome, where PushManager is
 * missing but Notification is available — the user can still receive
 * email and Telegram, just not browser push.
 */
export function notificationsAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return "Notification" in window;
}

/**
 * Whether the browser is an iOS WebKit browser (Chrome on iOS, Safari).
 *
 * Used only for UX messaging. Feature detection via `pushSupported()` is
 * the authoritative gate for whether the toggle is offered.
 */
export function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iP(hone|od|ad)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Whether the app is running as a Home Screen–installed web app.
 *
 * iOS 16.4+ exposes the PushManager API only to standalone web apps, not
 * to browser tabs. This lets the UX distinguish "add to Home Screen"
 * from "not supported on this device."
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Register the service worker and return its registration, handling
 * the case where it is already controlled.
 */
async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
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
 * Pure branch-selection for the iOS/unavailable-browser UX.
 *
 * Returns the message the user should see when push cannot be enabled,
 * or null when push is available and the normal flow should proceed.
 *
 * This is extracted so the four UX branches can be tested without a
 * browser DOM or React component tree.
 */
export function pushEnableUnavailableMessage(
  supported: boolean,
  ios: boolean,
  standalone: boolean,
): string | null {
  if (supported) return null;
  if (ios && !standalone) {
    return "Push notifications require adding Nyuz to your Home Screen. Open it from there to enable them.";
  }
  if (ios && standalone) {
    return "Push notifications are not available on this iOS version. Use email or Telegram instead.";
  }
  return "This browser cannot show notifications. Use email or Telegram instead.";
}

export async function enablePush(publicKey: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) {
    const message = pushEnableUnavailableMessage(false, isIOS(), isStandalone());
    // pushEnableUnavailableMessage returns a string whenever supported
    // is false, so message is never null here.
    return { ok: false, error: message! };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notifications were blocked. Allow them in the browser settings." };
  }

  const reg = await getServiceWorkerRegistration();
  if (!reg) {
    return {
      ok: false,
      error: "Could not set up notifications. Please reload the page and try again.",
    };
  }
  const ready = await navigator.serviceWorker.ready;
  const sub = await ready.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  if (!endpoint || !p256dh || !auth) {
    return { ok: false, error: "The browser did not return a push subscription." };
  }
  await savePushSubscription({ data: { endpoint, keys: { p256dh, auth } } });
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) {
    await deletePushSubscription({ data: {} });
    return;
  }
  const ready = await navigator.serviceWorker.ready.catch(() => null);
  const sub = await ready?.pushManager.getSubscription();
  const endpoint = sub?.endpoint;
  await sub?.unsubscribe();
  await deletePushSubscription({ data: endpoint ? { endpoint } : {} });
}

/**
 * Refresh the stored endpoint when the reader already allowed notifications.
 *
 * Runs on every dashboard visit so that if the browser rotated the
 * push endpoint (which happens after browser updates or long idle
 * periods), the server always has a current subscription. Without
 * this, a device that silently rotated its endpoint stops receiving
 * notifications and the server keeps sending to a dead endpoint.
 */
export async function refreshPush(publicKey: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await getServiceWorkerRegistration();
  if (!reg) return;
  const ready = await navigator.serviceWorker.ready;
  let sub = await ready.pushManager.getSubscription();
  if (!sub) {
    sub = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dhBuf = sub.getKey("p256dh");
  const authBuf = sub.getKey("auth");
  const p256dh = json.keys?.["p256dh"] ?? (p256dhBuf ? keyB64(p256dhBuf) : "");
  const auth = json.keys?.["auth"] ?? (authBuf ? keyB64(authBuf) : "");
  if (!endpoint || !p256dh || !auth) return;
  await savePushSubscription({ data: { endpoint, keys: { p256dh, auth } } });
}
