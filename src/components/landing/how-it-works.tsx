import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/kit";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    n: "01",
    title: "Tell it what matters",
    body: "Topics, companies, technologies — and, just as importantly, what to ignore.",
    kind: "interests",
  },
  {
    n: "02",
    title: "It watches",
    body: "Hundreds of sources on a schedule. Company blogs, newsrooms, research pages, release notes.",
    kind: "sources",
  },
  {
    n: "03",
    title: "It understands",
    body: "Articles describing the same real-world event are merged into one event, read once, and scored for importance and novelty.",
    kind: "dedupe",
  },
  {
    n: "04",
    title: "It matches",
    body: "Your interests are compared against those events by a database query — not a language model. Your topic list never leaves our infrastructure.",
    kind: "rank",
  },
  {
    n: "05",
    title: "You receive it",
    body: "One briefing. Your time, your timezone, your channel.",
    kind: "deliver",
  },
] as const;

export function HowItWorksRail() {
  const [active, setActive] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  const cards = useCallback(
    () => Array.from(railRef.current?.querySelectorAll<HTMLElement>("[data-step]") ?? []),
    [],
  );

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;

    const sync = () => {
      const nodes = cards();
      const origin = nodes[0]?.offsetLeft ?? 0;
      let best = 0;
      let bestDist = Infinity;
      nodes.forEach((n, i) => {
        const d = Math.abs(n.offsetLeft - origin - el.scrollLeft);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);
      // 2px of slack: sub-pixel layout means scrollLeft rarely lands exactly on the max.
      setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 2);
    };

    sync();
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [cards]);

  const goTo = (i: number) => {
    const el = railRef.current;
    const nodes = cards();
    const target = nodes[Math.min(STEPS.length - 1, Math.max(0, i))];
    const origin = nodes[0]?.offsetLeft ?? 0;
    if (!el || !target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: target.offsetLeft - origin, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-6">
        <div>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="display mt-3 text-4xl sm:text-5xl">Five steps. None of them yours.</h2>
        </div>

        <div className="hidden items-center gap-4 md:flex">
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <button
                key={s.n}
                onClick={() => goTo(i)}
                aria-label={`Go to step ${s.n}: ${s.title}`}
                aria-current={i === active}
                className="h-4 w-8 py-1.5"
              >
                <span
                  className="block h-1 w-full rounded-full transition-colors duration-500"
                  style={{ background: i <= active ? "var(--signal)" : "var(--border)" }}
                />
              </button>
            ))}
          </div>

          <div className="flex gap-1.5">
            <RailButton
              label="Previous step"
              disabled={active === 0}
              onClick={() => goTo(active - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </RailButton>
            <RailButton label="Next step" disabled={atEnd} onClick={() => goTo(active + 1)}>
              <ChevronRight className="h-4 w-4" />
            </RailButton>
          </div>
        </div>
      </div>

      <div className="relative">
        {/* Signals that the rail continues past the container edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-r from-transparent to-background transition-opacity duration-500"
          style={{ opacity: atEnd ? 0 : 1 }}
        />

        <div
          ref={railRef}
          className="mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {STEPS.map((s) => (
            <article
              key={s.n}
              data-step
              className="min-h-[380px] w-[86vw] shrink-0 snap-start rounded-3xl border border-hairline bg-surface p-7 sm:w-[420px]"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-[12px] tabular-nums text-muted-foreground">{s.n}</span>
                <h3 className="text-[19px] font-medium tracking-tight">{s.title}</h3>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">{s.body}</p>
              <div className="mt-7">
                <StepVisual kind={s.kind} />
              </div>
            </article>
          ))}
        </div>
      </div>

      <p className="mt-1 text-[12.5px] text-muted-foreground md:hidden">
        Swipe to see the remaining steps.
      </p>
    </div>
  );
}

function RailButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-300",
        disabled
          ? "border-hairline text-muted-foreground opacity-35"
          : "border-border text-foreground hover:bg-muted active:scale-95",
      )}
    >
      {children}
    </button>
  );
}

function StepVisual({ kind }: { kind: (typeof STEPS)[number]["kind"] }) {
  if (kind === "interests")
    return (
      <div className="space-y-4">
        <p className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
          I care about
        </p>
        <div className="space-y-2">
          {["AI", "Developer tools", "OpenAI", "Anthropic", "Startups"].map((t, i) => (
            <div
              key={t}
              className="flex items-center gap-2.5 rounded-xl border border-hairline px-3 py-2 text-[14px] animate-rise"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <Check className="h-3.5 w-3.5 text-signal" /> {t}
            </div>
          ))}
        </div>
        <p className="pt-2 text-[12px] uppercase tracking-[0.16em] text-muted-foreground">Ignore</p>
        <div className="flex flex-wrap gap-2">
          {["Crypto", "Celebrity news", "Politics"].map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[12.5px] text-muted-foreground line-through"
            >
              <X className="h-3 w-3" /> {t}
            </span>
          ))}
        </div>
      </div>
    );

  if (kind === "sources")
    return (
      <div className="relative h-[260px] overflow-hidden">
        {[
          "Company blogs",
          "News",
          "RSS",
          "GitHub",
          "Product announcements",
          "Research",
          "Industry sources",
        ].map((s, i) => (
          <div
            key={s}
            className="absolute left-0 right-0 rounded-xl border border-hairline bg-surface-2 px-3 py-2 text-[13px]"
            style={{
              top: `${i * 34}px`,
              animation: `drift ${4 + i * 0.4}s ease-in-out infinite`,
              animationDelay: `${i * 120}ms`,
            }}
          >
            {s}
          </div>
        ))}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-surface" />
      </div>
    );

  if (kind === "dedupe")
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: 35 }).map((_, i) => (
            <span
              key={i}
              className="h-4 rounded-[4px] bg-muted"
              style={{ opacity: 1 - i * 0.02 }}
            />
          ))}
        </div>
        <p className="text-center text-[12px] text-muted-foreground">
          35 articles · same underlying event
        </p>
        <div className="rounded-2xl border border-signal/40 bg-surface p-4">
          <p className="text-[10.5px] uppercase tracking-[0.16em] text-signal">1 event</p>
          <p className="mt-1 text-[15px] font-medium">
            OpenAI ships a lower-latency realtime model tier
          </p>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          We don&apos;t summarise thirty copies. We identify the event underneath them.
        </p>
      </div>
    );

  if (kind === "rank")
    return (
      <div className="space-y-5">
        {[
          ["Relevance", 94],
          ["Importance", 91],
          ["Novelty", 87],
        ].map(([label, v], i) => (
          <div key={label as string}>
            <div className="flex justify-between text-[12.5px]">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums">{v}%</span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-muted">
              <div
                className="h-1 rounded-full bg-signal transition-[width] duration-1000"
                style={{ width: `${v}%`, transitionDelay: `${i * 150}ms` }}
              />
            </div>
          </div>
        ))}
        <div className="mt-6 rounded-2xl border border-hairline bg-surface-2 p-4">
          <p className="text-[13px]">Selected for your 7:30 brief</p>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="font-serif text-4xl">7:30 AM</p>
      <div className="flex gap-2">
        {["Email", "Telegram", "WhatsApp"].map((c) => (
          <span
            key={c}
            className="rounded-full border border-hairline px-3 py-1.5 text-[12.5px] text-muted-foreground"
          >
            {c}
          </span>
        ))}
      </div>
      <div className="rounded-2xl border border-hairline bg-surface-2 p-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Your 7:30 brief
        </p>
        <p className="mt-2 text-[14px] font-medium">4 things worth knowing</p>
        <ul className="mt-3 space-y-2 text-[13px] text-muted-foreground">
          <li>OpenAI realtime tier goes GA</li>
          <li>Cursor adds background review agents</li>
          <li>React compiler reaches stable</li>
          <li>TypeScript checker gets faster</li>
        </ul>
      </div>
    </div>
  );
}

export function Comparison() {
  return (
    <div>
      <h2 className="display max-w-2xl text-4xl sm:text-5xl">
        You shouldn&apos;t need a second job to stay informed.
      </h2>
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        <div className="rounded-3xl border border-hairline p-7">
          <p className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
            Normal news
          </p>
          <ol className="mt-6 space-y-3">
            {["Search", "Scroll", "Click", "Read", "Repeat", "Waste time"].map((s, i) => (
              <li
                key={s}
                className="reveal flex items-center gap-3 text-[15px] text-muted-foreground"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <span className="h-px w-6 bg-border" />
                {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-3xl border border-signal/30 bg-surface p-7 shadow-[var(--shadow-soft)]">
          <p className="text-[12px] uppercase tracking-[0.16em] text-signal">nyuz</p>
          <ol className="mt-6 space-y-3">
            {["Tell us once", "We monitor", "We filter", "We summarise", "You receive", "Done"].map(
              (s, i) => (
                <li
                  key={s}
                  className="reveal flex items-center gap-3 text-[15px]"
                  style={{ transitionDelay: `${i * 60}ms` }}
                >
                  <span className="h-px w-6 bg-signal" />
                  {s}
                </li>
              ),
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
