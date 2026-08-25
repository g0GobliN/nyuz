import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LinkButton, Chip } from "@/components/kit";
import { BriefingPreview } from "@/components/briefing-preview";
import { STORIES } from "@/lib/sample-data";

const FEED = [
  "OpenAI changelog",
  "Hacker News",
  "The Verge",
  "GitHub releases",
  "arXiv",
  "Reuters",
  "Anthropic news",
  "Vercel blog",
  "Ars Technica",
  "Reddit r/programming",
  "Newsletter #418",
  "NVIDIA newsroom",
];

/** Cinematic hero: sources → AI → one event → your briefing. */
export function HeroPipeline() {
  const [phase, setPhase] = useState(0); // 0 collect, 1 merge, 2 match, 3 deliver

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setPhase(3);
      return;
    }
    const t = setInterval(() => setPhase((p) => (p + 1) % 4), 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-md select-none">
      {/* Layer 1 — the internet */}
      <div className="relative h-32 overflow-hidden">
        <div className="absolute inset-0 flex flex-wrap justify-center gap-1.5 px-2">
          {FEED.map((f, i) => (
            <span
              key={f}
              className="rounded-full border border-hairline bg-surface px-2.5 py-1 text-[10.5px] text-muted-foreground transition-all duration-700"
              style={{
                opacity: phase === 0 ? 1 : 0.22,
                transform: phase === 0 ? "none" : `translateY(${8 + (i % 4) * 3}px) scale(0.96)`,
                transitionDelay: `${i * 25}ms`,
              }}
            >
              {f}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-background" />
      </div>

      {/* Funnel */}
      <div className="relative mx-auto -mt-2 h-16 w-px bg-gradient-to-b from-transparent via-border to-transparent">
        <span
          className="absolute left-1/2 top-0 h-8 w-px -translate-x-1/2 bg-signal"
          style={{ animation: "sweep 2.6s linear infinite" }}
        />
      </div>

      {/* Layer 2 — AI understands */}
      <div className="relative mx-auto w-full">
        <div className="relative mx-auto flex h-[132px] w-full items-center justify-center">
          {/* duplicate cards merging into one event */}
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute w-[78%] rounded-2xl border border-hairline bg-surface px-4 py-3 shadow-[var(--shadow-soft)] transition-all duration-[900ms]"
              style={{
                transform:
                  phase === 0
                    ? `translate(${(i - 1) * 42}px, ${i * 10 - 6}px) rotate(${(i - 1) * 3}deg)`
                    : "none",
                opacity: phase === 0 ? 0.65 : i === 1 ? 1 : 0,
                zIndex: i === 1 ? 2 : 1,
              }}
            >
              <p className="text-[10.5px] uppercase tracking-[0.16em] text-signal">OpenAI</p>
              <p className="mt-1 text-[14px] font-medium leading-snug">
                Lower-latency realtime tier goes GA
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {phase === 0 ? "12 articles, same story" : "12 sources → 1 event"}
              </p>
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {phase === 0
            ? "Collecting"
            : phase === 1
              ? "Duplicates merged"
              : phase === 2
                ? "Matched to your interests"
                : "Briefing ready"}
        </p>
      </div>

      <div className="relative mx-auto mt-4 h-12 w-px bg-gradient-to-b from-transparent via-border to-transparent" />

      {/* Layer 3 — delivery */}
      <div className="mx-auto flex items-center justify-center gap-2">
        {["7:30 AM", "Email"].map((d, i) => (
          <span
            key={d}
            className="rounded-full border px-3 py-1.5 text-[11.5px] transition-all duration-700"
            style={{
              borderColor: phase === 3 ? "var(--signal)" : "var(--hairline)",
              color: phase === 3 ? "var(--signal)" : "var(--muted-foreground)",
              opacity: phase === 3 ? 1 : 0.5,
              transitionDelay: `${i * 90}ms`,
            }}
          >
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

const DEMO_TOPICS = [
  "AI",
  "OpenAI",
  "Anthropic",
  "NVIDIA",
  "Cursor",
  "React",
  "Next.js",
  "Startups",
  "Cybersecurity",
  "Gaming",
];

export function InterestDemo() {
  const [selected, setSelected] = useState<string[]>(["AI", "OpenAI", "Cursor"]);
  const [building, setBuilding] = useState(false);

  const stories = useMemo(() => {
    if (selected.length === 0) return [];
    return STORIES.filter((s) =>
      s.topics.some((t) =>
        selected.some(
          (sel) =>
            t.toLowerCase().includes(sel.toLowerCase()) ||
            sel.toLowerCase().includes(t.toLowerCase()),
        ),
      ),
    ).slice(0, 4);
  }, [selected]);

  const toggle = (t: string) => {
    setBuilding(true);
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
    setTimeout(() => setBuilding(false), 550);
  };

  return (
    <div className="grid items-start gap-10 md:grid-cols-2 md:gap-14">
      <div>
        <h2 className="display text-3xl sm:text-4xl">Show us what you care about.</h2>
        <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          Tap a few topics. Watch the briefing rebuild itself.
        </p>
        <div className="mt-7 flex flex-wrap gap-2">
          {DEMO_TOPICS.map((t) => (
            <Chip key={t} active={selected.includes(t)} onClick={() => toggle(t)}>
              {selected.includes(t) ? (
                <span className="mr-1 inline-flex items-center">
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
              {t}
            </Chip>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <LinkButton to="/onboarding" size="md">
            Build my nyuz <ArrowRight className="h-4 w-4" />
          </LinkButton>
          <Link
            to="/how-it-works"
            className="text-[13.5px] text-muted-foreground hover:text-foreground"
          >
            See how it works
          </Link>
        </div>
      </div>

      <div
        className="transition-all duration-500"
        style={{ opacity: building ? 0.45 : 1, transform: building ? "translateY(8px)" : "none" }}
      >
        {stories.length > 0 ? (
          <BriefingPreview stories={stories} />
        ) : (
          <div className="rounded-3xl border border-dashed border-border p-12 text-center">
            <p className="font-serif text-xl">Nothing selected.</p>
            <p className="mt-2 text-[13.5px] text-muted-foreground">
              Pick a topic and your briefing appears.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
