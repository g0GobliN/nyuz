import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { Button, Chip } from "@/components/kit";
import { usePrefs } from "@/lib/prefs-store";
import { IGNORE_POOL, TOPIC_POOL } from "@/lib/sample-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/topics")({
  component: Topics,
  head: () => ({ meta: [{ title: "Topics — nyuz" }] }),
});

type TopicConfig = {
  importance: "Everything" | "Notable" | "Only major";
  frequency: "Daily" | "Weekly" | "Breaking only";
  keywords: string;
  exclude: string;
};

const DEFAULT_CONFIG: TopicConfig = {
  importance: "Notable",
  frequency: "Daily",
  keywords: "",
  exclude: "",
};

function Topics() {
  const { prefs, update } = usePrefs();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, TopicConfig>>({});
  const [note, setNote] = useState("Only tell me about React when something significant happens.");

  const suggestions = useMemo(
    () =>
      TOPIC_POOL.filter(
        (t) => !prefs.topics.includes(t) && t.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [prefs.topics, q],
  );

  const custom = q.trim();
  const canAdd =
    custom.length > 1 && !prefs.topics.some((t) => t.toLowerCase() === custom.toLowerCase());

  const add = (t: string) => {
    update({ topics: [...prefs.topics, t] });
    setQ("");
  };
  const remove = (t: string) => update({ topics: prefs.topics.filter((x) => x !== t) });

  const cfg = (t: string) => configs[t] ?? DEFAULT_CONFIG;
  const setCfg = (t: string, p: Partial<TopicConfig>) =>
    setConfigs((c) => ({ ...c, [t]: { ...cfg(t), ...p } }));

  const toggleExclusion = (t: string) =>
    update({
      exclusions: prefs.exclusions.includes(t)
        ? prefs.exclusions.filter((x) => x !== t)
        : [...prefs.exclusions, t],
    });

  return (
    <DashboardShell title="Topics">
      <PageHeader
        eyebrow="Your nyuz"
        title="What do you want to know about?"
        sub="Topics decide what is even considered. Importance decides how much of it survives the filter."
      />

      <div className="flex items-center gap-2.5 rounded-full border border-input bg-surface px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canAdd && add(custom)}
          placeholder="Add a company, technology or theme"
          className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        {canAdd ? (
          <Button size="sm" onClick={() => add(custom)} className="my-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        ) : null}
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((t) => (
            <Chip key={t} onClick={() => add(t)}>
              <Plus className="mr-1 inline h-3 w-3" />
              {t}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="mt-9 space-y-2">
        {prefs.topics.length === 0 ? (
          <EmptyState
            title="No topics yet."
            body="Your nyuz has nothing to watch for. Add a few above and the next briefing fills in."
          />
        ) : null}

        {prefs.topics.map((t) => {
          const isOpen = open === t;
          const c = cfg(t);
          return (
            <div key={t} className="overflow-hidden rounded-2xl border border-hairline bg-surface">
              <div className="flex items-center gap-3 px-5 py-4">
                <button
                  onClick={() => setOpen(isOpen ? null : t)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <span className="text-[15px] font-medium">{t}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {c.importance} · {c.frequency}
                  </span>
                  <ChevronDown
                    className={cn(
                      "ml-auto h-4 w-4 text-muted-foreground transition-transform duration-300",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                <button
                  onClick={() => remove(t)}
                  aria-label={`Remove ${t}`}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div
                className="grid transition-all duration-400"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <div className="space-y-5 border-t border-hairline px-5 py-5">
                    <Segmented
                      label="How much of it"
                      value={c.importance}
                      options={["Everything", "Notable", "Only major"]}
                      onChange={(v) => setCfg(t, { importance: v as TopicConfig["importance"] })}
                    />
                    <Segmented
                      label="How often"
                      value={c.frequency}
                      options={["Daily", "Weekly", "Breaking only"]}
                      onChange={(v) => setCfg(t, { frequency: v as TopicConfig["frequency"] })}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Keywords to prioritise"
                        placeholder="release, pricing, GA"
                        value={c.keywords}
                        onChange={(v) => setCfg(t, { keywords: v })}
                      />
                      <Field
                        label="Keywords to exclude"
                        placeholder="rumour, leak"
                        value={c.exclude}
                        onChange={(v) => setCfg(t, { exclude: v })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <section className="mt-12">
        <h2 className="text-[17px] font-medium tracking-tight">Never send me</h2>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          Exclusions win over topics. If a story matches both, it stays out.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {Array.from(new Set([...IGNORE_POOL, ...prefs.exclusions])).map((t) => {
            const on = prefs.exclusions.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleExclusion(t)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-all duration-300 active:scale-95",
                  on
                    ? "border-transparent bg-muted text-muted-foreground line-through"
                    : "border-border bg-surface hover:border-foreground/25",
                )}
              >
                {on ? <X className="h-3 w-3" /> : null}
                {t}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-[17px] font-medium tracking-tight">
          Tell us anything else you want us to know
        </h2>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          Plain language. This is applied when your briefing is written.
        </p>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-4 w-full resize-none rounded-2xl border border-input bg-surface px-4 py-3 text-[14.5px] outline-none focus:border-signal"
        />
      </section>
    </DashboardShell>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <div className="mt-2 inline-flex flex-wrap gap-1 rounded-full border border-hairline bg-surface-2 p-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12.5px] transition-all duration-300",
              value === o
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[12.5px] text-muted-foreground">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 h-10 w-full rounded-xl border border-input bg-surface px-3.5 text-[13.5px] outline-none placeholder:text-muted-foreground focus:border-signal"
      />
    </div>
  );
}
