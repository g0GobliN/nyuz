import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Button } from "@/components/kit";
import { openBillingPortal, startCheckout } from "@/lib/server/billing";
import { usePlan } from "@/lib/plan-state";
import {
  DEFAULT_ANNUAL_PRICES,
  DEFAULT_PLAN_PRICES,
  PLAN_LIMITS,
  formatTopicLimit,
  formatUsd,
} from "@/lib/plans";
import { usePrefs } from "@/lib/prefs-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/billing")({
  component: Billing,
  head: () => ({ meta: [{ title: "Billing — nyuz" }] }),
});

const PLANS = [
  {
    id: "free",
    name: "Free",
    monthly: 0,
    annual: 0,
    ...PLAN_LIMITS.free,
    features: ["Up to 18 stories", "3 priority sources", "Flash briefing", "No alerts or Ask AI"],
  },
  {
    id: "personal",
    name: "Personal",
    monthly: DEFAULT_PLAN_PRICES.personal,
    annual: DEFAULT_ANNUAL_PRICES.personal,
    ...PLAN_LIMITS.personal,
    features: [
      "Up to 30 stories",
      "15 priority sources",
      "3 important alerts per week",
      "10 Flash Ask AI questions per day",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: DEFAULT_PLAN_PRICES.pro,
    annual: DEFAULT_ANNUAL_PRICES.pro,
    ...PLAN_LIMITS.pro,
    features: [
      "Up to 50 stories",
      "Unlimited priority sources",
      "10 configurable alerts per day",
      "15 Pro Ask AI questions per day",
    ],
  },
] as const;

function Billing() {
  const { prefs } = usePrefs();
  // The plan comes from the subscription row now, not from local state that
  // reset to "free" on every visit regardless of what the reader was paying.
  const { plan: current } = usePlan();
  const [annual, setAnnual] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = PLANS.find((p) => p.id === current) ?? PLANS[0];

  /**
   * Hands off to Stripe.
   *
   * `window.location.assign` rather than the router: the destination is another
   * origin, and a client-side navigation cannot leave the app. Nothing is marked
   * done here — the plan is applied when the webhook arrives, so a reader who
   * closes the tab on Stripe's success page still gets what they paid for.
   */
  const goTo = async (
    id: string,
    run: () => Promise<{ ok: boolean; url?: string; error?: string }>,
  ) => {
    setBusy(id);
    setError(null);
    try {
      const result = await run();
      if (result.ok && result.url) {
        window.location.assign(result.url);
        return;
      }
      setError(result.error ?? "Something went wrong.");
    } catch (cause) {
      console.error(cause);
      setError("Could not reach the payment provider.");
    } finally {
      setBusy(null);
    }
  };

  const upgrade = (id: "personal" | "pro") =>
    goTo(id, () => startCheckout({ data: { plan: id, interval: annual ? "year" : "month" } }));

  const manage = () => goTo("manage", () => openBillingPortal());
  const overTopics = prefs.topics.length > plan.topics;

  return (
    <DashboardShell title="Billing">
      <PageHeader
        eyebrow="Plan"
        title="Billing."
        sub="Change plans at any time. Topic limits apply from your next briefing."
      />

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Current plan
            </p>
            <p className="mt-2 font-serif text-3xl">{plan.name}</p>
          </div>
          <div className="text-right">
            <p className="text-[13px] text-muted-foreground">
              {plan.monthly === 0 ? "No payment method needed" : "Managed securely by Stripe"}
            </p>
            <p className="mt-1 text-[13px] tabular-nums">
              {plan.monthly === 0
                ? formatUsd(0)
                : annual
                  ? `${formatUsd(plan.annual)} / year`
                  : `${formatUsd(plan.monthly)} / month`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-6 border-t border-hairline pt-5 text-[13px]">
          <span>
            <span className="text-muted-foreground">Topics · </span>
            <span className={cn("tabular-nums", overTopics && "text-destructive")}>
              {prefs.topics.length} of {formatTopicLimit(plan.topics)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Archive · </span>
            {plan.retention}
          </span>
          <span>
            <span className="text-muted-foreground">Channels · </span>
            {Object.entries(prefs.channels)
              .filter(([, v]) => v)
              .map(([k]) => k)
              .join(", ") || "none"}
          </span>
        </div>

        {overTopics ? (
          <p className="mt-4 text-[12.5px] text-destructive">
            You have more topics than this plan allows. The lowest-weighted ones are paused until
            you upgrade or remove some.
          </p>
        ) : null}
      </section>

      <div className="mt-9 flex items-center justify-between gap-4">
        <h2 className="text-[17px] font-medium tracking-tight">Change plan</h2>
        <div className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface p-1">
          {[
            { k: false, label: "Monthly" },
            { k: true, label: "Annual" },
          ].map((o) => (
            <button
              key={String(o.k)}
              onClick={() => setAnnual(o.k)}
              className={cn(
                "rounded-full px-3.5 py-1 text-[12.5px] transition-all duration-300",
                annual === o.k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {PLANS.map((p) => {
          const active = p.id === current;
          return (
            <div
              key={p.id}
              className={cn(
                "flex flex-col rounded-3xl border p-6",
                active ? "border-signal/40 bg-surface" : "border-hairline bg-surface",
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-medium">{p.name}</p>
                {active ? (
                  <span className="rounded-full bg-signal/15 px-2.5 py-0.5 text-[11px] text-signal">
                    Current
                  </span>
                ) : null}
              </div>
              <p className="mt-4">
                <span className="flex items-baseline gap-1.5">
                  <span className="display text-4xl tabular-nums">
                    {formatUsd(annual && p.monthly > 0 ? p.annual : p.monthly)}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {p.monthly === 0 ? "forever" : annual ? "per year" : "per month"}
                  </span>
                </span>
                {p.monthly > 0 ? (
                  <span className="mt-1 block text-[12.5px] tabular-nums text-muted-foreground">
                    {annual
                      ? `${formatUsd(p.monthly)} per month`
                      : `${formatUsd(p.annual)} per year`}
                  </span>
                ) : null}
              </p>
              <ul className="mt-5 flex-1 space-y-2">
                <li className="flex items-start gap-2 text-[13.5px]">
                  <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal" />
                  {p.topics === Infinity ? "Unlimited topics" : `${p.topics} topics`}
                </li>
                <li className="flex items-start gap-2 text-[13.5px]">
                  <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal" />
                  {p.retention}
                </li>
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13.5px]">
                    <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={active ? "outline" : "primary"}
                size="sm"
                className="mt-6 w-full"
                // The free tier is not something to check out of. Leaving a paid
                // plan happens in Stripe's portal, where the proration and the
                // cancellation date are Stripe's problem rather than ours.
                disabled={active || busy !== null || (p.id === "free" && current === "free")}
                onClick={() => {
                  if (p.id === "free") void manage();
                  else void upgrade(p.id as "personal" | "pro");
                }}
              >
                {busy === p.id
                  ? "Opening Stripe…"
                  : active
                    ? "Your plan"
                    : p.monthly === 0
                      ? "Downgrade"
                      : `Switch to ${p.name}`}
              </Button>
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-5 text-[12.5px] text-destructive">{error}</p> : null}

      <p className="mt-5 text-[12.5px] text-muted-foreground">
        {current === "free"
          ? "Payment is handled by Stripe. Your plan updates once the payment clears, which can take a few seconds after you return."
          : "Cancelling, resuming and changing your card are all handled in Stripe's billing portal."}
        {current !== "free" ? (
          <>
            {" "}
            <button
              onClick={() => void manage()}
              disabled={busy !== null}
              className="text-foreground underline underline-offset-4 disabled:opacity-50"
            >
              {busy === "manage" ? "Opening…" : "Manage billing"}
            </button>
          </>
        ) : null}
      </p>

      <section className="mt-10">
        <h2 className="text-[17px] font-medium tracking-tight">Invoices</h2>
        <p className="mt-4 rounded-2xl border border-hairline bg-surface px-5 py-8 text-[13.5px] leading-relaxed text-muted-foreground">
          Receipts from Stripe will show here after a paid period. The free plan does not generate
          one.
        </p>
      </section>
    </DashboardShell>
  );
}
