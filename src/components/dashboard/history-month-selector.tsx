import type { HistoryMonth } from "@/lib/history-window";
import { cn } from "@/lib/utils";

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
    <nav aria-label="History month" className="mb-6 overflow-x-auto border-b border-hairline">
      <div className="flex min-w-max gap-5">
        {months.map((month) => {
          const active = month.key === selected;
          return (
            <button
              key={month.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(month.key)}
              className={cn(
                "border-b-2 px-0.5 pb-3 text-[13px] font-medium transition-colors",
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
