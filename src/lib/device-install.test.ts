import { afterEach, describe, expect, it, vi } from "vitest";

import { deviceLabel } from "@/lib/device-install";

/**
 * What the reader sees their own session called in the device list.
 *
 * Every fixture below is a real user agent, because the bug this file was
 * written for is a parsing gap rather than a logic one: iOS omits the browser
 * token entirely in a Home Screen window, so the field the label used to print
 * unconditionally was never there to print. A fixture invented with "Safari/" in
 * it — including the one `src/lib/push/ios-ux.test.ts` uses — passes against the
 * old code and hides exactly this.
 */

type Stub = { userAgent: string; standalone?: boolean; platform?: string };

function stubBrowser({ userAgent, standalone = false, platform = "iPhone" }: Stub) {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: standalone && query.includes("standalone") }),
  });
  vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints: 5 });
}

/** iPhone 18.2, added to the Home Screen: no `Version/…`, no `Safari/…`. */
const IPHONE_HOME_SCREEN =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
/** The same phone, in a Safari tab. */
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.100 Mobile/15E148 Safari/604.1";
const LINUX_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.100 Mobile Safari/537.36";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the label for this device", () => {
  it("does not name a browser it was not told about", () => {
    // The reported row: an installed app on an iPhone, which used to read
    // "iPhone · Browser · PWA" — our own placeholder sitting where a browser
    // name goes, which is not a browser anyone has heard of.
    stubBrowser({ userAgent: IPHONE_HOME_SCREEN, standalone: true });
    expect(deviceLabel()).toBe("iPhone · PWA");
  });

  it("still names the browser in a tab", () => {
    stubBrowser({ userAgent: IPHONE_SAFARI });
    expect(deviceLabel()).toBe("iPhone · Safari");
  });

  it("keeps the browser on iOS when the page is not Safari", () => {
    // Worth holding: the stripped token is an iOS *standalone* behaviour, not an
    // iOS one, so a fixture that lost "CriOS" too would not be this platform.
    stubBrowser({ userAgent: IPHONE_CHROME });
    expect(deviceLabel()).toBe("iPhone · Chrome");
  });

  it.each([
    [LINUX_FIREFOX, "Linux · Firefox"],
    [ANDROID_CHROME, "Android · Chrome"],
  ])("names what it can and stops there", (ua, expected) => {
    stubBrowser({ userAgent: ua, standalone: false });
    expect(deviceLabel()).toBe(expected);
  });

  it("falls back to the generic name only when nothing was identified", () => {
    // The one case the word "Browser" is still for. It must not be a part of a
    // longer name, which is how it got into the device list in the first place.
    stubBrowser({ userAgent: "curl/8.7.1", standalone: false });
    expect(deviceLabel()).toBe("Browser");

    stubBrowser({ userAgent: "Everything/1.0", standalone: true });
    expect(deviceLabel()).toBe("PWA");
  });

  it("is a name at all outside a browser", () => {
    vi.stubGlobal("navigator", undefined);
    expect(deviceLabel()).toBe("Browser");
  });
});
