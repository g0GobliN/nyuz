import { useSyncExternalStore } from "react";
import { SW_SKIP_WAITING, SW_URL } from "@/lib/sw-config";

/**
 * Register the worker at boot, and let the reader decide when it takes over.
 *
 * ---------------------------------------------------------------------------
 * Why the page registers it at all
 * ---------------------------------------------------------------------------
 *
 * Until now the worker was only registered from the push flow — enabling
 * notifications registered it, and nothing else ever did. So a reader who never
 * turned notifications on had no worker at all, which meant no cached shell, no
 * offline start, and no way to see the new version prompt. Registration now
 * happens once, on boot, for everyone.
 *
 * ---------------------------------------------------------------------------
 * Why an update waits, and a human decides
 * ---------------------------------------------------------------------------
 *
 * `public/sw.js` no longer activates itself, because activating mid-session
 * swaps the asset set underneath a running app and can leave a lazily imported
 * chunk missing. Something has to be the trigger, and the honest one is the
 * reader: `applyUpdate` posts the skip-waiting message and reloads once the new
 * worker is controlling the page. A reader who ignores the prompt loses nothing
 * — the update installs anyway, and takes over the next time the app is opened
 * after all its windows are closed.
 */

let registration: ServiceWorkerRegistration | null = null;
let waiting = false;
const listeners = new Set<() => void>();

function announce(next: boolean): void {
  if (waiting === next) return;
  waiting = next;
  for (const listener of listeners) listener();
}

export function subscribeToUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateWaiting(): boolean {
  return waiting;
}

/**
 * Whether a new version is installed and waiting for the reader.
 *
 * The server snapshot is false, so this never renders on the server and cannot
 * disagree with the markup that was sent.
 */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribeToUpdate, updateWaiting, () => false);
}

/**
 * Register, and start watching for a newer worker.
 *
 * Production only. Vite's development server rewrites modules on the fly and
 * serves the same paths with different contents, which is the one environment
 * where a cache-first worker turns every edit into a mystery; and the offline
 * behaviour under test here is a deployed behaviour. The push flow keeps its own
 * registration for the same reason — it is exercised in development, and it
 * needs a controlled worker immediately rather than an update prompt.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!import.meta.env.PROD) return null;
  if (registration) return registration;

  try {
    registration = await navigator.serviceWorker.register(SW_URL, {
      scope: "/",
      // Without this the browser may serve the worker script itself from the
      // HTTP cache for up to 24 hours, so a fixed worker stays broken for a day.
      updateViaCache: "none",
    });
  } catch {
    // A browser that refuses the worker still has a working website. An
    // exception here would take the page down for a feature it does not need.
    return null;
  }

  watch(registration);
  return registration;
}

function watch(reg: ServiceWorkerRegistration): void {
  // A worker already waiting when we looked: the update arrived while this page
  // was open, or on a previous load that never showed the prompt.
  if (reg.waiting && navigator.serviceWorker.controller) announce(true);

  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // `controller` is what separates "a new version replaced an old one" from
      // "this is a first install". On a first install there is no old version
      // to reload away from, and prompting would be noise.
      if (installing.state === "installed" && navigator.serviceWorker.controller) announce(true);
    });
  });
}

/** Hand over to the waiting worker, then reload into it. */
export function applyUpdate(): void {
  const waitingWorker = registration?.waiting;
  if (!waitingWorker) {
    // Nothing waiting — the reader asked to reload, which is still a reasonable
    // thing to want.
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
    once: true,
  });
  waitingWorker.postMessage({ type: SW_SKIP_WAITING });
  announce(false);
}
