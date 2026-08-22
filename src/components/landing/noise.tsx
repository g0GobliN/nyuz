import { useEffect, useState } from "react";
import { NOISE_LINES } from "@/lib/sample-data";
import { useInViewOnce } from "@/lib/use-reveal";

const KEEP = new Set([0, 10, 18]);

export function NoiseSection() {
  const [calm, setCalm] = useState(false);
  const ref = useInViewOnce<HTMLDivElement>(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => setCalm(true), reduce ? 0 : 1400);
  });

  useEffect(() => {
    if (!calm) return;
    const t = setInterval(() => setCalm((c) => !c), 6000);
    return () => clearInterval(t);
  }, [calm]);

  return (
    <div ref={ref} className="grid items-center gap-12 md:grid-cols-[1fr_1.2fr]">
      <div>
        <h2 className="display text-4xl sm:text-5xl">
          The internet is loud.
          <br />
          Your briefing shouldn&apos;t be.
        </h2>
        <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          We filter the noise so you don&apos;t have to.
        </p>
      </div>

      <div className="relative h-[340px] overflow-hidden rounded-3xl border border-hairline bg-surface-2 p-4">
        <div className="flex flex-wrap content-start gap-2">
          {NOISE_LINES.map((line, i) => {
            const keep = KEEP.has(i);
            const dim = calm && !keep;
            return (
              <span
                key={line}
                className="rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-all duration-[1200ms]"
                style={{
                  borderColor: calm && keep ? "var(--signal)" : "var(--hairline)",
                  background: calm && keep ? "var(--surface)" : "transparent",
                  color: dim ? "var(--muted-foreground)" : "var(--foreground)",
                  opacity: dim ? 0.14 : 1,
                  filter: dim ? "blur(0.6px)" : "none",
                  transform: dim ? "scale(0.97)" : "scale(1)",
                  transitionDelay: `${(i % 8) * 55}ms`,
                }}
              >
                {line}
              </span>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-surface-2" />
        <p className="absolute bottom-4 left-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {calm ? "3 events worth knowing" : "Everything published in 20 minutes"}
        </p>
      </div>
    </div>
  );
}
