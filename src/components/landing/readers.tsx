import { useId, type CSSProperties } from "react";

// Portrait centers in the original 3:1 composition. Soft masks blend each
// moving portrait back into the unchanged artwork without visible cut edges.
const READERS = [
  [45, 205, 92, 165],
  [230, 192, 92, 160],
  [420, 190, 95, 165],
  [645, 210, 105, 185],
  [864, 193, 103, 165],
  [1070, 228, 98, 185],
  [1270, 200, 112, 170],
  [1504, 217, 118, 185],
  [1782, 207, 105, 180],
  [2007, 218, 105, 180],
  [123, 468, 118, 180],
  [347, 458, 104, 178],
  [555, 460, 112, 180],
  [830, 470, 107, 180],
  [1080, 499, 122, 180],
  [1376, 489, 105, 180],
  [1610, 500, 112, 180],
  [1820, 477, 110, 175],
  [2028, 510, 98, 175],
] as const;

/** Animate local regions of the existing bitmap; no regenerated artwork. */
export function HeroReaders() {
  const id = useId();

  return (
    <svg
      viewBox="0 0 2048 683"
      width={2172}
      height={724}
      className="hero-readers-art"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-feather`}>
          <stop offset="45%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </radialGradient>
        <image id={`${id}-art`} href="/nyuz-readers.png" width="2048" height="683" />
        {READERS.map(([x, y, rx, ry], i) => (
          <mask
            key={i}
            id={`${id}-reader-${i}`}
            maskUnits="userSpaceOnUse"
            x={x - rx}
            y={y - ry}
            width={rx * 2}
            height={ry * 2}
            style={{ maskType: "luminance" }}
          >
            <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={`url(#${id}-feather)`} />
          </mask>
        ))}
      </defs>
      <use href={`#${id}-art`} />
      {READERS.map(([x, y], i) => (
        <g key={i} mask={`url(#${id}-reader-${i})`} className="reader-motion-layer">
          <use
            href={`#${id}-art`}
            className="reader-portrait"
            style={
              {
                transformOrigin: `${x}px ${y + 100}px`,
                animationDuration: `${4.8 + (i % 5) * 0.7}s`,
                animationDelay: `${-i * 0.83}s`,
                "--reader-tilt": i % 2 === 0 ? "0.35deg" : "-0.35deg",
              } as CSSProperties
            }
          />
        </g>
      ))}
    </svg>
  );
}
