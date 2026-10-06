import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeliveryChannelHealth } from "@/lib/server/operations-diagnostics";
import { DeliveryHealth } from "./delivery-health";

/**
 * The banner that had to exist for six weeks of failed email deliveries to stop
 * being invisible, so what it draws is pinned here rather than trusted.
 *
 * The row shapes below are the ones the production measurement returned: the
 * email channel with a terminal Resend 401 and nothing sent in thirty days, and
 * push healthy at 96% with a terminal failure from weeks earlier.
 */

const row = (over: Partial<DeliveryChannelHealth> = {}): DeliveryChannelHealth => ({
  channel: "email",
  verdict: "failing",
  recent: { attempts: 3, sent: 0, failed: 3 },
  attempts: 133,
  sent: 0,
  failed: 133,
  successRate: 0,
  latestTerminalError: 'Resend 401: {"message":"API key is invalid"}',
  latestTerminalAt: "2026-10-05T11:59:56.960103+00:00",
  lastSuccessAt: null,
  lastAttemptAt: "2026-10-05T11:59:56.960103+00:00",
  ...over,
});

/**
 * React separates adjacent text expressions with comment nodes, so the rendered
 * markup has `email<!-- --> · <!-- -->failing` where a reader sees one phrase.
 * Reading it as text is the point of these assertions, so the separators come
 * out first, exactly as a browser's text does.
 */
const text = (rows: DeliveryChannelHealth[]): string =>
  renderToStaticMarkup(createElement(DeliveryHealth, { rows })).replace(/<!--.*?-->/g, "");

describe("DeliveryHealth", () => {
  it("reads a dead channel as a verdict with its reason, not as a count", () => {
    const html = text([row()]);
    expect(html).toContain("email · failing");
    expect(html).toContain("last 24h: 0 sent · 3 failed");
    expect(html).toContain("success 0% of 133 resolved");
    expect(html).toContain("last success none in window");
    expect(html).toContain("Resend 401");
  });

  it("says nothing has resolved rather than reporting a rate off no attempts", () => {
    // Rows exist and are still queued: a percentage here would be invented, and
    // the denominator beside it would not match what `successRate` divides by.
    const html = text([
      row({
        channel: "push",
        verdict: "ok",
        recent: { attempts: 0, sent: 0, failed: 0 },
        attempts: 0,
        sent: 0,
        failed: 0,
        successRate: null,
        latestTerminalError: null,
        latestTerminalAt: null,
      }),
    ]);
    expect(html).toContain("nothing resolved yet");
    expect(html).not.toContain("%");
  });

  it("takes the accent for a failing channel and withholds it otherwise", () => {
    // The one toning decision worth pinning: degraded and idle are quiet, so a
    // low-volume channel with one failure in four attempts is not a blue chip.
    const chip = (rows: DeliveryChannelHealth[]): string =>
      renderToStaticMarkup(createElement(DeliveryHealth, { rows }));
    expect(chip([row()])).toContain("bg-signal");
    expect(chip([row({ verdict: "degraded", successRate: 0.75 })])).not.toContain("bg-signal");
    expect(
      chip([row({ verdict: "idle", recent: { attempts: 0, sent: 0, failed: 0 } })]),
    ).not.toContain("bg-signal");
  });

  it("dates a terminal failure so a healthy channel's old one reads as old", () => {
    const html = text([
      row({
        channel: "push",
        verdict: "ok",
        recent: { attempts: 1, sent: 1, failed: 0 },
        attempts: 125,
        sent: 120,
        failed: 5,
        successRate: 0.96,
        latestTerminalError: "Could not find the table 'public.registered_devices'",
        latestTerminalAt: "2026-09-12T22:44:23.962772+00:00",
        lastSuccessAt: "2026-10-05T11:59:56.960103+00:00",
      }),
    ]);
    expect(html).toContain("push · ok");
    expect(html).toContain("success 96% of 125 resolved");
    expect(html).toContain("registered_devices");
    // The line leads with the failure's own date, so it cannot read as current.
    expect(html).toMatch(/terminal \S+.*registered_devices/);
  });

  it("drops the banner entirely when no channel has rows", () => {
    expect(text([])).toBe("");
  });
});
