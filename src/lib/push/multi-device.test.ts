import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One account, several browsers.
 *
 * ---------------------------------------------------------------------------
 * The bug these pin
 * ---------------------------------------------------------------------------
 *
 * The Notifications toggle read `prefs.channels.push`, an account preference
 * that every browser downloads from the account. So a desktop subscribing set
 * the preference, and a phone opening Nyuz afterwards rendered the toggle
 * already on — while holding no PushSubscription of its own and receiving
 * nothing. There was no way to turn it on, because it already looked on.
 *
 * Tapping it off then made it worse: `disablePush()` fell back to sending no
 * endpoint when this browser had nothing to unsubscribe, and the server read a
 * missing endpoint as "every row for this user", so the phone deleted the
 * desktop's subscription. Exactly one device could be subscribed at a time.
 *
 * The fix is that the toggle asks this browser's own PushManager, and a delete
 * always names an endpoint. These tests walk the two-device sequence that used
 * to be impossible.
 */

const savePushSubscription = vi.fn();
const deletePushSubscription = vi.fn();

vi.mock("@/lib/server/push/account", () => ({
  savePushSubscription: (...args: unknown[]) => savePushSubscription(...args),
  deletePushSubscription: (...args: unknown[]) => deletePushSubscription(...args),
}));

const { disablePush, enablePush, isDeviceSubscribed, refreshPush } =
  await import("@/lib/push/client");
const { pushDetail } = await import("@/lib/push/device-state");

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkFZ2UU1SC0";

/** One browser's endpoint, and the subscription object it hands back. */
function subscription(endpoint: string) {
  const sub = {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    getKey: () => null,
    unsubscribe: vi.fn(async () => true),
  };
  return sub;
}

type Device = ReturnType<typeof subscription> | null;

/**
 * Puts one browser in front of the code under test.
 *
 * `held` is what this browser's PushManager currently has, which is the whole
 * question — a second browser is simply another call to this with its own
 * value, because nothing about one device is stored in the other.
 */
function stubBrowser({
  held = null as Device,
  permission = "granted" as NotificationPermission,
  onSubscribe,
}: {
  held?: Device;
  permission?: NotificationPermission;
  onSubscribe?: () => ReturnType<typeof subscription>;
} = {}) {
  let current = held;
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async () => {
      current = onSubscribe ? onSubscribe() : subscription("https://push.example/new");
      return current;
    },
  };
  const notification = {
    permission,
    requestPermission: () => Promise.resolve(permission),
  };
  vi.stubGlobal("window", {
    isSecureContext: true,
    location: { protocol: "https:", search: "" },
    matchMedia: () => ({ matches: false }),
    Notification: notification,
    PushManager: function PushManager() {},
  });
  vi.stubGlobal("Notification", notification);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0",
    platform: "Win32",
    maxTouchPoints: 0,
    serviceWorker: {
      register: async () => ({ update: async () => {} }),
      ready: Promise.resolve({ pushManager }),
    },
  });
  return {
    pushManager,
    get current() {
      return current;
    },
  };
}

beforeEach(() => {
  savePushSubscription.mockReset().mockResolvedValue(undefined);
  deletePushSubscription.mockReset().mockResolvedValue({ ok: true, count: 0 });
  vi.stubGlobal("atob", (s: string) => Buffer.from(s, "base64").toString("binary"));
});
afterEach(() => vi.unstubAllGlobals());

const PC = "https://push.example/pc";
const PHONE = "https://push.example/phone";

describe("the toggle reflects this device, not the account", () => {
  it("shows off on a phone while the account already has a subscribed desktop", async () => {
    // The reported bug, at its source. The desktop is subscribed, so the
    // account count is 1 — and this browser still holds nothing, so the
    // toggle must be off and the phone must be able to turn it on.
    stubBrowser({ held: null, permission: "default" });
    expect(await isDeviceSubscribed()).toBe(false);
    expect(
      pushDetail(
        { deviceSubscribed: false, accountDevices: 1, permission: "default", configured: true },
        null,
      ),
    ).toContain("Off on this device · 1 other device subscribed");
  });

  it("shows on for the desktop that is subscribed, at the same count", async () => {
    stubBrowser({ held: subscription(PC) });
    expect(await isDeviceSubscribed()).toBe(true);
    expect(
      pushDetail(
        { deviceSubscribed: true, accountDevices: 1, permission: "granted", configured: true },
        null,
      ),
    ).toContain("On on this device");
  });

  it("shows both devices on once the phone subscribes too", async () => {
    // Same account state (two devices) read from each browser in turn. Both
    // are on, because each holds its own subscription.
    stubBrowser({ held: subscription(PC) });
    expect(await isDeviceSubscribed()).toBe(true);
    const desktop = pushDetail(
      { deviceSubscribed: true, accountDevices: 2, permission: "granted", configured: true },
      null,
    );

    stubBrowser({ held: subscription(PHONE) });
    expect(await isDeviceSubscribed()).toBe(true);
    const phone = pushDetail(
      { deviceSubscribed: true, accountDevices: 2, permission: "granted", configured: true },
      null,
    );

    expect(desktop).toContain("On on this device · 1 other device subscribed");
    expect(phone).toBe(desktop);
  });

  it("does not count the current device as one of the others", () => {
    // "3 devices subscribed" while standing on one of them reads as three
    // more somewhere else.
    expect(
      pushDetail(
        { deviceSubscribed: true, accountDevices: 3, permission: "granted", configured: true },
        null,
      ),
    ).toContain("2 other devices subscribed");
    expect(
      pushDetail(
        { deviceSubscribed: true, accountDevices: 1, permission: "granted", configured: true },
        null,
      ),
    ).toContain("the only one subscribed");
    expect(
      pushDetail(
        { deviceSubscribed: false, accountDevices: 0, permission: "default", configured: true },
        null,
      ),
    ).not.toMatch(/other device/);
  });
});

describe("enabling registers this browser without touching the others", () => {
  it("saves the phone's own endpoint when the desktop is already subscribed", async () => {
    stubBrowser({ held: null, onSubscribe: () => subscription(PHONE) });

    await expect(enablePush(KEY)).resolves.toEqual({ ok: true });

    // A save, never a delete: registering here says nothing about the desktop.
    expect(savePushSubscription).toHaveBeenCalledWith({
      data: { endpoint: PHONE, keys: { p256dh: "p", auth: "a" } },
    });
    expect(deletePushSubscription).not.toHaveBeenCalled();
  });

  it("re-enables a desktop that opted out while the phone stays subscribed", async () => {
    // Step four of the reproduction: after the desktop turned itself off, it
    // subscribes again and lands on its own row.
    stubBrowser({ held: null, onSubscribe: () => subscription(PC) });
    await expect(enablePush(KEY)).resolves.toEqual({ ok: true });
    expect(savePushSubscription).toHaveBeenCalledWith({
      data: { endpoint: PC, keys: { p256dh: "p", auth: "a" } },
    });
    expect(deletePushSubscription).not.toHaveBeenCalled();
  });
});

describe("disabling removes one endpoint", () => {
  it("deletes only the endpoint this browser holds", async () => {
    const sub = subscription(PC);
    stubBrowser({ held: sub });

    await disablePush();

    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(deletePushSubscription).toHaveBeenCalledTimes(1);
    expect(deletePushSubscription).toHaveBeenCalledWith({ data: { endpoint: PC } });
  });

  it("deletes nothing when this browser has no subscription of its own", async () => {
    // The exact call that used to wipe the account: a phone that had never
    // subscribed tapping the toggle off sent no endpoint, and the server read
    // that as every row for the user.
    stubBrowser({ held: null });

    await disablePush();

    expect(deletePushSubscription).not.toHaveBeenCalled();
  });

  it("deletes nothing on a browser that cannot do push at all", async () => {
    vi.stubGlobal("window", { isSecureContext: true, matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0", platform: "Win32" });

    await disablePush();

    expect(deletePushSubscription).not.toHaveBeenCalled();
  });

  it("never sends a delete without an endpoint", () => {
    // Belt and braces on the two tests above: no call shape in the client can
    // reach the account-wide branch, because there no longer is one.
    const client = readFileSync("src/lib/push/client.ts", "utf8");
    expect(client).not.toMatch(/deletePushSubscription\(\{\s*data:\s*\{\s*\}\s*\}\)/);
    expect(client).toContain("deletePushSubscription({ data: { endpoint } })");
  });
});

describe("a disabled device stays disabled", () => {
  it("does not resubscribe on the dashboard's refresh pass", async () => {
    // `refreshPush` runs on every dashboard mount and used to subscribe when
    // it found nothing, so a device turned off would come back on by itself:
    // revoking a subscription does not revoke permission, and permission was
    // all it checked.
    stubBrowser({ held: null, permission: "granted" });

    await refreshPush();

    expect(savePushSubscription).not.toHaveBeenCalled();
  });

  it("still re-saves an endpoint this device does hold", async () => {
    stubBrowser({ held: subscription(PC), permission: "granted" });

    await refreshPush();

    expect(savePushSubscription).toHaveBeenCalledWith({
      data: { endpoint: PC, keys: { p256dh: "p", auth: "a" } },
    });
  });
});

describe("the account stores one row per device", () => {
  const account = readFileSync("src/lib/server/push/account.ts", "utf8");

  it("keys rows on the endpoint, so a second device cannot replace the first", () => {
    // `onConflict: "user_id"` here would be the same bug in the database:
    // the phone's save would overwrite the desktop's row.
    expect(account).toContain('onConflict: "endpoint"');
    expect(account).not.toMatch(/onConflict:\s*"user_id"/);

    const sql = readFileSync("supabase/migrations/0014_push.sql", "utf8");
    expect(sql).toMatch(/endpoint\s+text\s+unique\s+not\s+null/);
    // A unique user_id would cap the account at one device.
    expect(sql).not.toMatch(/user_id\s+uuid\s+unique/);
  });

  it("requires an endpoint to delete, and filters on it", () => {
    // The validator used to mark `endpoint` optional and the handler applied
    // the filter only `if (data.endpoint)`, leaving a delete scoped to
    // `user_id` alone — every device, from one device's toggle.
    expect(account).toContain("z.object({ endpoint: z.string().max(2048) }).parse(input)");
    expect(account).not.toMatch(/endpoint:\s*z\.string\(\)\.max\(2048\)\.optional\(\)/);
    expect(account).toMatch(
      /\.delete\(\)\s*\.eq\("user_id", context\.actor\.id\)\s*\.eq\("endpoint", data\.endpoint\)/,
    );
  });

  it("does not offer a subscribed flag that a device could mistake for its own", () => {
    // `PushStatus.subscribed` was `count > 0` — an account-wide boolean that
    // read exactly like a per-device one, which is how it ended up driving a
    // per-device toggle. The count is left, and it is only a label.
    expect(account).not.toMatch(/subscribed:/);
    const delivery = readFileSync("src/routes/dashboard/delivery.tsx", "utf8");
    expect(delivery).not.toMatch(/on=\{prefs\.channels\.push\}/);
    expect(delivery).toContain("on={deviceOn}");
  });
});
