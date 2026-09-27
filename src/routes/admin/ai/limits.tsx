import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import {
  ConsoleHeader,
  ErrorNote,
  Loading,
  Panel,
  Pill,
  inputClass,
  formatDateTime,
  useConsoleMutation,
} from "@/components/admin/shell";
import { Button } from "@/components/kit";
import { cn } from "@/lib/utils";
import {
  getAiRuntimeSettings,
  resetAiRuntimeSetting,
  saveAiRuntimeSettings,
  type AiSettingView,
  type SaveAiRuntimeResult,
} from "@/lib/server/ai-runtime";

/**
 * Limits tab — emergency safety caps and runtime limits.
 *
 * Every number on this tab used to live in two places that could not check each
 * other — a local `.env` for `npm run pipeline`, a Cloudflare variable for the
 * Worker — or, for three of them, in a `const` that needed a deploy to change.
 * The tab exists so that tuning the AI is one edit in one place, and so that the
 * question "which value is actually in force right now?" has a visible answer
 * instead of requiring someone to read two environments.
 *
 * That last part is why every control shows three things rather than one: what
 * the database holds, what is effective, and which of database / environment /
 * code default produced it. A single input box would hide precisely the state
 * that makes this confusing.
 */

type SettingSearch = { setting?: string };

export const Route = createFileRoute("/admin/ai/limits")({
  component: RuntimeTab,
  // Deep links from the AI status card land here with the offending control
  // named, so "Increase budget" opens the budget field rather than a page the
  // operator then has to search.
  validateSearch: (search: Record<string, unknown>): SettingSearch =>
    typeof search["setting"] === "string" ? { setting: search["setting"] } : {},
});

type Draft = Record<string, number | boolean | string>;

function RuntimeTab() {
  const { setting: focusKey } = Route.useSearch();
  const navigate = useNavigate();

  const settings = useQuery({
    queryKey: ["admin", "ai-runtime"],
    queryFn: () => getAiRuntimeSettings(),
    staleTime: 15_000,
  });

  const [draft, setDraft] = useState<Draft>({});
  const [pending, setPending] = useState<SaveAiRuntimeResult["confirmations"]>([]);
  const [saved, setSaved] = useState(false);

  const save = useConsoleMutation(saveAiRuntimeSettings, [
    ["admin", "ai-runtime"],
    // The status tab and the credit card both read the ceilings this changes.
    // ai-spend too: the Status gauge pairs the new ceiling with its forecast,
    // and a stale forecast would name a stop date the new cap no longer has.
    ["admin", "ai-status"],
    ["admin", "ai-spend"],
    ["admin", "cost"],
    ["admin", "ai-config"],
  ]);
  const reset = useConsoleMutation(resetAiRuntimeSetting, [
    ["admin", "ai-runtime"],
    ["admin", "ai-status"],
    ["admin", "ai-spend"],
  ]);

  // Memoised because `?? []` would otherwise be a fresh array every render,
  // making the `changes` memo below recompute on every keystroke of every field.
  const rows = useMemo(() => settings.data?.settings ?? [], [settings.data]);

  // Only genuinely different values are sent. Typing 8 over 8 should not stamp
  // `changed_by` and `changed_at` with a change that was not one — the audit
  // trail on this table is meant to answer "who moved the budget", and noise
  // from no-op saves is exactly what makes that question hard later.
  const changes = useMemo(
    () =>
      rows
        .filter((row) => row.key in draft && draft[row.key] !== currentValue(row))
        .map((row) => ({ key: row.key, value: draft[row.key]! })),
    [rows, draft],
  );

  useEffect(() => {
    if (changes.length > 0) setSaved(false);
  }, [changes.length]);

  const onSave = (confirmed: boolean) => {
    setSaved(false);
    save.mutate(
      { data: { changes, confirmed } },
      {
        onSuccess: (result) => {
          if (!result.ok) {
            setPending(result.confirmations);
            return;
          }
          setPending([]);
          setDraft({});
          setSaved(true);
        },
      },
    );
  };

  if (settings.isLoading) return <Loading label="Reading AI runtime settings" />;
  if (settings.error) return <ErrorNote error={settings.error} />;

  const cacheSeconds = settings.data?.cacheSeconds ?? 60;

  return (
    <>
      <ConsoleHeader
        title="AI limits"
        sub="Emergency safety caps and runtime limits. Provider top-ups are recorded on the Spend tab. Saved controls apply to both the local pipeline and the deployed Worker."
      />

      <Panel
        title="How these resolve"
        note={`A value set here wins. With nothing set, the matching environment variable is used, and failing that a safe built-in default — so a fresh deployment behaves exactly as it did before these controls existed. Every setting shows which of the three is in force. Saves reach the isolate you are talking to at once and every other one within ${cacheSeconds} seconds.`}
        className="mb-5"
      >
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          The minimum and maximum on each control are ceilings in code, not preferences. They are
          enforced again when the value is read, so a row edited around this tab still cannot push
          the pipeline past them.
        </p>
      </Panel>

      <div className="space-y-3">
        {rows.map((row) => (
          <SettingCard
            key={row.key}
            row={row}
            focused={row.key === focusKey}
            draftValue={draft[row.key]}
            onChange={(value) => setDraft((d) => ({ ...d, [row.key]: value }))}
            onRevert={() =>
              setDraft((d) => {
                const next = { ...d };
                delete next[row.key];
                return next;
              })
            }
            onReset={() => reset.mutate({ data: { key: row.key } })}
            resetting={reset.isPending}
            onClearFocus={() => void navigate({ to: "/admin/ai/limits", search: {} })}
          />
        ))}
      </div>

      <ErrorNote error={save.error ?? reset.error} />

      {pending.length > 0 ? (
        <Panel title="Confirm" className="mt-5 border-signal">
          <ul className="mt-4 space-y-3">
            {pending.map((c) => (
              <li key={c.key} className="flex items-start gap-2 text-[13px] leading-relaxed">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
                <span>
                  <strong className="font-medium">{c.label}.</strong> {c.message}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="signal"
              onClick={() => onSave(true)}
              disabled={save.isPending}
            >
              {save.isPending ? "Saving…" : "Confirm and save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending([])}>
              Cancel
            </Button>
          </div>
        </Panel>
      ) : null}

      {/* Sticky rather than at the foot of a long list: with nine controls the
          save button would otherwise scroll out of sight of the field being
          edited, which is how people lose changes. */}
      <div className="sticky bottom-4 mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-surface px-5 py-4 shadow-[var(--shadow-soft)]">
        <Button
          size="sm"
          onClick={() => onSave(false)}
          disabled={changes.length === 0 || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        <span className="text-[12.5px] text-muted-foreground">
          {changes.length === 0
            ? saved
              ? "Saved. Effective everywhere within the cache window."
              : "No changes."
            : `${changes.length} change${changes.length === 1 ? "" : "s"} ready.`}
        </span>
        {saved && changes.length === 0 ? (
          <Check className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : null}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* One control                                                            */
/* ---------------------------------------------------------------------- */

function SettingCard({
  row,
  focused,
  draftValue,
  onChange,
  onRevert,
  onReset,
  resetting,
  onClearFocus,
}: {
  row: AiSettingView;
  focused: boolean;
  draftValue: number | boolean | string | undefined;
  onChange: (value: number | boolean | string) => void;
  onRevert: () => void;
  onReset: () => void;
  resetting: boolean;
  onClearFocus: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const value = draftValue ?? currentValue(row);
  const dirty = draftValue !== undefined && draftValue !== currentValue(row);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-3xl border bg-surface p-6 transition-colors duration-500 sm:p-7",
        focused ? "border-signal" : "border-hairline",
      )}
      onFocusCapture={focused ? onClearFocus : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium">{row.label}</h3>
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
            {row.description}
          </p>
        </div>
        <SourcePill source={row.source} />
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <span className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {row.kind === "boolean" ? "Setting" : "Configured value"}
          </span>
          <Control row={row} value={value} onChange={onChange} />
          {row.kind !== "boolean" ? (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {row.options
                ? `Options: ${row.options.join(", ")}`
                : `Allowed: ${display(row.min ?? 0, row)}–${display(row.max ?? 0, row)}`}
            </p>
          ) : null}
        </div>

        <dl className="space-y-1.5 text-[12.5px]">
          <Line label="Effective now" value={display(row.effectiveValue, row)} strong />
          <Line
            label="Configured in database"
            value={row.dbValue === null ? "Not set" : display(row.dbValue, row)}
          />
          {row.envVar ? (
            <Line
              label="Environment fallback"
              value={row.envValue === null ? "Not set" : `${row.envValue} (${row.envVar})`}
            />
          ) : null}
          {row.changedAt ? (
            <Line
              label="Last changed"
              value={`${formatDateTime(row.changedAt)}${row.changedBy ? ` by ${row.changedBy}` : ""}`}
            />
          ) : null}
        </dl>
      </div>

      {row.invalid ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-signal bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
          <span>
            {row.invalid.source === "database"
              ? "The saved value"
              : `${row.envVar} in this environment`}{" "}
            is {row.invalid.value}, which is {row.invalid.reason}. It is being skipped, and for the
            monthly safety caps the pipeline refuses to run at all rather than spend against a
            ceiling nobody meant. Save a value inside the permitted range to clear this.
          </span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {dirty ? (
          <Button size="sm" variant="ghost" onClick={onRevert}>
            Discard
          </Button>
        ) : null}
        {row.source === "database" && row.envVar ? (
          <Button size="sm" variant="ghost" onClick={onReset} disabled={resetting}>
            <RotateCcw className="h-3 w-3" />
            Clear admin value
          </Button>
        ) : null}
        {row.source === "environment" ? (
          <span className="text-[11.5px] text-muted-foreground">
            Currently from {row.envVar}. Saving a value here takes over from it in both runtimes.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Control({
  row,
  value,
  onChange,
}: {
  row: AiSettingView;
  value: number | boolean | string;
  onChange: (value: number | boolean | string) => void;
}) {
  if (row.kind === "boolean") {
    return (
      <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-[14px]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
        <span>{value === true ? "On" : "Off"}</span>
      </label>
    );
  }

  if (row.kind === "enum") {
    return (
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        {(row.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option === "default" ? "Default (send nothing)" : option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type="number"
      value={String(value)}
      min={row.min ?? undefined}
      max={row.max ?? undefined}
      // Dollars take cents; token counts and batch sizes are whole numbers, and
      // a spinner offering 8.5 events per run would be offering nonsense.
      step={row.unit === "usd" ? "0.01" : "1"}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      className={cn(inputClass, "tabular-nums")}
    />
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-medium")}>{value}</dd>
    </div>
  );
}

/**
 * Where the effective value came from.
 *
 * Signal tone for the environment case on purpose. It is not an error — env is a
 * legitimate fallback — but it is the state an operator most often needs to
 * notice, because it is the one where "I changed it and nothing happened" is
 * about to happen: they edited the other runtime's environment, not this.
 */
function SourcePill({ source }: { source: AiSettingView["source"] }) {
  if (source === "database") return <Pill tone="neutral">Source: DB</Pill>;
  if (source === "environment") return <Pill tone="signal">Source: environment fallback</Pill>;
  return <Pill tone="outline">Source: default</Pill>;
}

/* ---------------------------------------------------------------------- */
/* Formatting                                                             */
/* ---------------------------------------------------------------------- */

function currentValue(row: AiSettingView): number | boolean | string {
  // The effective value, not the stored one: the input starts from what is
  // actually running. Starting from a blank row would show 0 for a setting the
  // pipeline is happily using an env value for, and saving that blank would be
  // a silent, drastic cut.
  return row.effectiveValue;
}

function display(value: number | boolean | string, row: AiSettingView): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") return value === "default" ? "Default" : value;
  if (row.unit === "usd") return `$${value.toFixed(2)}`;
  return value.toLocaleString("en-US");
}
