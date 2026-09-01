import { describe, expect, it } from "vitest";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

const env = { EMAIL_UNSUBSCRIBE_SECRET: "a-launch-secret-with-at-least-32-characters" };
const now = new Date("2026-09-01T00:00:00Z");

describe("email unsubscribe tokens", () => {
  it("accepts a valid token for only its signed user", async () => {
    const token = await createUnsubscribeToken("user-one", env, now);
    expect(await verifyUnsubscribeToken(token, env, now)).toBe("user-one");
  });

  it("rejects tampering and expiry", async () => {
    const token = await createUnsubscribeToken("user-one", env, now);
    expect(await verifyUnsubscribeToken(`${token.slice(0, -1)}x`, env, now)).toBeNull();
    expect(await verifyUnsubscribeToken(token, env, new Date("2027-04-01T00:00:00Z"))).toBeNull();
  });
});
