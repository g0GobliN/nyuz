/**
 * The identity an installation keeps its delivery slot under, and who is
 * allowed to remember it.
 *
 * ---------------------------------------------------------------------------
 * Why the browser cannot be the only one holding it
 * ---------------------------------------------------------------------------
 *
 * `installId()` mints a random uuid in `localStorage`, and the slot is that
 * uuid's row in `registered_devices`. Script-writable storage is not a place to
 * keep the only copy of anything: WebKit's tracking prevention deletes all
 * cookies created in JavaScript and all other script-writable storage after
 * seven days without interaction, a private window starts empty, and "clear
 * website data" takes it deliberately. Every one of those made a reader who had
 * been using the product for a year arrive as a brand-new device — which cost
 * them a slot, and, once the plan's ten were full, made the cap refuse the
 * device they were holding while nine abandoned rows sat in the list.
 *
 * A cookie the server sets is outside that rule: the seven-day cap is about
 * storage written by script, and an `HttpOnly` cookie from a response header is
 * not script-writable. So the server hands one out, with a lifetime measured in
 * months, and reads it back on every registration.
 *
 * The client still sends its own id. It is the only thing that can *create* an
 * installation — the server has no way to invent a device nobody has visited
 * from — and the cookie is the only thing that can find one again after the
 * browser forgot it.
 *
 * ---------------------------------------------------------------------------
 * Which id wins
 * ---------------------------------------------------------------------------
 *
 * The anchor, whenever this reader still has a row for it. Once a browser has
 * been handed an identity, nothing it says about itself afterwards should be
 * able to move it, or the anchor would only be as durable as the storage it
 * exists to survive. The client's id is used when there is no anchored row: the
 * first registration after this shipped, a device the reader removed on
 * purpose, or a browser that has never registered.
 *
 * Nothing else is trusted. The cookie is attacker-editable, so it is only
 * honoured as a uuid *and* only when the signed-in reader has a row under it —
 * which is why the caller passes the ids it already knows, and the cookie it
 * already read, rather than letting this module look either up.
 *
 * ---------------------------------------------------------------------------
 * The anchor follows the boundary the storage had
 * ---------------------------------------------------------------------------
 *
 * A cookie is not a single jar per site, so this does not merge anything. On
 * iOS a Home Screen app is its own data container — "Web apps run from the home
 * screen don't share storage with Safari", and that is by design — so the
 * installed app and a Safari tab keep separate anchors and separate slots, just
 * as they keep separate `localStorage` today. On Android an installed app shares
 * one browser profile with its browser, so it already shares that storage, and
 * the two were one device before this as well. The anchor lives beside the
 * storage it replaces, in the same container, on both.
 */

/** The cookie a browser is handed its installation under. */
export const DEVICE_COOKIE = "nyuz_device";

/**
 * Seconds. Long enough to outlive any plausible absence — the cap it works
 * around is seven days of idleness, and a reader can be gone for a season.
 */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * What the anchor is written with, minus `secure` — that one depends on the
 * request, so it can only be read where the request is.
 *
 * ---------------------------------------------------------------------------
 * Why this is data, and the call is not a function in here
 * ---------------------------------------------------------------------------
 *
 * The build denies any use of `@tanstack/react-start/server` outside a server
 * function or middleware body, in any module reachable from the client — and
 * both modules that register a device also export the server functions the
 * browser calls, so they are reachable. A helper that calls `setCookie` is
 * rejected with `[import-protection] Import denied in client environment`, and
 * wrapping that helper in `createServerOnlyFn` is rejected too, despite the
 * error message offering it as the fix. Both were tried; the build is how it
 * was found, twice.
 *
 * So the cookie is written at each registration path, from these attributes,
 * and `device-anchor.test.ts` holds every path to having that call — because
 * the failure mode of forgetting one is a device that quietly stops being
 * anchored, which is invisible until it has been evicted a few times.
 */
export function deviceCookieAttributes(secure: boolean): {
  path: string;
  maxAge: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
} {
  return {
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
    // The browser never needs to read it: the server resolves the id and
    // returns it, and the client writes its own copy from that answer. It also
    // means no script — ours or an injected one — can rewrite the anchor.
    httpOnly: true,
    secure,
    sameSite: "lax",
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id in the server's own cookie, if the request carried one. */
export type AnchorInput = { anchor: string | undefined };

/** What a registration is decided from: the cookie's id and the browser's own. */
export type InstallIdInput = AnchorInput & { installId: string };

/** Whether a cookie value is an installation id at all. */
export function isInstallId(value: string | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * The installation this registration belongs to.
 *
 * `known` is every install id the reader already has a row for. A row under the
 * anchor is what makes the anchor usable; a cookie naming somebody else's
 * device, or a device this reader removed, is just a string.
 */
export function resolveInstallId({
  anchor,
  client,
  known,
}: AnchorInput & {
  /** The id the browser keeps in its own storage. */
  client: string;
  /** Every install id this reader already has a row for. */
  known: readonly string[];
}): string {
  if (isInstallId(anchor) && known.includes(anchor)) return anchor;
  return client;
}
