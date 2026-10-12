/**
 * The origin every published absolute URL is built from.
 *
 * The defect these pin: three files each held their own literal origin, and on
 * 2026-10-12 all three named a host with no DNS record while the product
 * answered somewhere else. Nothing failed, because nothing compared them. So
 * the assertions here are about *agreement and refusal*: one origin for every
 * surface, and never a value that cannot be a public address.
 *
 * The deployment half of that claim is `scripts/origin-check.mjs`, which reads
 * a live origin and the URLs it actually publishes. This file proves the
 * resolution rules; that file proves the deployment obeys them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalUrlFor, pageHead } from "@/lib/seo";
import { DEPLOYED_ORIGIN, isPublicOrigin, siteOrigin } from "@/lib/site-origin";

const PLACEHOLDER = "https://<the origin production answers on>";

afterEach(() => vi.unstubAllEnvs());

describe("siteOrigin", () => {
  it("uses a configured public origin, without a trailing slash", () => {
    vi.stubEnv("VITE_SITE_URL", "https://nyuz.example.com/");
    expect(siteOrigin()).toBe("https://nyuz.example.com");
  });

  it("still resolves when nothing is configured", () => {
    vi.stubEnv("VITE_SITE_URL", "");
    expect(siteOrigin()).toBe(DEPLOYED_ORIGIN);
  });

  it("refuses a placeholder sentence rather than publishing it", () => {
    // The exact value this repository's GitHub variable held on 2026-10-12.
    // It is a string, not an origin, and it reached the deployed build.
    vi.stubEnv("VITE_SITE_URL", PLACEHOLDER);
    expect(siteOrigin()).toBe(DEPLOYED_ORIGIN);
    expect(isPublicOrigin(PLACEHOLDER)).toBe(false);
  });

  it("refuses a development address", () => {
    // A canonical pointing at localhost is an instruction to a crawler to index
    // an address it cannot reach — worse than publishing the deployed origin.
    for (const value of ["http://localhost:8080", "http://127.0.0.1:8080", "http://nyuz.app"]) {
      vi.stubEnv("VITE_SITE_URL", value);
      expect(siteOrigin(), value).toBe(DEPLOYED_ORIGIN);
    }
  });

  it("refuses an origin carrying a path, a query or a space", () => {
    for (const value of [
      "https://nyuz.app/pricing",
      "https://nyuz.app?a=1",
      "https://nyuz. app",
      "not a url",
      "workers.dev",
    ]) {
      vi.stubEnv("VITE_SITE_URL", value);
      expect(siteOrigin(), value).toBe(DEPLOYED_ORIGIN);
    }
  });
});

describe("the pages' own URLs", () => {
  it("canonicalises every page to the one configured origin", () => {
    vi.stubEnv("VITE_SITE_URL", "https://nyuz.example.com");
    expect(canonicalUrlFor("/")).toBe("https://nyuz.example.com/");
    expect(canonicalUrlFor("/pricing")).toBe("https://nyuz.example.com/pricing");
  });

  it("puts the same origin in the canonical and in og:url", () => {
    vi.stubEnv("VITE_SITE_URL", "https://nyuz.example.com");
    const head = pageHead({ path: "/about", title: "About", description: "About nyuz" });
    const canonical = head.links.find((link) => link.rel === "canonical")?.href;
    const ogUrl = head.meta.find((entry) => "property" in entry && entry.property === "og:url") as
      { content: string } | undefined;
    expect(canonical).toBe("https://nyuz.example.com/about");
    expect(ogUrl?.content).toBe(canonical);
  });
});
