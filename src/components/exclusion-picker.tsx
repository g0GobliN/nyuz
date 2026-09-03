import { Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { Chip } from "@/components/kit";
import {
  addExclusion,
  exclusionKey,
  isValidExclusion,
  MAX_EXCLUSION_LABEL,
  type ExclusionRejection,
  removeExclusion,
  validateExclusionLabel,
} from "@/lib/exclusions";
import { IGNORE_POOL } from "@/lib/topics-pool";

const REJECTION_COPY: Record<ExclusionRejection, string> = {
  empty: "",
  "too-long": `Keep it under ${MAX_EXCLUSION_LABEL} characters.`,
};

export type ExclusionPickerProps = {
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: readonly string[];
};

export function ExclusionPicker({
  selected,
  onChange,
  placeholder = "Add something you don't want to see...",
  suggestions = IGNORE_POOL,
}: ExclusionPickerProps) {
  const [query, setQuery] = useState("");

  const validated = validateExclusionLabel(query);
  const creatable = isValidExclusion(validated) ? validated : null;
  const selectedKeys = new Set(selected.map(exclusionKey));
  const duplicate = creatable ? selectedKeys.has(creatable.key) : false;
  const availableSuggestions = suggestions.filter(
    (label) => !selectedKeys.has(exclusionKey(label)),
  );

  const add = (label: string) => {
    const next = addExclusion(selected, label);
    if (next === selected) return;
    onChange(next);
    setQuery("");
  };

  const remove = (label: string) => onChange(removeExclusion(selected, label));
  const rejection: ExclusionRejection | null =
    query.trim() !== "" && !isValidExclusion(validated) ? validated.rejected : null;

  return (
    <div>
      <div className="flex items-center gap-2.5 rounded-full border border-input bg-surface px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !creatable || duplicate) return;
            e.preventDefault();
            add(creatable.label);
          }}
          placeholder={placeholder}
          aria-label="Add a global exclusion"
          className="h-12 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-[15px]"
        />
      </div>

      {creatable && !duplicate ? (
        <div className="mt-4">
          <button
            onClick={() => add(creatable.label)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] text-muted-foreground transition-all duration-300 hover:border-foreground/25 hover:text-foreground active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            Add “{creatable.label}”
          </button>
        </div>
      ) : null}

      {duplicate ? (
        <p className="mt-4 text-[12.5px] text-muted-foreground">Already excluded.</p>
      ) : null}

      {rejection ? (
        <p className="mt-4 text-[12.5px] text-muted-foreground">{REJECTION_COPY[rejection]}</p>
      ) : null}

      {selected.length > 0 ? (
        <div className="mt-6">
          <p className="text-[12.5px] text-muted-foreground">Excluded</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selected.map((label) => (
              <Chip key={label} active onClick={() => remove(label)}>
                <X className="mr-1 inline h-3 w-3" />
                {label}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      {availableSuggestions.length > 0 ? (
        <div className="mt-6">
          <p className="text-[12.5px] text-muted-foreground">Suggestions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {availableSuggestions.map((label) => (
              <Chip key={label} onClick={() => add(label)}>
                <Plus className="mr-1 inline h-3 w-3" />
                {label}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
