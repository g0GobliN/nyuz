import { envValue } from "@/lib/runtime-env";

export type UnsubscribeEnv = {
  EMAIL_UNSUBSCRIBE_SECRET?: string;
};

type Payload = { u: string; e: number; v: 1 };

const TOKEN_DAYS = 180;

function secret(env?: UnsubscribeEnv): string {
  const value = envValue("EMAIL_UNSUBSCRIBE_SECRET", env);
  if (!value || value.length < 32) {
    throw new Error("Missing EMAIL_UNSUBSCRIBE_SECRET (minimum 32 characters)");
  }
  return value;
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array | null {
  try {
    const padded = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signature(payload: string, env?: UnsubscribeEnv): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function createUnsubscribeToken(
  userId: string,
  env?: UnsubscribeEnv,
  now = new Date(),
): Promise<string> {
  const payload = encode(
    new TextEncoder().encode(
      JSON.stringify({
        u: userId,
        e: now.getTime() + TOKEN_DAYS * 86_400_000,
        v: 1,
      } satisfies Payload),
    ),
  );
  return `${payload}.${encode(await signature(payload, env))}`;
}

export async function unsubscribeUrl(
  userId: string,
  origin: string,
  env?: UnsubscribeEnv,
  now = new Date(),
): Promise<string> {
  const token = await createUnsubscribeToken(userId, env, now);
  return `${origin.replace(/\/+$/, "")}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

export async function verifyUnsubscribeToken(
  token: string,
  env?: UnsubscribeEnv,
  now = new Date(),
): Promise<string | null> {
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra !== undefined) return null;
  const suppliedBytes = decode(supplied);
  if (!suppliedBytes) return null;
  const expected = await signature(payload, env);
  if (suppliedBytes.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected[i]! ^ suppliedBytes[i]!;
  if (mismatch !== 0) return null;

  const decoded = decode(payload);
  if (!decoded) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(decoded)) as Partial<Payload>;
    if (value.v !== 1 || typeof value.u !== "string" || value.u === "") return null;
    if (typeof value.e !== "number" || value.e < now.getTime()) return null;
    return value.u;
  } catch {
    return null;
  }
}
