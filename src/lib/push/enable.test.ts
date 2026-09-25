vi.mock("../device-install", () => ({
  installId: () => "00000000-0000-4000-8000-000000000001",
  deviceLabel: () => "iPhone · PWA",
}));
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const savePushSubscription = vi.fn();
const deletePushSubscription = vi.fn();

vi.mock("@/lib/server/push/account", () => ({
  savePushSubscription: (...args: unknown[]) => savePushSubscription(...args),
  deletePushSubscription: (...args: unknown[]) => deletePushSubscription(...args),
}));

const { enablePush } = await import("@/lib/push/client");

const SUBSCRIPTION = {
  toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }),
};

/**
 * A modern iPhone running Nyuz from the Home Screen, with the push pipeline
 * stubbed at the two points that can realistically fail: the browser's
 * `subscribe()` and our own save.
 */
function stubIosStandalone({
  permission = "granted" as NotificationPermission | "throw",
  subscribe = async () => SUBSCRIPTION as unknown as PushSubscription,
  register = async () => ({ update: async () => {} }),
} = {}) {
  const notification = {
    permission: permission === "throw" ? "default" : permission,
    requestPermission:
      permission === "throw"
        ? () => Promise.reject(new Error("no gesture"))
        : () => Promise.resolve(permission),
  };
  vi.stubGlobal("window", {
    isSecureContext: true,
    location: { protocol: "https:", search: "" },
    matchMedia: (query: string) => ({ matches: query === "(display-mode: standalone)" }),
    Notification: notification,
    PushManager: function PushManager() {},
  });
  vi.stubGlobal("Notification", notification);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) Version/18.2 Safari/604.1",
    platform: "iPhone",
    maxTouchPoints: 5,
    standalone: true,
    serviceWorker: {
      register,
      ready: Promise.resolve({ pushManager: { subscribe } }),
    },
  });
}

// A valid base64url VAPID public key is not needed for these paths; only the
// decoder has to accept it.
const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkFZ2UU1SC0";

describe("enablePush", () => {
  beforeEach(() => {
    savePushSubscription.mockReset().mockResolvedValue(undefined);
    deletePushSubscription.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("atob", (s: string) => Buffer.from(s, "base64").toString("binary"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("subscribes and saves on a modern iOS Home Screen web app", async () => {
    stubIosStandalone();
    await expect(enablePush(KEY)).resolves.toEqual({ ok: true });
    expect(savePushSubscription).toHaveBeenCalledWith({
      data: {
        installId: "00000000-0000-4000-8000-000000000001",
        label: "iPhone · PWA",
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
      },
    });
  });

  it("reports permission-denied without saving anything", async () => {
    stubIosStandalone({ permission: "denied" });
    const result = await enablePush(KEY);
    expect(result).toMatchObject({ ok: false, reason: "permission-denied" });
    expect(savePushSubscription).not.toHaveBeenCalled();
  });

  it("reports a dismissed prompt separately from a denial", async () => {
    stubIosStandalone({ permission: "default" });
    expect(await enablePush(KEY)).toMatchObject({ ok: false, reason: "permission-dismissed" });
  });

  it("does not let a rejected requestPermission escape", async () => {
    stubIosStandalone({ permission: "throw" });
    expect(await enablePush(KEY)).toMatchObject({ ok: false, reason: "permission-dismissed" });
  });

  it("does not let a failed pushManager.subscribe() escape uncaught", async () => {
    stubIosStandalone({
      subscribe: () => Promise.reject(new Error("AbortError: push service error")),
    });
    const result = await enablePush(KEY);
    expect(result).toMatchObject({ ok: false, reason: "subscribe-failed" });
    if (result.ok) throw new Error("unreachable");
    expect(result.detail).toContain("push service error");
    expect(savePushSubscription).not.toHaveBeenCalled();
  });

  it("reports a service worker that will not register", async () => {
    stubIosStandalone({ register: () => Promise.reject(new Error("404")) });
    expect(await enablePush(KEY)).toMatchObject({ ok: false, reason: "service-worker" });
  });

  it("distinguishes a backend save failure from a subscription failure", async () => {
    stubIosStandalone();
    savePushSubscription.mockRejectedValue(new Error("500"));
    expect(await enablePush(KEY)).toMatchObject({ ok: false, reason: "save-failed" });
  });

  it("reports an incomplete subscription rather than saving a partial row", async () => {
    stubIosStandalone({
      subscribe: async () =>
        ({
          toJSON: () => ({ endpoint: "https://push.example/abc" }),
        }) as unknown as PushSubscription,
    });
    expect(await enablePush(KEY)).toMatchObject({ ok: false, reason: "subscribe-failed" });
    expect(savePushSubscription).not.toHaveBeenCalled();
  });

  it("asks an uninstalled iPhone to install instead of attempting a subscribe", async () => {
    stubIosStandalone();
    vi.stubGlobal("window", {
      isSecureContext: true,
      location: { protocol: "https:", search: "" },
      matchMedia: () => ({ matches: false }),
      Notification: { permission: "default" },
      // WebKit hides PushManager from browser tabs.
    });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) Version/18.2 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
      serviceWorker: {},
    });
    expect(await enablePush(KEY)).toMatchObject({ ok: false, reason: "ios-needs-install" });
  });
});
