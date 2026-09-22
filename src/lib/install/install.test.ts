import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSIONS_BEFORE_CARD,
  SESSION_GAP_MS,
  bumpSessions,
  installOffer,
  shouldShowInstallCard,
} from "@/lib/install/offer";
import {
  INSTALLED_KEY,
  INSTALL_EVENT,
  INSTALL_INIT_SCRIPT,
  PROMPT_GLOBAL,
} from "@/lib/install/prompt";

/**
 * The install affordance, decided.
 *
 * Two things are being held in place here. One is honesty: the product must not
 * offer an Install button it cannot honour, and must not invite a reader who has
 * already installed to install again. The other is restraint: the card is the
 * only thing in nyuz that asks for something, and the rules that keep it from
 * becoming a nag are arithmetic rather than taste, so they are testable.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what to offer a window", () => {
  const base = { standalone: false, installed: false, ios: false, promptAvailable: false };

  it("offers nothing when it has nothing real to offer", () => {
    // The whole point. A browser with no captured prompt and no steps to give
    // gets no section — not a disabled button, and not instructions for a menu
    // that browser may not have.
    expect(installOffer(base)).toBe("none");
  });

  it("offers nothing on a desktop browser that cannot install", () => {
    // Safari on macOS is the live example: no beforeinstallprompt, and no iOS
    // Share sheet either. Silence is the honest answer.
    expect(installOffer({ ...base, ios: false })).toBe("none");
  });

  it("offers the browser's own prompt when one was captured", () => {
    expect(installOffer({ ...base, promptAvailable: true })).toBe("prompt");
  });

  it("offers the Share-sheet steps to an iPhone", () => {
    // iOS has no programmatic install, so the steps are the affordance.
    expect(installOffer({ ...base, ios: true })).toBe("ios-steps");
  });

  it("prefers a real prompt over written steps", () => {
    // Unreachable in practice — no iOS build has ever fired the event — but the
    // ordering is the rule, and a browser that did would get the better UI.
    expect(installOffer({ ...base, ios: true, promptAvailable: true })).toBe("prompt");
  });

  it("never invites an installed app to install itself", () => {
    expect(installOffer({ ...base, standalone: true, promptAvailable: true })).toBe("installed");
    expect(installOffer({ ...base, installed: true, ios: true })).toBe("installed");
  });
});

describe("counting sessions", () => {
  const t0 = 1_700_000_000_000;

  it("starts at one", () => {
    expect(bumpSessions(null, t0)).toEqual({ count: 1, last: t0 });
  });

  it("counts a visit inside the gap as the same session", () => {
    const first = bumpSessions(null, t0);
    const again = bumpSessions(first, t0 + SESSION_GAP_MS - 1);
    expect(again.count).toBe(1);
    // `last` moves anyway: the next session is measured from the end of this one.
    expect(again.last).toBe(t0 + SESSION_GAP_MS - 1);
  });

  it("counts a visit after the gap as a new session", () => {
    expect(bumpSessions({ count: 1, last: t0 }, t0 + SESSION_GAP_MS).count).toBe(2);
  });

  it("measures the gap from the most recent visit, not the first", () => {
    // Three short visits in a row are one session; the third must not tip it
    // over just because it is far from the first.
    let state = bumpSessions(null, t0);
    state = bumpSessions(state, t0 + SESSION_GAP_MS - 1);
    state = bumpSessions(state, t0 + 2 * SESSION_GAP_MS - 2);
    expect(state.count).toBe(1);
  });

  it("treats a corrupt stored count as no count", () => {
    // A blob that cannot be believed restarts the count, which delays the card
    // by one visit. The other direction — trusting it — is a card shown to
    // somebody new.
    expect(bumpSessions({ count: 0, last: t0 }, t0).count).toBe(1);
    expect(bumpSessions({ count: 3, last: NaN }, t0)).toEqual({ count: 1, last: t0 });
  });
});

describe("whether the card may be drawn", () => {
  const allowed = {
    offer: "prompt" as const,
    sessions: SESSIONS_BEFORE_CARD,
    dismissed: false,
    online: true,
  };

  it("is allowed once the offer is real and the reader has come back", () => {
    expect(shouldShowInstallCard(allowed)).toBe(true);
  });

  it("waits for a second session", () => {
    expect(shouldShowInstallCard({ ...allowed, sessions: SESSIONS_BEFORE_CARD - 1 })).toBe(false);
  });

  it("never asks twice", () => {
    expect(shouldShowInstallCard({ ...allowed, dismissed: true, sessions: 40 })).toBe(false);
  });

  it("does not offer installation to somebody who is offline", () => {
    expect(shouldShowInstallCard({ ...allowed, online: false })).toBe(false);
  });

  it("says nothing to an installed app, and nothing it cannot honour", () => {
    expect(shouldShowInstallCard({ ...allowed, offer: "installed" })).toBe(false);
    expect(shouldShowInstallCard({ ...allowed, offer: "none" })).toBe(false);
  });

  it("draws the Share-sheet variant on iOS", () => {
    expect(shouldShowInstallCard({ ...allowed, offer: "ios-steps" })).toBe(true);
  });
});

describe("the head script that catches the prompt", () => {
  /**
   * A window that records what the script does to it.
   *
   * `Event` is intentionally the real one: the script constructs it, and the
   * name it constructs is the contract with `attachInstallEvents`.
   */
  function stubWindow({ addEventListener = true } = {}) {
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    const dispatched: string[] = [];
    const stored: Record<string, string> = {};
    // `dispatchEvent` delivers to the listeners registered here, the way a real
    // window does — that delivery is the bridge being tested below, so a stub
    // that only recorded the name would be a stub that proves nothing.
    const win: Record<string, unknown> = {
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        for (const handler of listeners.get(event.type) ?? []) handler(event);
      },
    };
    if (addEventListener) {
      win["addEventListener"] = (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), handler]);
      };
    }
    vi.stubGlobal("window", win);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => void (stored[key] = value),
    });
    return {
      win,
      dispatched,
      stored,
      fire: (type: string, event: unknown) => {
        for (const handler of listeners.get(type) ?? []) handler(event);
      },
      listening: (type: string) => listeners.has(type),
    };
  }

  /** Run the inline script the way a parser does: in the global scope. */
  function run() {
    new Function(INSTALL_INIT_SCRIPT)();
  }

  /** The event a Chromium browser hands over, in the shape the module validates. */
  function installEvent({ outcome = "dismissed" }: { outcome?: string } = {}) {
    return {
      preventDefault: () => {},
      prompt: async () => ({ outcome }),
      userChoice: Promise.resolve({ outcome }),
    };
  }

  it("parks the event where the module will look for it, and suppresses the browser's own", () => {
    const dom = stubWindow();
    run();
    expect(dom.listening("beforeinstallprompt")).toBe(true);

    let prevented = false;
    const event = { preventDefault: () => (prevented = true) };
    dom.fire("beforeinstallprompt", event);

    expect(dom.win[PROMPT_GLOBAL]).toBe(event);
    // Without preventDefault Chromium shows its mini-infobar and treats the
    // prompt as spent, leaving our button with nothing to call.
    expect(prevented).toBe(true);
  });

  it("tells the module when the event arrives after mount", () => {
    // The arrival order parking cannot cover: React is already on the page, and
    // only a DOM event can reach it. The name is the contract between the two.
    const dom = stubWindow();
    run();
    dom.fire("beforeinstallprompt", { preventDefault: () => {} });
    expect(dom.dispatched).toContain(INSTALL_EVENT);
  });

  it("remembers an install, under the key the module reads", () => {
    const dom = stubWindow();
    run();
    dom.fire("appinstalled", {});
    expect(dom.stored[INSTALLED_KEY]).toBe("1");
  });

  it("notices an event that arrives after React is on the page", async () => {
    // The half that parking on a global cannot cover. Chrome may fire this long
    // after mount, and without the ping the snapshot would never be recomputed
    // and the Install button would silently never appear.
    const dom = stubWindow();
    run();

    // A fresh module, because `attachInstallEvents` deliberately attaches once —
    // the previous test in this file would otherwise have left it attached to
    // that test's window.
    vi.resetModules();
    const prompt = await import("@/lib/install/prompt");
    prompt.attachInstallEvents();
    expect(prompt.installFacts().promptAvailable).toBe(false);

    dom.fire("beforeinstallprompt", installEvent());
    expect(prompt.installFacts().promptAvailable).toBe(true);
  });

  it("refuses to count a parked object that cannot prompt", async () => {
    // The global is writable by anything on the page, and the one thing this
    // module must never do is draw an Install button that cannot install. An
    // object without `prompt` is not an offer, so it is not an offer.
    const dom = stubWindow();
    run();
    vi.resetModules();
    const prompt = await import("@/lib/install/prompt");

    dom.fire("beforeinstallprompt", { preventDefault: () => {} });
    expect(prompt.installFacts().promptAvailable).toBe(false);
  });

  it("clears the event as it uses it, and reports what the browser answered", async () => {
    // The captured event is documented as single-use, so it must not survive the
    // call — and the outcome has to come from the browser rather than be assumed.
    const dom = stubWindow();
    run();
    const event = installEvent({ outcome: "accepted" });
    dom.fire("beforeinstallprompt", event);

    vi.resetModules();
    const prompt = await import("@/lib/install/prompt");
    expect(prompt.installFacts().promptAvailable).toBe(true);
    await expect(prompt.runInstallPrompt()).resolves.toBe("accepted");
    expect(dom.win[PROMPT_GLOBAL]).toBeUndefined();
    expect(prompt.installFacts().promptAvailable).toBe(false);
    // Asked once, and not twice: a second call has nothing left to prompt with.
    await expect(prompt.runInstallPrompt()).resolves.toBe("unavailable");
  });

  it("survives a window that has no addEventListener", () => {
    // It is in the head of every page, including the landing page and the 404.
    // A throw here is a broken document for every visitor, so the whole thing is
    // wrapped — and this is the test that says so.
    stubWindow({ addEventListener: false });
    expect(run).not.toThrow();
  });
});
