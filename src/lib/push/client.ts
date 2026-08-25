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

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export async function enablePush(publicKey: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) {
    return { ok: false, error: "This browser cannot show notifications." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notifications were blocked. Allow them in the browser settings." };
  }

  const reg = await navigator.serviceWorker.register("/sw.js");
  await reg.update();
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

/** Refresh the stored endpoint when the reader already allowed notifications. */
export async function refreshPush(publicKey: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.register("/sw.js");
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
