import { describe, expect, it, vi, afterEach } from "vitest";
import {
  pushEnableUnavailableMessage,
  pushSupported,
  isIOS,
  isStandalone,
} from "@/lib/push/client";

describe("push UX branch selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("pushEnableUnavailableMessage", () => {
    it("returns null when push is supported (normal flow)", () => {
      expect(pushEnableUnavailableMessage(true, false, false)).toBeNull();
      expect(pushEnableUnavailableMessage(true, true, false)).toBeNull();
      expect(pushEnableUnavailableMessage(true, true, true)).toBeNull();
    });

    it("returns iOS browser-tab message when iOS, not standalone, and unsupported", () => {
      const msg = pushEnableUnavailableMessage(false, true, false);
      expect(msg).toContain("Home Screen");
      expect(msg).not.toContain("PWA");
      expect(msg).not.toContain("PushManager");
    });

    it("returns old-iOS fallback when iOS, standalone, and unsupported", () => {
      const msg = pushEnableUnavailableMessage(false, true, true);
      expect(msg).toBe(
        "Push notifications are not available on this iOS version. Use email or Telegram instead.",
      );
    });

    it("returns generic fallback for non-iOS unsupported browsers", () => {
      const msg = pushEnableUnavailableMessage(false, false, false);
      expect(msg).toBe("This browser cannot show notifications. Use email or Telegram instead.");
    });
  });

  describe("pushSupported", () => {
    it("returns false when any required API is missing", () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("navigator", {});
      expect(pushSupported()).toBe(false);
    });

    it("returns true only when Notification, serviceWorker, and PushManager all exist", () => {
      vi.stubGlobal("window", { Notification: {} });
      vi.stubGlobal("navigator", { serviceWorker: {}, PushManager: {} });
      expect(pushSupported()).toBe(true);
    });

    it("returns false when PushManager is missing even if others exist", () => {
      vi.stubGlobal("window", { Notification: {} });
      vi.stubGlobal("navigator", { serviceWorker: {} });
      expect(pushSupported()).toBe(false);
    });

    it("returns false in non-browser environments", () => {
      vi.stubGlobal("window", undefined);
      vi.stubGlobal("navigator", undefined);
      expect(pushSupported()).toBe(false);
    });
  });

  describe("isIOS", () => {
    it("returns true for iPhone user agent", () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("navigator", {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      });
      expect(isIOS()).toBe(true);
    });

    it("returns true for iPad user agent", () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("navigator", {
        userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
        platform: "iPad",
        maxTouchPoints: 5,
      });
      expect(isIOS()).toBe(true);
    });

    it("returns true for iPad desktop-mode user agent (MacIntel + touch)", () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("navigator", {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      });
      expect(isIOS()).toBe(true);
    });

    it("returns false for desktop user agents", () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("navigator", {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        maxTouchPoints: 0,
      });
      expect(isIOS()).toBe(false);
    });

    it("returns false for Android user agents", () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("navigator", {
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
      vi.stubGlobal("window", {
        matchMedia: (query: string) =>
          ({
            matches: query === "(display-mode: standalone)",
            media: query,
          }) as MediaQueryList,
      });
      vi.stubGlobal("navigator", {});
      expect(isStandalone()).toBe(true);
    });

    it("returns true when display-mode is fullscreen", () => {
      vi.stubGlobal("window", {
        matchMedia: (query: string) =>
          ({
            matches: query === "(display-mode: fullscreen)",
            media: query,
          }) as MediaQueryList,
      });
      vi.stubGlobal("navigator", {});
      expect(isStandalone()).toBe(true);
    });

    it("returns true when navigator.standalone is set (legacy iOS)", () => {
      vi.stubGlobal("window", {
        matchMedia: () =>
          ({
            matches: false,
            media: "",
          }) as MediaQueryList,
      });
      vi.stubGlobal("navigator", { standalone: true });
      expect(isStandalone()).toBe(true);
    });

    it("returns false in normal browser tab", () => {
      vi.stubGlobal("window", {
        matchMedia: () =>
          ({
            matches: false,
            media: "",
          }) as MediaQueryList,
      });
      vi.stubGlobal("navigator", {});
      expect(isStandalone()).toBe(false);
    });

    it("returns false in non-browser environments", () => {
      vi.stubGlobal("window", undefined);
      vi.stubGlobal("navigator", undefined);
      expect(isStandalone()).toBe(false);
    });
  });
});
