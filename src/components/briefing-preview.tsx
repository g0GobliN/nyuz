import { LogoMark } from "@/components/landing/nav";
import type { Story } from "@/lib/story";
import { sourceCount } from "@/lib/story";
import { cn } from "@/lib/utils";

/**
 * `name` defaults to empty, and the headline drops the address when it is.
 *
 * The two landing-page usages pass no name at all — a marketing demo greeting
 * every visitor by one particular person's first name (which is what the old
 * default did) reads as a leaked fixture, because that is exactly what it was.
 */
export function BriefingPreview({
  stories,
  time = "7:30 AM",
  name = "",
  className,
  compact,
}: {
  stories: Story[];
  time?: string;
  name?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl border border-hairline bg-surface shadow-[var(--shadow-float)]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <LogoMark className="h-3.5 w-3.5" />
          <span>brief@nyuz.app</span>
        </div>
        <span className="text-[12px] tabular-nums text-muted-foreground">{time}</span>
      </div>

      <div className="px-5 pb-2 pt-6 sm:px-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Your {time} brief
        </p>
        <h3 className="mt-2 font-serif text-2xl leading-tight sm:text-[28px]">
          {stories.length} things worth knowing{name ? `, ${name}` : ""}.
        </h3>
      </div>

      <ol className="divide-y divide-[var(--hairline)] px-5 sm:px-7">
        {stories.map((s, i) => (
          <li key={s.id} className="py-5">
            <div className="flex items-baseline gap-3">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-signal">
                {s.org}
              </span>
            </div>
            <p className="mt-1.5 text-[16px] font-medium leading-snug">{s.title}</p>
            {!compact && (
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{s.what}</p>
            )}
            {/*
              The why-line renders only when there is one. A story with no stored
              impact, no after-state and no personalization used to print the
              heading, the separator and then nothing — which reads as a bug
              because the layout is one. The heading is the container; the
              sentence is the content; no content, no container.
            */}
            {(s.why ?? "").trim().length > 0 || s.personalization ? (
              <p className="mt-3 text-[13px] leading-relaxed">
                <span className="font-medium">Why you're seeing this · </span>
                <span className="text-muted-foreground">
                  {s.why ?? s.personalization?.explanation}
                </span>
              </p>
            ) : null}
            {/*
              "Based on N sources" is a corroboration claim, and one outlet is
              the absence of one. A single-source story states its outlet in the
              card header already; printing "Based on 1 source" under every card
              turned a fact into filler. It returns the moment a second outlet
              picks the story up.
            */}
            {s.sources > 1 ? (
              <p className="mt-2.5 text-[11.5px] text-muted-foreground">
                Based on {sourceCount(s.sources)}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between border-t border-hairline px-5 py-4 text-[12px] text-muted-foreground sm:px-7">
        <span>Delivered at {time}</span>
        <span>Email · Telegram · Notifications</span>
      </div>
    </div>
  );
}
