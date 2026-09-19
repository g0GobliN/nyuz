import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { cityName, offsetLabel, sameZone, searchTimezones, timezoneOptions } from "@/lib/timezones";

/**
 * Searchable IANA timezone picker.
 *
 * Selection is constrained to the zones the runtime can schedule in — there is
 * no free-text path to a stored value, because a typo here means a briefing
 * that never sends. The label is cosmetic; `onChange` always emits the
 * canonical id.
 */
export function TimezoneSelect({
  id,
  value,
  onChange,
  className,
}: {
  id?: string;
  value: string;
  onChange: (timezone: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Offsets are read once per mount rather than per render: they only change
  // at a DST boundary, and recomputing ~450 of them on every keystroke is the
  // one thing that would make this picker feel slow.
  const options = useMemo(() => timezoneOptions(value), [value]);
  const results = useMemo(() => searchTimezones(query, options), [query, options]);

  const offset = offsetLabel(value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "mt-2 flex h-12 w-full items-center justify-between gap-2 rounded-2xl border border-input bg-background px-4 text-left text-[16px] outline-none focus:border-signal md:text-[14.5px]",
            className,
          )}
        >
          <span className="truncate">
            {cityName(value)}
            {offset ? <span className="text-muted-foreground"> · {offset}</span> : null}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-3rem)] p-0"
        align="start"
      >
        {/* cmdk's own filter is off: the list is searched and capped upstream,
            so only the rows that can match are ever mounted. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search a city or timezone"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No timezone matches that.</CommandEmpty>
            {results.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4 shrink-0",
                    // Identity, not string equality: a reader stored as
                    // `Asia/Katmandu` must still see Kathmandu ticked.
                    sameZone(option.value, value) ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate">
                  {option.city}
                  {option.region ? (
                    <span className="text-muted-foreground"> · {option.region}</span>
                  ) : null}
                </span>
                <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {option.offset}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
