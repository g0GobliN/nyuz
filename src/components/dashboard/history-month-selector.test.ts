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

  /**
   * The archive window is thirteen months and the strip used to hide three of
   * them behind an invisible scroll at 1280 (`docs/design-spec-2026-10-21.md`
   * S4). The component never dropped a month — the clipping was CSS — so this
   * asserts the count the acceptance measure reads off the DOM, and the class
   * that decides whether those buttons are reachable.
   */
  it("renders all thirteen months of the window, in a strip that does not clip them", () => {
    const labels = [
      "October 2026",
      "September 2026",
      "August 2026",
      "July 2026",
      "June 2026",
      "May 2026",
      "April 2026",
      "March 2026",
      "February 2026",
      "January 2026",
      "December 2025",
      "November 2025",
      "October 2025",
    ];
    const html = renderToStaticMarkup(
      createElement(HistoryMonthSelector, {
        months: labels.map((label, index) => month(`2026-${index}`, label, index)),
        selected: "2026-0",
        onSelect: () => undefined,
      }),
    );

    expect(html.split("<button").length - 1).toBe(13);
    for (const label of labels) expect(html).toContain(`>${label}</button>`);
    // `overflow-x-auto` stays for the phone; from `sm` up it is gone, so the
    // row's own wrapping is what keeps every month on screen.
    expect(html).toMatch(/class="mb-6 overflow-x-auto[^"]*sm:overflow-visible/);
    // No truncation of any kind: the label is what the reader picks a month by.
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("text-overflow");
  });
});
