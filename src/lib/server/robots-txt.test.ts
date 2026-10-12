/**
 * `robots.txt` follows the configured origin.
 *
 * It used to be a file in `public/` with the sitemap's address written into it,
 * so it could not follow a setting and nothing read it back. The crawler surface
 * then disagreed with itself: the sitemap was generated from `VITE_SITE_URL` and
 * the file that points at the sitemap was not.
 */

import { describe, expect, it } from "vitest";

import { handleRobotsTxt, robotsTxt } from "@/lib/server/robots-txt";

describe("robots.txt", () => {
  it("points at the sitemap on the origin it was given", () => {
    const body = robotsTxt("https://nyuz.example.com");
    expect(body).toContain("Sitemap: https://nyuz.example.com/sitemap.xml");
    expect(body).toContain("User-agent: *");
  });

  it("omits the sitemap line rather than guessing one", () => {
    // No origin configured. A robots file with no sitemap line is a smaller
    // loss than one sending a crawler to a host that does not exist.
    expect(robotsTxt(null)).not.toContain("Sitemap:");
    expect(robotsTxt(null)).toContain("User-agent: *");
  });

  it("reads the configured origin from the environment it is given", async () => {
    const response = handleRobotsTxt({ VITE_SITE_URL: "https://nyuz.example.com/" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    // The trailing slash is the caller's, not the origin's: every entry built
    // from it would otherwise carry a double slash.
    expect(body).toContain("Sitemap: https://nyuz.example.com/sitemap.xml");
  });

  it("refuses a placeholder instead of publishing a sitemap URL", async () => {
    const body = await handleRobotsTxt({
      VITE_SITE_URL: "https://<the origin production answers on>",
    }).text();
    expect(body).not.toContain("Sitemap:");
  });
});
