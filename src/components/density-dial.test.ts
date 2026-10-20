import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { bandSpans } from "@/lib/density";
import { DensityLabels } from "./density-dial";

/**
 * The labels under the dial's track, as a reader sees them.
 *
 * Rendered as markup rather than through the dial itself, because the dial needs the plan and auth
 * providers and the thing being pinned here is the label row: four names, each over the part of the track
 * its band governs, in the order the slider traverses them. Before this, the row carried two hardcoded
 * words while the readout above it named the band the reader was actually in.
 */
describe("DensityLabels", () => {
  const render = (): string => renderToStaticMarkup(createElement(DensityLabels, {}));

  it("names every band, in slider order", () => {
    const html = render();
    const labels = bandSpans().map((band) => band.label);
    expect(labels).toEqual(["Minimal", "Focused", "Broad", "Deep"]);

    // Each name appears once, after the one before it — so a reader reading left to right reads the scale.
    const positions = labels.map((label) => html.indexOf(`>${label}<`));
    expect(positions.every((index) => index > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("gives each label the width of the track its band owns", () => {
    const html = render();
    for (const band of bandSpans()) {
      expect(html).toContain(`flex-basis:${band.share}%`);
    }
    // The four shares are the whole track, so no label can fall off the end.
    expect(bandSpans().reduce((sum, band) => sum + band.share, 0)).toBe(100);
  });

  it("aligns the ends outward and the middles centrally", () => {
    const html = render();
    expect(html).toContain("text-left");
    expect(html).toContain("text-center");
    expect(html).toContain("text-right");
  });

  it("renders whatever spans it is given, so a new band needs no edit here", () => {
    const html = renderToStaticMarkup(
      createElement(DensityLabels, {
        spans: [{ key: "minimal", label: "Only", share: 100, align: "left" }],
      }),
    );
    expect(html).toContain(">Only<");
    expect(html).toContain("flex-basis:100%");
  });
});
