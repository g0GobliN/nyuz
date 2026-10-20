import { useState } from "react";
import { bandSpans, countFor, levelFor } from "@/lib/density";
import { usePlan } from "@/lib/plan-state";
import { cn } from "@/lib/utils";

/**
 * The alignment each band's label takes: the ends outward, as a slider's labels conventionally sit, and the
 * middles centred in their own span. A lookup rather than a chain of ternaries, so the component has no
 * branch here to leave uncovered — `bandSpans` decides which alignment a band gets, and it is tested.
 */
const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;

/**
 * The row of band names under the track.
 *
 * Split out as its own component so it can be rendered and asserted without the plan and auth providers the
 * dial itself needs — the reader-facing labels are the part whose position matters, and a rule about where a
 * label sits should be provable without a signed-in reader.
 */
export function DensityLabels({ spans = bandSpans() }: { spans?: ReturnType<typeof bandSpans> }) {
  return (
    <div className="mt-3 flex text-[11.5px] uppercase tracking-[0.16em] text-muted-foreground">
      {spans.map((band) => (
        <span key={band.key} style={{ flexBasis: `${band.share}%` }} className={ALIGN[band.align]}>
          {band.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Section 22 — briefing density, expressed as a threshold rather than a quota.
 *
 * The bands are in `@/lib/density` rather than here because matching reads them
 * too, and a label whose meaning differed between the slider and the query would
 * be a promise the pipeline does not keep.
 */
export function DensityDial({
  value,
  onChange,
  className,
}: {
  value?: number;
  onChange?: (v: number) => void;
  className?: string;
}) {
  const [internal, setInternal] = useState(35);
  const { plan } = usePlan();
  const v = value ?? internal;
  const set = (next: number) => {
    if (onChange) onChange(next);
    else setInternal(next);
  };
  const level = levelFor(v);

  return (
    <div className={cn("rounded-3xl border border-hairline bg-surface p-7 sm:p-8", className)}>
      <div className="flex items-baseline justify-between">
        <span className="font-serif text-3xl">{level.label}</span>
        <span className="text-[12.5px] tabular-nums text-muted-foreground">
          {countFor(v, plan)} stories a day
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={v}
        aria-label="Briefing density"
        onChange={(e) => set(Number(e.target.value))}
        className="mt-7 h-1 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[var(--signal)]"
        style={{
          background: `linear-gradient(to right, var(--signal) ${v}%, var(--muted) ${v}%)`,
        }}
      />

      {/*
        One label per band, over the part of the track that band owns — see `bandSpans`, which holds the
        rule and is tested, rather than this component holding it.
      */}
      <DensityLabels />

      <p className="mt-6 text-[14px] leading-relaxed text-muted-foreground">{level.detail}</p>

      <div className="mt-6 flex gap-1">
        {Array.from({ length: 18 }).map((_, i) => {
          const lit = i < Math.round((v / 100) * 16) + 2;
          return (
            <span
              key={i}
              className="h-8 flex-1 rounded-[3px] transition-all duration-500"
              style={{
                background: lit ? "var(--signal)" : "var(--muted)",
                opacity: lit ? 0.25 + (i / 18) * 0.5 : 1,
                transitionDelay: `${i * 20}ms`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
