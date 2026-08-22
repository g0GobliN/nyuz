import { ArrowRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Eyebrow, LinkButton } from "@/components/kit";
import { STORIES } from "@/lib/sample-data";

/** Section 33 — every story keeps its sources reachable. */
export function SourceTransparency() {
  const [story] = STORIES;
  const [open, setOpen] = useState(false);

  if (!story) return null;

  return (
    <div className="grid items-center gap-12 md:grid-cols-2">
      <div>
        <Eyebrow>Sources</Eyebrow>
        <h2 className="display mt-3 text-4xl sm:text-5xl">
          We are never
          <br />
          the source.
        </h2>
        <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
          Every line in your briefing carries the reporting it came from. Open a story and the
          original articles are one tap away, with publication times.
        </p>
      </div>

      <div className="rounded-3xl border border-hairline bg-surface p-6 sm:p-8">
        <p className="text-[11px] uppercase tracking-[0.16em] text-signal">{story.org}</p>
        <p className="mt-2 text-[17px] font-medium leading-snug">{story.title}</p>
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-hairline px-3.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Based on {story.sources} sources
          <ArrowRight
            className={"h-3.5 w-3.5 transition-transform duration-300 " + (open ? "rotate-90" : "")}
          />
        </button>

        <div
          className="grid transition-all duration-500"
          style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
        >
          <ul className="overflow-hidden">
            {story.sourceList.map((s, i) => (
              <li
                key={s.name}
                className="flex items-center justify-between gap-4 border-b border-hairline py-2.5 text-[13px] last:border-0"
                style={{ transitionDelay: `${i * 40}ms` }}
              >
                <span className="flex items-center gap-2">
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  {s.name}
                </span>
                <span className="tabular-nums text-[12px] text-muted-foreground">{s.at}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Section 43 — closing full-screen CTA. */
export function FinalCta() {
  return (
    <section className="veil relative flex min-h-[80vh] items-center justify-center px-5 py-32 text-center sm:px-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="display text-[clamp(2.4rem,7vw,4.25rem)]">
          The internet never stops.
          <br />
          You don&apos;t have to keep checking it.
        </h2>
        <div className="mt-10 flex justify-center">
          <LinkButton to="/onboarding" size="lg">
            Build my nyuz <ArrowRight className="h-4 w-4" />
          </LinkButton>
        </div>
        <p className="mt-5 text-[12.5px] text-muted-foreground">
          Free to start. No credit card required.
        </p>
      </div>
    </section>
  );
}
