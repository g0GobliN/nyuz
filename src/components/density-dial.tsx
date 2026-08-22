import { useState } from "react";
import { cn } from "@/lib/utils";

type Level = { max: number; label: string; detail: string; count: string };

const DEEP: Level = {
  max: 101,
  label: "Deep",
  detail: "Everything with a plausible claim on your attention.",
  count: "12–18",
};

const LEVELS: Level[] = [
  { max: 20, label: "Minimal", detail: "Only the things you would regret missing.", count: "2–3" },
  { max: 45, label: "Focused", detail: "Clear developments in the areas you track.", count: "4–6" },
  { max: 70, label: "Broad", detail: "Adds context and adjacent industry moves.", count: "7–10" },
  DEEP,
];

export function levelFor(value: number): Level {
  return LEVELS.find((l) => value < l.max) ?? DEEP;
}

/** Section 22 — briefing density, expressed as a threshold rather than a quota. */
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
          {level.count} stories a day
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

      <div className="mt-3 flex justify-between text-[11.5px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Minimal</span>
        <span>Deep</span>
      </div>

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
