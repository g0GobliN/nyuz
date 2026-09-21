import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ColumnChart, RadialGauge } from "@/components/admin/charts";
import {
  ConsoleHeader,
  ErrorNote,
  Field,
  Loading,
  Panel,
  Pill,
  formatDateTime,
  formatNumber,
  inputClass,
  useConsoleMutation,
  useViewer,
} from "@/components/admin/shell";
import { Button, Chip } from "@/components/kit";
import {
  deleteProvider,
  getAiConfig,
  probeProvider,
  saveProvider,
  savePrompt,
  setRoute,
  type ProbeResult,
  type ProviderView,
  type RouteView,
} from "@/lib/server/ai-config";
import type { AiCapability } from "@/lib/supabase/types";

export const Route = createFileRoute("/admin/ai")({ component: AiPage });

const CAPABILITIES: { key: AiCapability; label: string; blurb: string }[] = [
  {
    key: "cluster",
    label: "Cluster",
    blurb:
      "Decides whether two articles are the same story. Runs on every ingested article, so it is the highest-volume call and wants the cheapest capable model.",
  },
  {
    key: "digest",
    label: "Digest",
    blurb:
      "Writes why each selected story matters to one reader. Plura and Omni use this quality-sensitive route; Uno uses the Flash route.",
  },
  {
    key: "reason",
    label: "Reason",
    blurb: "Answers Pro Ask AI questions about one story. Lowest volume, highest token ceiling.",
  },
];

function AiPage() {
  const { data: viewer } = useViewer();
  const isSuper = viewer?.role === "superadmin";

  const config = useQuery({
    queryKey: ["admin", "ai"],
    queryFn: () => getAiConfig(),
    staleTime: 30_000,
  });

  const [editing, setEditing] = useState<ProviderForm | null>(null);

  if (config.isLoading) return <Loading label="Loading providers" />;

  const data = config.data;

  return (
    <>
      <ConsoleHeader
        title="AI providers"
        sub="Every model call in the app resolves its provider, model and token ceiling from this page at call time. Nothing here requires a deploy."
      >
        {isSuper ? (
          <Button variant="primary" onClick={() => setEditing({ ...EMPTY_PROVIDER })}>
            <Plus className="h-4 w-4" /> Add provider
          </Button>
        ) : null}
      </ConsoleHeader>

      <ErrorNote error={config.error} />

      {!isSuper ? (
        <p className="mb-5 rounded-2xl border border-border bg-surface-2 px-5 py-4 text-[13px] leading-relaxed">
          You can read this page and edit prompt wording. Changing a provider or a route is
          restricted to superadmins — it changes where every article the pipeline touches gets sent,
          and which secret pays for it.
        </p>
      ) : null}

      {data ? (
        <div className="space-y-5">
          <Panel
            title="Token safety cap · this month"
            note={
              data.usage.budgetTokens > 0
                ? `${formatNumber(data.usage.monthTokens)} of ${formatNumber(data.usage.budgetTokens)} tokens used or reserved. Calls stop before crossing the configured ceiling.`
                : "Token safety cap unavailable. Check AI Runtime."
            }
          >
            {data.usage.budgetTokens > 0 ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(20rem,1.3fr)_minmax(10rem,0.6fr)]">
                <RadialGauge
                  label="Monthly token budget"
                  value={data.usage.monthTokens}
                  max={data.usage.budgetTokens}
                  valueLabel={`${Math.min((data.usage.monthTokens / data.usage.budgetTokens) * 100, 100).toFixed(1)}% used`}
                  detail={`${formatNumber(Math.max(data.usage.budgetTokens - data.usage.monthTokens, 0))} tokens remain · resets ${nextMonthLabel()}`}
                  attention={data.usage.monthTokens / data.usage.budgetTokens >= 0.7}
                />
                <div className="rounded-2xl border border-hairline bg-surface-2 px-4 py-3.5">
                  <p className="mb-3 text-[12px] font-medium">Usage mix</p>
                  <ColumnChart
                    rows={[
                      {
                        label: "Cluster",
                        value: data.usage.byCapability.cluster,
                        display: formatNumber(data.usage.byCapability.cluster),
                      },
                      {
                        label: "Digest",
                        value: data.usage.byCapability.digest,
                        display: formatNumber(data.usage.byCapability.digest),
                      },
                      {
                        label: "Reason",
                        value: data.usage.byCapability.reason,
                        display: formatNumber(data.usage.byCapability.reason),
                      },
                    ].sort((a, b) => b.value - a.value)}
                    emptyLabel="No token usage yet."
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <UsageStat label="Metered calls" value={data.usage.calls} />
                  <UsageStat label="Reserved tokens" value={data.usage.reservedTokens} />
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                Usage charts appear once the token safety cap is available.
              </p>
            )}
          </Panel>

          <Panel
            title="Routing"
            note={`One provider and model per capability. A change reaches every running isolate within ${data.cacheSeconds} seconds — the resolver memoises for that long so the pipeline is not making a database round trip per article.`}
          >
            <div className="space-y-4">
              {CAPABILITIES.map((cap) => (
                <RouteCard
                  key={cap.key}
                  capability={cap}
                  route={data.routes.find((r) => r.capability === cap.key)}
                  providers={data.providers}
                  canEdit={isSuper}
                />
              ))}
            </div>
          </Panel>

          <Panel
            title="Providers"
            note="Keys are never stored here. The field below holds the NAME of a Worker secret; the value stays in Cloudflare. So a leaked database is not a leaked provider account — and adding a provider is two steps: save this row, then run wrangler secret put."
          >
            {data.providers.length === 0 ? (
              <p className="py-6 text-[13.5px] text-muted-foreground">
                No providers configured. The pipeline is falling back to the DeepSeek environment
                variables it shipped with.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {data.providers.map((p) => (
                  <ProviderRow
                    key={p.id}
                    provider={p}
                    routes={data.routes}
                    canEdit={isSuper}
                    onEdit={() =>
                      setEditing({
                        id: p.id,
                        slug: p.slug,
                        label: p.label,
                        baseUrl: p.baseUrl,
                        apiKeyEnv: p.apiKeyEnv,
                        active: p.active,
                        notes: p.notes,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Prompts"
            note="The system prompt for each stage. Wording changes are an admin action; they cannot change where a request goes or what it costs."
          >
            {data.prompts.length === 0 ? (
              <p className="py-6 text-[13.5px] text-muted-foreground">
                No stored prompts. Each stage is using the prompt compiled into the pipeline.
              </p>
            ) : (
              <div className="space-y-5">
                {data.prompts.map((p) => (
                  <PromptEditor
                    key={p.key}
                    promptKey={p.key}
                    label={p.label}
                    initial={p.systemPrompt}
                  />
                ))}
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {editing ? (
        <ProviderDialog form={editing} onChange={setEditing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function nextMonthLabel(): string {
  const now = new Date();
  const label = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${label} UTC`;
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface-2 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-[18px] tabular-nums">{formatNumber(value)}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Routing                                                                */
/* ---------------------------------------------------------------------- */

function RouteCard({
  capability,
  route,
  providers,
  canEdit,
}: {
  capability: { key: AiCapability; label: string; blurb: string };
  route: RouteView | undefined;
  providers: ProviderView[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState(route?.providerId ?? providers[0]?.id ?? "");
  const [model, setModel] = useState(route?.model ?? "");
  const [maxTokens, setMaxTokens] = useState(String(route?.maxTokens ?? 8192));
  const [temperature, setTemperature] = useState(
    route?.temperature === null || route?.temperature === undefined
      ? ""
      : String(route.temperature),
  );

  const save = useConsoleMutation(setRoute, [["admin", "ai"]]);
  const probe = useConsoleMutation(probeProvider, []);

  const provider = providers.find((p) => p.id === (route?.providerId ?? providerId));
  const tokens = Number(maxTokens);

  return (
    <div className="rounded-2xl border border-hairline bg-surface-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {capability.label}
            {route ? (
              <Pill tone="neutral">{route.providerSlug}</Pill>
            ) : (
              <Pill tone="outline">unrouted — using env fallback</Pill>
            )}
            {provider && !provider.secretPresent ? <Pill tone="signal">secret missing</Pill> : null}
          </p>
          <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
            {capability.blurb}
          </p>
          {route ? (
            <p className="mt-2.5 text-[12.5px] tabular-nums text-muted-foreground">
              <span className="text-foreground">{route.model}</span> ·{" "}
              {formatNumber(route.maxTokens)} max tokens ·{" "}
              {route.temperature === null ? "provider default temp" : `temp ${route.temperature}`} ·
              updated {formatDateTime(route.updatedAt)}
            </p>
          ) : null}
        </div>

        {canEdit ? (
          <Chip active={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : route ? "Change" : "Set up"}
          </Chip>
        ) : null}
      </div>

      {open ? (
        <div className="mt-5 border-t border-hairline pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className={inputClass}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.active}>
                    {p.label} {p.active ? "" : "(inactive)"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Model" hint="Exactly as the provider names it in its API.">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={inputClass}
                placeholder="deepseek-v4-pro"
              />
            </Field>

            <Field
              label="Max tokens"
              hint="Must cover hidden reasoning tokens as well as visible output. A reasoning model that runs out mid-thought returns HTTP 200 with empty content and no error — that is the blank-briefing failure."
            >
              <input
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className={inputClass}
              />
            </Field>

            <Field label="Temperature" hint="Blank uses the provider default.">
              <input
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className={inputClass}
                placeholder="0.3"
              />
            </Field>
          </div>

          {tokens > 0 && tokens < 1024 ? (
            <p className="mt-4 text-[12.5px] text-signal">
              Below 1,024 tokens a reasoning model will spend the entire ceiling thinking and return
              nothing. The server will refuse this.
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={save.isPending || !providerId || !model}
              onClick={() =>
                save.mutate(
                  {
                    data: {
                      capability: capability.key,
                      providerId,
                      model,
                      maxTokens: Number(maxTokens) || 0,
                      // Anything unparseable becomes "use the provider default"
                      // rather than NaN, which zod would reject with a message
                      // about types instead of about the field.
                      temperature: parseTemp(temperature),
                    },
                  },
                  { onSuccess: () => setOpen(false) },
                )
              }
            >
              {save.isPending ? "Saving…" : "Save route"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={probe.isPending || !providerId || !model}
              onClick={() =>
                probe.mutate({
                  data: { providerId, model, maxTokens: Number(maxTokens) || 2048 },
                })
              }
            >
              <Activity className="h-4 w-4" />
              {probe.isPending ? "Calling…" : "Test this combination"}
            </Button>
          </div>

          <ErrorNote error={save.error} />
          <ErrorNote error={probe.error} />
          {probe.data ? <ProbeReport result={probe.data} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The probe's whole reason to exist is the case where the call succeeds and the
 * output is still empty, so the report leads with the verdict rather than a tick.
 */
function ProbeReport({ result }: { result: ProbeResult }) {
  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {result.ok ? "Reachable" : "Problem"}
        {result.httpStatus > 0 ? <Pill tone="outline">HTTP {result.httpStatus}</Pill> : null}
        {result.latencyMs > 0 ? (
          <span className="tabular-nums">{formatNumber(result.latencyMs)}ms</span>
        ) : null}
      </p>
      <p className="mt-2.5 text-[13.5px] leading-relaxed">{result.diagnosis}</p>
      {result.httpStatus === 200 ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
          <Kv label="Model echoed" value={result.modelEcho || "—"} />
          <Kv label="Finish reason" value={result.finishReason || "—"} />
          <Kv label="Content" value={`${formatNumber(result.contentChars)} chars`} />
          <Kv label="Prompt tokens" value={formatNumber(result.promptTokens)} />
          <Kv label="Completion tokens" value={formatNumber(result.completionTokens)} />
          <Kv label="Reasoning tokens" value={formatNumber(result.reasoningTokens)} />
        </dl>
      ) : null}
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** "" or nonsense means "provider default". Anything else is clamped by zod. */
function parseTemp(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------------- */
/* Providers                                                              */
/* ---------------------------------------------------------------------- */

function ProviderRow({
  provider,
  routes,
  canEdit,
  onEdit,
}: {
  provider: ProviderView;
  routes: RouteView[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  const inUse = routes.filter((r) => r.providerId === provider.id);
  const remove = useConsoleMutation(deleteProvider, [["admin", "ai"]]);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {provider.label}
            <span className="text-[12px] font-normal text-muted-foreground">{provider.slug}</span>
            {provider.active ? null : <Pill tone="outline">inactive</Pill>}
            {inUse.length > 0 ? (
              <Pill tone="neutral">{inUse.map((r) => r.capability).join(" · ")}</Pill>
            ) : null}
          </p>
          <p className="mt-1 break-all text-[12px] text-muted-foreground">{provider.baseUrl}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            <code className="font-mono">{provider.apiKeyEnv}</code>
            {provider.secretPresent ? (
              <span className="text-muted-foreground">is set in this environment</span>
            ) : (
              <span className="font-medium text-signal">
                is not set — run wrangler secret put {provider.apiKeyEnv}
              </span>
            )}
          </p>
          {provider.notes ? (
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
              {provider.notes}
            </p>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex items-center gap-2">
            <Chip onClick={onEdit}>Edit</Chip>
            {confirming ? (
              <>
                <Button
                  size="sm"
                  variant="signal"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate({ data: { id: provider.id } });
                    setConfirming(false);
                  }}
                >
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`Delete ${provider.label}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : null}
      </div>
      <ErrorNote error={remove.error} />
    </li>
  );
}

type ProviderForm = {
  id: string | undefined;
  slug: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  active: boolean;
  notes: string;
};

const EMPTY_PROVIDER: ProviderForm = {
  id: undefined,
  slug: "",
  label: "",
  baseUrl: "https://",
  apiKeyEnv: "",
  active: true,
  notes: "",
};

function ProviderDialog({
  form,
  onChange,
  onClose,
}: {
  form: ProviderForm;
  onChange: (form: ProviderForm) => void;
  onClose: () => void;
}) {
  const save = useConsoleMutation(saveProvider, [["admin", "ai"]]);
  const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) =>
    onChange({ ...form, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 bg-foreground/20 backdrop-blur-[2px]"
      />

      <div className="relative w-full max-w-lg rounded-3xl border border-hairline bg-background p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <h2 className="display text-2xl">{form.id ? "Edit provider" : "Add provider"}</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          Any provider that speaks the OpenAI chat-completions dialect works without a code change —
          one transport, one shape, every vendor.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="Label" hint="What this appears as in the routing list.">
            <input
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              className={inputClass}
              placeholder="DeepSeek"
            />
          </Field>

          <Field label="Slug" hint="Lowercase identifier. Used in logs and the routing summary.">
            <input
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
              className={inputClass}
              placeholder="deepseek"
            />
          </Field>

          <Field
            label="Base URL"
            hint="HTTPS and a public host only. This becomes a server-side fetch target, so localhost and private ranges are refused."
          >
            <input
              value={form.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              className={inputClass}
              placeholder="https://api.deepseek.com"
            />
          </Field>

          <Field
            label="Secret name"
            hint="The NAME of the environment variable holding the key — not the key. Uppercase, digits and underscores."
          >
            <input
              value={form.apiKeyEnv}
              onChange={(e) => set("apiKeyEnv", e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="DEEPSEEK_API_KEY"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field label="Notes" hint="Rate limits, quirks, who owns the account.">
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </Field>

          <label className="flex items-center gap-2.5 text-[13.5px]">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="h-4 w-4 accent-[var(--signal)]"
            />
            Active — available to route traffic to
          </label>
        </div>

        <ErrorNote error={save.error} />

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  data: {
                    ...(form.id ? { id: form.id } : {}),
                    slug: form.slug,
                    label: form.label,
                    baseUrl: form.baseUrl,
                    apiKeyEnv: form.apiKeyEnv,
                    active: form.active,
                    notes: form.notes,
                  },
                },
                { onSuccess: () => onClose() },
              )
            }
          >
            {save.isPending ? "Saving…" : "Save provider"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Prompts                                                                */
/* ---------------------------------------------------------------------- */

function PromptEditor({
  promptKey,
  label,
  initial,
}: {
  promptKey: string;
  label: string;
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  const save = useConsoleMutation(savePrompt, [["admin", "ai"]]);
  const dirty = value !== initial;

  return (
    <div className="rounded-2xl border border-hairline bg-surface-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">
          {label}
          <code className="ml-2 font-mono text-[11.5px] text-muted-foreground">{promptKey}</code>
        </p>
        {dirty ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setValue(initial)}>
              Revert
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={save.isPending}
              onClick={() => save.mutate({ data: { key: promptKey, label, systemPrompt: value } })}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : null}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={7}
        className={`${inputClass} resize-y font-mono text-[12.5px] leading-relaxed`}
      />
      <ErrorNote error={save.error} />
    </div>
  );
}
