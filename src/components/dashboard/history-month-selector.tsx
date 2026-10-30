import type { HistoryMonth } from "@/lib/history-window";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/kit";

export function HistoryMonthSelector({
  months,
  selected,
  onSelect,
}: {
  months: HistoryMonth[];
  selected: string | null;
  onSelect: (month: string) => void;
}) {
  if (months.length <= 1) return null;

  return (
    /*
     * Below `sm` this stays one scrolling row — thirteen labels do not fit a
     * phone and shrinking them is not an option — so the row snaps month to
     * month and the label at the edge is cut by a fade rather than by the
     * container. At `sm` and up it wraps instead: thirteen words on two lines
     * hides nothing, which is what the strip used to do behind an invisible
     * scroll (10 of 13 months were reachable only by a scroll no one could see).
     * The mask is alpha only, so it introduces no colour, and it lives on the
     * scroller itself — a fade element inside a scroller would scroll away with
     * the content.
     */
    <nav
      aria-label="History month"
      className="mb-6 overflow-x-auto border-b border-hairline sm:overflow-visible max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-2 max-sm:[mask-image:linear-gradient(to_right,black_88%,transparent)]"
    >
      <div className="flex min-w-max gap-5 sm:min-w-0 sm:flex-wrap">
        {months.map((month) => {
          const active = month.key === selected;
          return (
            <button
              key={month.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(month.key)}
              className={cn(
                "border-b-2 px-0.5 pb-3 text-[13px] font-medium transition-colors max-sm:snap-start",
                focusRing,
                active
                  ? "border-signal text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {month.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
