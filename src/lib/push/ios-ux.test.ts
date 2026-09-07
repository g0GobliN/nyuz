import { describe, expect, it, vi, afterEach } from "vitest";
import {
  pushBlock,
  pushBlockMessage,
  pushPermission,
  pushSupported,
  isIOS,
  isStandalone,
} from "@/lib/push/client";

/**
 * Stub a browser the way a real one is shaped.
 *
 * `PushManager` and `Notification` are Window globals; only `serviceWorker`
 * lives on Navigator. The previous version of this file put `PushManager` on
 * `navigator`, which is a shape no browser has ever had — so `pushSupported()`
 * could return false everywhere while these tests stayed green.
 */
function stubBrowser({
  notification = true,
  pushManager = true,
  serviceWorker = true,
  secure = true,
  standalone = false,
  displayMode = null as string | null,
  permission = "default" as NotificationPermission,
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/120",
  platform = "MacIntel",
  maxTouchPoints = 0,
} = {}) {
  const win: Record<string, unknown> = {
    isSecureContext: secure,
    location: { protocol: secure ? "https:" : "http:", search: "" },
    matchMedia: (query: string) => ({
      matches: query === `(display-mode: ${displayMode})`,
      media: query,
    }),
  };
  if (notification) win["Notification"] = { permission };
  if (pushManager) win["PushManager"] = function PushManager() {};

  const nav: Record<string, unknown> = { userAgent, platform, maxTouchPoints };
  if (serviceWorker) nav["serviceWorker"] = {};
  if (standalone) nav["standalone"] = true;

  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", nav);
  if (notification) vi.stubGlobal("Notification", win["Notification"]);
}

/** A current iPhone running Nyuz from the Home Screen. */
const IOS_STANDALONE = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
  standalone: true,
  displayMode: "standalone",
};

describe("push capability detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("pushSupported", () => {
    it("is true in a normal supported browser", () => {
      stubBrowser();
      expect(pushSupported()).toBe(true);
    });

    it("is true on a modern iOS Home Screen web app", () => {
      stubBrowser(IOS_STANDALONE);
      expect(isIOS()).toBe(true);
      expect(isStandalone()).toBe(true);
      expect(pushSupported()).toBe(true);
      expect(pushBlock()).toBeNull();
    });

    it("does not look for PushManager on navigator", () => {
      // The exact regression: a browser that exposes PushManager only where it
      // really lives must still count as supported.
      stubBrowser();
      expect("PushManager" in navigator).toBe(false);
      expect(pushSupported()).toBe(true);
    });

    it("is false when PushManager is missing", () => {
      stubBrowser({ pushManager: false });
      expect(pushSupported()).toBe(false);
    });

    it("is false when the service worker API is missing", () => {
      stubBrowser({ serviceWorker: false });
      expect(pushSupported()).toBe(false);
    });

    it("is false when Notification is missing", () => {
      stubBrowser({ notification: false });
      expect(pushSupported()).toBe(false);
    });

    it("is false in an insecure context", () => {
      stubBrowser({ secure: false });
      expect(pushSupported()).toBe(false);
    });

    it("is false in non-browser environments", () => {
      vi.stubGlobal("window", undefined);
      vi.stubGlobal("navigator", undefined);
      expect(pushSupported()).toBe(false);
    });
  });

  describe("pushPermission", () => {
    it("reports default before anything has been asked", () => {
      stubBrowser({ ...IOS_STANDALONE, permission: "default" });
      expect(pushPermission()).toBe("default");
    });

    it("reports denied", () => {
      stubBrowser({ ...IOS_STANDALONE, permission: "denied" });
      expect(pushPermission()).toBe("denied");
      // Denied is a permission state, never a capability failure.
      expect(pushSupported()).toBe(true);
      expect(pushBlock()).toBeNull();
    });

    it("reports granted", () => {
      stubBrowser({ ...IOS_STANDALONE, permission: "granted" });
      expect(pushPermission()).toBe("granted");
      expect(pushBlock()).toBeNull();
    });

    it("reports unavailable when there is no Notification API", () => {
      stubBrowser({ notification: false });
      expect(pushPermission()).toBe("unavailable");
    });
  });

  describe("pushBlock", () => {
    it("returns null when push is supported", () => {
      expect(pushBlock(true, false, false, true)).toBeNull();
      expect(pushBlock(true, true, true, true)).toBeNull();
    });

    it("asks an iOS browser tab to install, rather than calling it unsupported", () => {
      expect(pushBlock(false, true, false, true)).toBe("ios-needs-install");
      expect(pushBlockMessage("ios-needs-install")).toContain("Home Screen");
    });

    it("never blames the iOS version when a Home Screen app lacks the APIs", () => {
      // Only reachable on genuinely old iOS. Even then the copy stays generic
      // rather than asserting a version we never detected.
      expect(pushBlock(false, true, true, true)).toBe("unsupported");
      expect(pushBlockMessage("unsupported")).not.toMatch(/iOS/i);
      expect(pushBlockMessage("unsupported")).not.toMatch(/version/i);
    });

    it("names an insecure context for what it is", () => {
      expect(pushBlock(false, false, false, false)).toBe("insecure-context");
      expect(pushBlockMessage("insecure-context")).toContain("https");
    });

    it("falls back to unsupported for other browsers", () => {
      expect(pushBlock(false, false, false, true)).toBe("unsupported");
    });
  });

  describe("isIOS", () => {
    it("returns true for iPhone user agent", () => {
      stubBrowser(IOS_STANDALONE);
      expect(isIOS()).toBe(true);
    });

    it("returns true for iPad user agent", () => {
      stubBrowser({
        userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
        platform: "iPad",
        maxTouchPoints: 5,
      });
      expect(isIOS()).toBe(true);
    });

    it("returns true for iPad desktop-mode user agent (MacIntel + touch)", () => {
      stubBrowser({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      });
      expect(isIOS()).toBe(true);
    });

    it("returns false for desktop user agents", () => {
      stubBrowser({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        maxTouchPoints: 0,
      });
      expect(isIOS()).toBe(false);
    });

    it("returns false for Android user agents", () => {
      stubBrowser({
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      });
      expect(isIOS()).toBe(false);
    });

    it("returns false in non-browser environments", () => {
      vi.stubGlobal("window", undefined);
      vi.stubGlobal("navigator", undefined);
      expect(isIOS()).toBe(false);
    });
  });

  describe("isStandalone", () => {
    it("returns true when display-mode is standalone", () => {
      stubBrowser({ displayMode: "standalone" });
      expect(isStandalone()).toBe(true);
    });

    it("returns true when display-mode is fullscreen", () => {
      stubBrowser({ displayMode: "fullscreen" });
      expect(isStandalone()).toBe(true);
    });

    it("returns true when navigator.standalone is set (legacy iOS)", () => {
      stubBrowser({ standalone: true, displayMode: null });
      expect(isStandalone()).toBe(true);
    });

    it("returns false in a normal browser tab", () => {
      stubBrowser();
      expect(isStandalone()).toBe(false);
    });

    it("returns false in non-browser environments", () => {
      vi.stubGlobal("window", undefined);
      vi.stubGlobal("navigator", undefined);
      expect(isStandalone()).toBe(false);
    });
  });

  describe("an iPhone in Safari, not yet installed", () => {
    it("is told to install rather than that iOS cannot do this", () => {
      // WebKit hides the push APIs from browser tabs, so this is what the
      // reader's phone actually reports before Add to Home Screen.
      stubBrowser({
        userAgent: IOS_STANDALONE.userAgent,
        platform: "iPhone",
        maxTouchPoints: 5,
        pushManager: false,
        standalone: false,
        displayMode: null,
      });
      expect(pushSupported()).toBe(false);
      expect(pushBlock()).toBe("ios-needs-install");
    });
  });
});
