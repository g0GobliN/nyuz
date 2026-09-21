import { useId, useState } from "react";
import { cn } from "@/lib/utils";

function boundedPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(Math.max((value / max) * 100, 0), 100);
}

export function TrendAreaChart({
  rows,
  valueLabel,
  emptyLabel = "No activity in this window yet.",
}: {
  rows: { label: string; value: number }[];
  valueLabel: (value: number) => string;
  emptyLabel?: string | undefined;
}) {
  const gradientId = `trend-${useId().replace(/:/g, "")}`;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) {
    return <p className="py-8 text-[13px] text-muted-foreground">{emptyLabel}</p>;
  }

  const width = 720;
  const height = 220;
  const floor = 184;
  const max = Math.max(...rows.map((row) => row.value), 1);
  const x = (index: number) =>
    rows.length === 1 ? width / 2 : (index / (rows.length - 1)) * width;
  const y = (value: number) => floor - (value / max) * 150;
  const points = rows.map((row, index) => `${x(index)},${y(row.value)}`).join(" ");
  const area = `M 0 ${floor} L ${points.replaceAll(" ", " L ")} L ${width} ${floor} Z`;
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const peakIndex = rows.reduce(
    (best, row, index) => (row.value > rows[best]!.value ? index : best),
    0,
  );
  const sample = Math.max(Math.floor(rows.length / 3), 1);
  const opening = rows.slice(0, sample).reduce((sum, row) => sum + row.value, 0) / sample;
  const recent = rows.slice(-sample).reduce((sum, row) => sum + row.value, 0) / sample;
  const pace = opening > 0 ? ((recent - opening) / opening) * 100 : null;
  const dotStep = Math.max(Math.ceil(rows.length / 14), 1);
  const activeIndex = selectedIndex ?? hoveredIndex;
  const activeRow = activeIndex === null ? null : rows[activeIndex];

  return (
    <figure
      aria-label={`${valueLabel(total)} total. Peak ${valueLabel(rows[peakIndex]!.value)} on ${rows[peakIndex]!.label}.`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-serif text-[32px] leading-none tabular-nums">{valueLabel(total)}</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">Total in selected window</p>
        </div>
        <div className="text-right">
          {pace === null ? (
            <p className="text-[12px] text-muted-foreground">Building a baseline</p>
          ) : (
            <p className={cn("text-[13px] font-semibold tabular-nums", pace > 0 && "text-signal")}>
              {pace > 0 ? "↗" : pace < 0 ? "↘" : "→"} {Math.abs(pace).toFixed(1)}%
            </p>
          )}
          <p className="mt-1 text-[10.5px] text-muted-foreground">Recent pace vs opening</p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-5 h-56 w-full"
        preserveAspectRatio="none"
        aria-hidden
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--signal)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[34, 84, 134, floor].map((line) => (
          <line
            key={line}
            x1="0"
            x2={width}
            y1={line}
            y2={line}
            stroke="var(--hairline)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <polyline
          points={points}
          fill="none"
          stroke="var(--signal)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {rows.map((row, index) =>
          index % dotStep === 0 || index === rows.length - 1 || index === peakIndex ? (
            <circle
              key={row.label}
              cx={x(index)}
              cy={y(row.value)}
              r={index === peakIndex ? 4 : 2.5}
              fill={index === peakIndex ? "var(--signal)" : "var(--surface)"}
              stroke="var(--signal)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onClick={() => setSelectedIndex(selectedIndex === index ? null : index)}
              tabIndex={0}
              role="button"
              aria-label={`${row.label}: ${valueLabel(row.value)}. Click to pin.`}
            >
              <title>{`${row.label}: ${valueLabel(row.value)}`}</title>
            </circle>
          ) : null,
        )}
      </svg>
      {activeRow ? (
        <GraphTooltip
          label={activeRow.label}
          value={valueLabel(activeRow.value)}
          left={`${(x(activeIndex as number) / width) * 100}%`}
          top={`${Math.max((y(activeRow.value) / height) * 100 - 2, 0)}%`}
          pinned={selectedIndex !== null}
        />
      ) : null}

      <figcaption className="-mt-4 flex justify-between text-[11px] text-muted-foreground">
        <span>{first.label}</span>
        <span>
          Peak {valueLabel(rows[peakIndex]!.value)} · {rows[peakIndex]!.label}
        </span>
        <span>{last.label}</span>
      </figcaption>
    </figure>
  );
}

export function RadialGauge({
  label,
  value,
  max,
  valueLabel,
  detail,
  attention = false,
}: {
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  detail?: string | undefined;
  attention?: boolean | undefined;
}) {
  const percent = boundedPercent(value, max);

  return (
    <figure
      className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface-2 p-3"
      aria-label={`${label}: ${valueLabel}${detail ? `. ${detail}` : ""}`}
    >
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="21" cy="21" r="16" fill="none" className="stroke-muted" strokeWidth="3" />
          <circle
            cx="21"
            cy="21"
            r="16"
            fill="none"
            pathLength="100"
            strokeDasharray={`${percent} ${100 - percent}`}
            strokeLinecap="round"
            className={attention ? "stroke-signal" : "stroke-foreground"}
            strokeWidth="3"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">
          {Math.round(percent)}%
        </span>
      </div>
      <figcaption className="min-w-0">
        <p className="text-[12px] font-medium">{label}</p>
        <p
          className={cn(
            "mt-0.5 text-[11.5px] tabular-nums text-muted-foreground",
            attention && "text-signal",
          )}
        >
          {valueLabel}
        </p>
        {detail ? (
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">{detail}</p>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function ForecastTimeline({
  label,
  value,
  max,
  valueLabel,
  detail,
  marker,
  attention = false,
}: {
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  detail?: string | undefined;
  marker?: { value: number; label: string } | undefined;
  attention?: boolean | undefined;
}) {
  const percent = boundedPercent(value, max);
  const markerPercent = marker ? boundedPercent(marker.value, max) : null;

  return (
    <figure
      aria-label={`${label}: ${valueLabel}${detail ? `. ${detail}` : ""}`}
      className="rounded-2xl border border-hairline bg-surface-2 px-4 py-3.5"
    >
      <figcaption className="flex items-baseline justify-between gap-4 text-[12px]">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            "tabular-nums text-muted-foreground",
            attention && "font-semibold text-signal",
          )}
        >
          {valueLabel}
        </span>
      </figcaption>
      <div className="relative mt-2 h-2.5 rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500",
            attention ? "bg-signal" : "bg-foreground",
          )}
          style={{ width: `${percent}%` }}
        />
        {markerPercent !== null ? (
          <span
            className="absolute -inset-y-1 w-px bg-signal"
            style={{ left: `calc(${markerPercent}% - 0.5px)` }}
            title={marker?.label}
            aria-hidden
          />
        ) : null}
      </div>
      {detail || marker ? (
        <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>{detail}</span>
          {marker ? <span className="text-signal">{marker.label}</span> : null}
        </div>
      ) : null}
    </figure>
  );
}

export type DistributionSegment = {
  label: string;
  value: number;
  display?: string | undefined;
};

const SEGMENT_TONES = [
  { fill: "bg-signal", stroke: "stroke-signal" },
  { fill: "bg-foreground", stroke: "stroke-foreground" },
  { fill: "bg-muted-foreground", stroke: "stroke-muted-foreground" },
  { fill: "bg-border", stroke: "stroke-border" },
];

export function DistributionBar({
  segments,
  emptyLabel = "No data yet",
}: {
  segments: DistributionSegment[];
  emptyLabel?: string | undefined;
}) {
  const safe = segments.map((segment) => ({ ...segment, value: Math.max(0, segment.value) }));
  const total = safe.reduce((sum, segment) => sum + segment.value, 0);

  if (total === 0) {
    return <p className="text-[12px] text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <figure
      aria-label={safe
        .map((segment) => `${segment.label}: ${segment.display ?? segment.value}`)
        .join(", ")}
    >
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {safe.map((segment, index) =>
          segment.value > 0 ? (
            <span
              key={segment.label}
              className={cn("h-full", SEGMENT_TONES[index % SEGMENT_TONES.length]?.fill)}
              style={{ width: `${(segment.value / total) * 100}%` }}
              title={`${segment.label}: ${segment.display ?? segment.value}`}
            />
          ) : null,
        )}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground">
        {safe.map((segment, index) => (
          <span key={segment.label} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                SEGMENT_TONES[index % SEGMENT_TONES.length]?.fill,
              )}
              aria-hidden
            />
            {segment.label} <span className="tabular-nums">{segment.display ?? segment.value}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  emptyLabel = "No data yet",
}: {
  segments: DistributionSegment[];
  centerLabel: string;
  centerValue: string;
  emptyLabel?: string | undefined;
}) {
  const safe = segments.map((segment) => ({ ...segment, value: Math.max(0, segment.value) }));
  const total = safe.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  const slices = safe.map((segment) => {
    const percent = total > 0 ? (segment.value / total) * 100 : 0;
    const slice = { ...segment, percent, offset };
    offset += percent;
    return slice;
  });

  if (total === 0) {
    return <p className="text-[12px] text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <figure
      className="grid items-center gap-5 sm:grid-cols-[9rem_1fr]"
      aria-label={safe
        .map((segment) => `${segment.label}: ${segment.display ?? segment.value}`)
        .join(", ")}
    >
      <div className="relative mx-auto h-32 w-32">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" aria-hidden>
          {slices.map((segment, index) =>
            segment.value > 0 ? (
              <circle
                key={segment.label}
                cx="21"
                cy="21"
                r="15.9155"
                fill="none"
                pathLength="100"
                strokeDasharray={`${segment.percent} ${100 - segment.percent}`}
                strokeDashoffset={-segment.offset}
                className={SEGMENT_TONES[index % SEGMENT_TONES.length]?.stroke}
                strokeWidth="7"
              />
            ) : null,
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-serif text-[20px] leading-none tabular-nums">{centerValue}</span>
          <span className="mt-1 text-[9.5px] text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <figcaption className="space-y-2 text-[11.5px] text-muted-foreground">
        {safe.map((segment, index) => (
          <div key={segment.label} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  SEGMENT_TONES[index % SEGMENT_TONES.length]?.fill,
                )}
                aria-hidden
              />
              {segment.label}
            </span>
            <span className="tabular-nums">{segment.display ?? segment.value}</span>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}

export function ColumnChart({
  rows,
  highlight,
  emptyLabel = "No data yet",
}: {
  rows: { label: string; value: number; display: string }[];
  highlight?: string | undefined;
  emptyLabel?: string | undefined;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (rows.length === 0 || max === 0) {
    return <p className="py-3 text-[12px] text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <figure
      className="grid h-40 gap-3"
      style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
      aria-label={rows.map((row) => `${row.label}: ${row.display}`).join(", ")}
    >
      {rows.map((row, index) => (
        <div key={row.label} className="flex min-w-0 flex-col text-center">
          <span className="mb-2 text-[10.5px] tabular-nums text-muted-foreground">
            {row.display}
          </span>
          <div className="flex flex-1 items-end justify-center rounded-t-lg bg-muted/50">
            <span
              className={cn(
                "w-full max-w-12 rounded-t-md",
                row.label === (highlight ?? rows[0]?.label)
                  ? "bg-signal"
                  : SEGMENT_TONES[index % SEGMENT_TONES.length]?.fill,
              )}
              style={{ height: `${Math.max(boundedPercent(row.value, max), 2)}%` }}
            />
          </div>
          <span className="mt-2 truncate text-[10.5px] text-muted-foreground">{row.label}</span>
        </div>
      ))}
    </figure>
  );
}

export function WindowLineChart({
  rows,
  emptyLabel = "No data yet",
}: {
  rows: { label: string; value: number; display: string }[];
  emptyLabel?: string | undefined;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (!first || !last || max === 0) {
    return <p className="py-3 text-[12px] text-muted-foreground">{emptyLabel}</p>;
  }

  const width = 720;
  const floor = 156;
  const x = (index: number) =>
    rows.length === 1 ? width / 2 : 24 + (index / (rows.length - 1)) * (width - 48);
  const y = (value: number) => floor - (value / max) * 118;
  const points = rows.map((row, index) => `${x(index)},${y(row.value)}`).join(" ");
  const activeIndex = selectedIndex ?? hoveredIndex;
  const activeRow = activeIndex === null ? null : rows[activeIndex];

  return (
    <figure aria-label={rows.map((row) => `${row.label}: ${row.display}`).join(", ")}>
      <svg
        viewBox={`0 0 ${width} 190`}
        className="h-52 w-full"
        preserveAspectRatio="none"
        aria-hidden
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {[38, 77, 116, floor].map((line) => (
          <line
            key={line}
            x1="0"
            x2={width}
            y1={line}
            y2={line}
            stroke="var(--hairline)"
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="var(--signal)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {rows.map((row, index) => (
          <g key={row.label}>
            <circle
              cx={x(index)}
              cy={y(row.value)}
              r="4"
              fill="var(--surface)"
              stroke="var(--signal)"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onClick={() => setSelectedIndex(selectedIndex === index ? null : index)}
              tabIndex={0}
              role="button"
              aria-label={`${row.label}: ${row.display}. Click to pin.`}
            >
              <title>{`${row.label}: ${row.display}`}</title>
            </circle>
            <text
              x={x(index)}
              y={Math.max(y(row.value) - 12, 16)}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize="10"
            >
              {row.display}
            </text>
          </g>
        ))}
      </svg>
      {activeRow ? (
        <GraphTooltip
          label={activeRow.label}
          value={activeRow.display}
          left={`${(x(activeIndex as number) / width) * 100}%`}
          top={`${Math.max((y(activeRow.value) / 190) * 100 - 2, 0)}%`}
          pinned={selectedIndex !== null}
        />
      ) : null}
      <figcaption
        className="grid gap-3 text-center text-[10.5px] text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
      >
        {rows.map((row) => (
          <span key={row.label}>{row.label}</span>
        ))}
      </figcaption>
    </figure>
  );
}

function GraphTooltip({
  label,
  value,
  left,
  top,
  pinned,
}: {
  label: string;
  value: string;
  left: string;
  top: string;
  pinned: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl"
      style={{ left, top }}
    >
      <p className="font-medium">{label}</p>
      <p className="mt-0.5 tabular-nums text-muted-foreground">{value}</p>
      {pinned ? <p className="mt-1 text-[10px] text-signal">Pinned</p> : null}
    </div>
  );
}

export function ComparisonBars({
  rows,
  emptyLabel = "No data yet",
}: {
  rows: { label: string; value: number; display: string; note?: string | undefined }[];
  emptyLabel?: string | undefined;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (rows.length === 0 || max === 0) {
    return <p className="py-3 text-[12px] text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div
      className="space-y-3"
      role="img"
      aria-label={rows.map((row) => `${row.label}: ${row.display}`).join(", ")}
    >
      {rows.map((row, index) => (
        <div key={row.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-4 text-[12px]">
            <span>
              {row.label}
              {row.note ? (
                <span className="ml-2 text-[11px] text-muted-foreground">{row.note}</span>
              ) : null}
            </span>
            <span className="tabular-nums text-muted-foreground">{row.display}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full rounded-full",
                index === 0 ? "bg-signal" : "bg-foreground",
              )}
              style={{ width: `${boundedPercent(row.value, max)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LollipopChart({
  rows,
  emptyLabel = "No data yet",
}: {
  rows: { label: string; value: number; display: string }[];
  emptyLabel?: string | undefined;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (rows.length === 0 || max === 0) {
    return <p className="py-3 text-[12px] text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <figure
      className="space-y-3"
      aria-label={rows.map((row) => `${row.label}: ${row.display}`).join(", ")}
    >
      {rows.map((row, index) => {
        const position = boundedPercent(row.value, max);
        return (
          <div key={row.label} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3">
            <span className="truncate text-[11.5px] text-muted-foreground">{row.label}</span>
            <span className="relative h-px bg-border">
              <span
                className={cn(
                  "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-surface",
                  index === 0 ? "bg-signal" : "bg-foreground",
                )}
                style={{ left: `${position}%` }}
              />
            </span>
            <span className="text-right text-[11px] tabular-nums text-muted-foreground">
              {row.display}
            </span>
          </div>
        );
      })}
    </figure>
  );
}
