import { useSyncExternalStore } from "react";

/**
 * Whether the browser believes it has a network.
 *
 * `navigator.onLine` is famously optimistic — it reports true behind a captive
 * portal and true on a wifi network with no route to the internet — so this is
 * never allowed to be the only reason something is or is not fetched. It is used
 * for two things that are safe when it is wrong in that direction:
 *
 * - The offline strip, which is a caption about the copy on screen. A wrong
 *   caption is a wrong caption.
 * - `withOfflineFallback`'s shortcut: when it says offline, the archive is read
 *   first and no request is made. If it is wrong, the saved copy shows and the
 *   next visit has a network again — the opposite mistake, treating a live
 *   connection as offline, is the one that would matter, and it cannot happen
 *   because nothing here ever asserts "online, therefore fine" without trying.
 *
 * Unknown environments (the server, a test) report online, so nothing that
 * depends on a network is skipped where there is no way to know.
 */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function subscribeToNetwork(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The hook the strip uses. Server snapshot is "online": a render with no window is not offline. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeToNetwork, isOnline, () => true);
}
