import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  isInstallId,
  resolveInstallId,
} from "@/lib/device-anchor";

/**
 * One phone, one delivery slot.
 *
 * The slot is a row in `registered_devices` and the row is named by a random
 * uuid the browser keeps. Every browser is entitled to forget that uuid — and
 * WebKit does, on purpose, after seven days without interaction — so the reader
 * arrived as a new device instead of the one they already had. The list filled
 * with rows they could not tell apart, and once the plan's ten were gone the cap
 * refused the phone in their hand.
 *
 * The rule below is the whole fix: the id the server handed out is the device,
 * and the browser's own copy is only ever allowed to create one. The wiring
 * assertions after it are here because the rule is worthless if a second code
 * path registers devices without asking it — the push subscription is exactly
 * that path, and it runs on every dashboard visit.
 */

const read = (path: string) => readFileSync(path, "utf8");

const DEVICES = read("src/lib/server/devices.ts");
const PUSH_ACCOUNT = read("src/lib/server/push/account.ts");
const PUSH_CLIENT = read("src/lib/push/client.ts");
const MIGRATION = read("supabase/migrations/0094_device_label_is_kept.sql");
const ANCHOR_MODULE = read("src/lib/device-anchor.ts");

const ANCHOR = "11111111-2222-4333-8444-555555555555";
const CLIENT = "99999999-8888-4777-8666-555555555555";

describe("which installation a registration belongs to", () => {
  it("is the anchored one whenever this reader has a row for it", () => {
    // The point of handing an identity out: nothing the browser says about
    // itself afterwards may move it, or the anchor dies with the storage it
    // exists to survive.
    expect(resolveInstallId({ anchor: ANCHOR, client: CLIENT, known: [ANCHOR] })).toBe(ANCHOR);
    expect(resolveInstallId({ anchor: ANCHOR, client: CLIENT, known: [ANCHOR, CLIENT] })).toBe(
      ANCHOR,
    );
  });

  it("is the browser's own id when the anchor names no row of theirs", () => {
    // A removed device, or another reader's cookie on a shared machine: the
    // cookie is attacker-editable, so a uuid is not enough — the row is what
    // makes it usable.
    expect(resolveInstallId({ anchor: ANCHOR, client: CLIENT, known: [] })).toBe(CLIENT);
    expect(resolveInstallId({ anchor: ANCHOR, client: CLIENT, known: [CLIENT] })).toBe(CLIENT);
  });

  it("is the browser's own id when there is no anchor at all", () => {
    // First registration after this shipped, and every reader who has never
    // registered: the server cannot invent a device nobody visited from.
    expect(resolveInstallId({ anchor: undefined, client: CLIENT, known: [] })).toBe(CLIENT);
  });

  it("refuses a cookie that is not an installation id", () => {
    for (const anchor of ["1", "", "not-a-uuid", `${ANCHOR}x`]) {
      expect(isInstallId(anchor)).toBe(false);
      expect(resolveInstallId({ anchor, client: CLIENT, known: [anchor] })).toBe(CLIENT);
    }
  });

  it("is a cookie name a browser can send back", () => {
    expect(DEVICE_COOKIE).toBe("nyuz_device");
    // Months, not days: the cap it works around is seven days of idleness.
    expect(DEVICE_COOKIE_MAX_AGE).toBeGreaterThan(90 * 24 * 60 * 60);
  });
});

describe("every path that registers a device asks the anchor", () => {
  it("is the settings list and the push subscription alike", () => {
    // Missing one of these is invisible until a reader at the cap cannot use the
    // device they are holding.
    expect(DEVICES).toContain("export async function registerThisDevice");
    expect(DEVICES).toContain("await registerThisDevice(context.actor, {");
    expect(DEVICES).toContain("anchor: getCookie(DEVICE_COOKIE)");
    expect(PUSH_ACCOUNT).toContain("registerThisDevice(context.actor, {");
    // Nothing there reaches past it to the RPC, or the push path could create a
    // second row for a device that already has one.
    expect(PUSH_ACCOUNT).not.toContain("register_device");
  });

  it("writes the anchor on both, with the id the call settled on", () => {
    // Not the id it was asked for: `register_device` reunites identities that
    // arrived by different routes, and the anchor has to name the row. Written
    // at each path rather than in a helper, because the build denies this
    // import outside a handler body — see `deviceCookieAttributes`.
    expect(DEVICES).toContain("setCookie(DEVICE_COOKIE, installId, deviceCookieAttributes(");
    expect(PUSH_ACCOUNT).toContain("setCookie(DEVICE_COOKIE, registered, deviceCookieAttributes(");
    for (const text of [DEVICES, PUSH_ACCOUNT]) {
      expect(text.match(/setCookie\(/g)).toHaveLength(1);
      expect(text).toContain('getRequestProtocol() === "https"');
    }
  });

  it("is a cookie a script cannot read or rewrite", () => {
    expect(ANCHOR_MODULE).toContain("httpOnly: true");
    expect(ANCHOR_MODULE).not.toContain('sameSite: "none"');
  });

  it("forgets the anchor the reader removed on purpose", () => {
    expect(DEVICES).toContain("deleteCookie(DEVICE_COOKIE");
  });

  it("heals the browser's own copy from the answer", () => {
    // The client's storage is the copy that gets evicted; rewriting it from the
    // server's answer is what keeps the two from disagreeing.
    expect(read("src/components/device-manager.tsx")).toContain(
      "rememberInstallId(result.installId)",
    );
  });
});

describe("a call with no label leaves the name alone", () => {
  it("omits the argument rather than filling in a placeholder", () => {
    // 0093 defaulted `p_label` to 'Browser', so a caller with no label to give
    // *renamed* the device — and `refreshPush` is such a caller, on every
    // dashboard visit. The name was never missing; it was being overwritten.
    expect(DEVICES).toContain("...(input.label ? { p_label: input.label } : {})");
    expect(DEVICES).not.toContain('p_label: input.label ?? "Browser"');
  });

  it("says so in the function that decides it", () => {
    expect(MIGRATION).toContain("p_label text default null");
    expect(MIGRATION).toContain("label = coalesce(safe_label, label)");
    // A device that has never been named still has to be called something.
    expect(MIGRATION).toContain("coalesce(safe_label, 'Browser')");
  });

  it("gives the push path a name to send", () => {
    // Otherwise a device that turns notifications on before it ever opens
    // Settings stays called "Browser" for as long as it exists.
    expect(PUSH_ACCOUNT).toContain("label: z.string().trim().min(1).max(80).optional()");
    expect(PUSH_CLIENT).toContain("label: deviceLabel()");
  });
});
