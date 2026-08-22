import { Mail } from "lucide-react";
import type { Story } from "@/lib/sample-data";
import { cn } from "@/lib/utils";

export function BriefingPreview({
  stories,
  time = "7:30 AM",
  name = "Vishal",
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
          <Mail className="h-3.5 w-3.5" />
          <span>brief@nyuz.app</span>
        </div>
        <span className="text-[12px] tabular-nums text-muted-foreground">{time}</span>
      </div>

      <div className="px-5 pb-2 pt-6 sm:px-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Your {time} brief
        </p>
        <h3 className="mt-2 font-serif text-2xl leading-tight sm:text-[28px]">
          {stories.length} things worth knowing, {name}.
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
            <p className="mt-3 text-[13px] leading-relaxed">
              <span className="font-medium">Why it matters · </span>
              <span className="text-muted-foreground">{s.why}</span>
            </p>
            <p className="mt-2.5 text-[11.5px] text-muted-foreground">
              Based on {s.sources} sources
            </p>
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between border-t border-hairline px-5 py-4 text-[12px] text-muted-foreground sm:px-7">
        <span>Delivered at {time}</span>
        <span>Email · Telegram</span>
      </div>
    </div>
  );
}
