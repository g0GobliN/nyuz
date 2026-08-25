/**
 * Prints a VAPID key pair for Web Push.
 *
 *   npm run vapid
 *
 * Put the public key in VITE_VAPID_PUBLIC_KEY (the browser needs it) and the
 * private key in VAPID_PRIVATE_KEY. Both are required before notifications send.
 */

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const x = jwk.x;
const y = jwk.y;
const d = jwk.d;
if (!x || !y || !d) {
  console.error("Could not export VAPID keys.");
  process.exit(1);
}

const publicKey = uncompressed(x, y);

console.log("VITE_VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + d);
console.log("VAPID_SUBJECT=mailto:privacy@nyuz.app");

function uncompressed(xB64: string, yB64: string): string {
  const x = b64urlToBytes(xB64);
  const y = b64urlToBytes(yB64);
  const out = new Uint8Array(1 + x.length + y.length);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 1 + x.length);
  return bytesToB64url(out);
}

function b64urlToBytes(value: string): Uint8Array {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export {};
