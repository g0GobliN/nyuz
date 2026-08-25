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
    <div ref={ref} className="grid items-start gap-12 md:grid-cols-[1fr_1.1fr]">
      <div>
        <h2 className="display text-4xl sm:text-5xl">
          The internet is loud.
          <br />
          Your briefing shouldn&apos;t be.
        </h2>
        <div className="mt-6 max-w-md space-y-4 text-[15px] leading-relaxed text-muted-foreground">
          <p>
            Every morning the same ritual. Twenty tabs. Four newsletters you skim and delete. An
            hour on X telling yourself it&apos;s research. And still the one thing that actually
            mattered to your work reached you three days late, from a colleague, in passing.
          </p>
          <p>
            The problem was never access to information. It&apos;s that there is far too much of it,
            almost none of it is for you, and the same story arrives thirty times wearing thirty
            different headlines.
          </p>
          <p className="text-foreground">
            <strong className="font-medium">nyuz watches instead of you.</strong> You say what
            matters. It reads everything, works out what actually happened, throws away the noise
            and the duplicates, and sends you the handful of things worth knowing — at the time you
            choose, in the format you choose.
          </p>
          <p>
            Most mornings that&apos;s six stories. Some mornings it&apos;s one. Occasionally
            it&apos;s none, and we tell you that rather than padding it out.
          </p>
        </div>
      </div>

      <div className="flex h-[360px] flex-col overflow-hidden rounded-3xl border border-hairline bg-surface-2">
        <div className="relative min-h-0 flex-1 overflow-hidden px-4 pt-4">
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
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-surface-2" />
        </div>
        <p className="shrink-0 bg-surface-2 px-4 pb-4 pt-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {calm ? "3 events worth knowing" : "Everything published in 20 minutes"}
        </p>
      </div>
    </div>
  );
}
