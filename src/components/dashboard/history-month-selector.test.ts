import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HistoryMonth } from "@/lib/history-window";
import { HistoryMonthSelector } from "./history-month-selector";

function month(key: string, label: string, count = 0): HistoryMonth {
  return {
    key,
    label,
    count,
    state: "available",
    restorePlan: null,
    restorePartial: false,
  };
}

describe("HistoryMonthSelector", () => {
  it("stays out of the way when the window covers one calendar month", () => {
    const html = renderToStaticMarkup(
      createElement(HistoryMonthSelector, {
        months: [month("2026-09", "September 2026", 2)],
        selected: "2026-09",
        onSelect: () => undefined,
      }),
    );
    expect(html).toBe("");
  });

  it("shows every supplied month, including an empty month across a year boundary", () => {
    const html = renderToStaticMarkup(
      createElement(HistoryMonthSelector, {
        months: [month("2027-01", "January 2027"), month("2026-12", "December 2026", 4)],
        selected: "2026-12",
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="History month"');
    expect(html).toContain("January 2027");
    expect(html).toContain("December 2026");
    expect(html).toMatch(/aria-current="page"[^>]*>December 2026/);
  });
});
