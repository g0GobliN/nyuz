import { describe, expect, it } from "vitest";
import { avatarUrlFrom } from "@/lib/avatar";

/**
 * The avatar address is the one value in the app that arrives from somewhere
 * else and is then put straight into an attribute, so what it refuses matters
 * more than what it accepts.
 */
describe("avatarUrlFrom", () => {
  it("reads the address Google and GitHub sign-in returns", () => {
    expect(avatarUrlFrom({ avatar_url: "https://lh3.googleusercontent.com/a/abc" })).toBe(
      "https://lh3.googleusercontent.com/a/abc",
    );
    expect(avatarUrlFrom({ avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" })).toBe(
      "https://avatars.githubusercontent.com/u/1?v=4",
    );
  });

  it("falls back to the field Google names it by", () => {
    expect(avatarUrlFrom({ picture: "https://lh3.googleusercontent.com/a/xyz" })).toBe(
      "https://lh3.googleusercontent.com/a/xyz",
    );
  });

  it("prefers the normalised field when a provider sends both", () => {
    expect(
      avatarUrlFrom({
        avatar_url: "https://avatars.githubusercontent.com/u/1",
        picture: "https://example.com/other.png",
      }),
    ).toBe("https://avatars.githubusercontent.com/u/1");
  });

  it("refuses anything that is not https", () => {
    for (const value of [
      "http://lh3.googleusercontent.com/a/abc",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "javascript:alert(1)",
      "//lh3.googleusercontent.com/a/abc",
      "lh3.googleusercontent.com/a/abc",
      "",
    ]) {
      expect(avatarUrlFrom({ avatar_url: value })).toBeNull();
    }
  });

  it("survives metadata that is missing, empty or the wrong shape", () => {
    for (const metadata of [null, undefined, {}, [], "https://example.com/a.png", 42, true]) {
      expect(avatarUrlFrom(metadata)).toBeNull();
    }
  });

  it("ignores an address of the wrong type rather than coercing it", () => {
    expect(avatarUrlFrom({ avatar_url: 123 })).toBeNull();
    expect(avatarUrlFrom({ avatar_url: { href: "https://example.com/a.png" } })).toBeNull();
  });

  it("keeps working when the metadata carries other provider keys", () => {
    expect(
      avatarUrlFrom({
        email: "someone@example.com",
        full_name: "Someone",
        avatar_url: "https://avatars.githubusercontent.com/u/2",
      }),
    ).toBe("https://avatars.githubusercontent.com/u/2");
  });
});
