import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Button } from "@/components/kit";
import { useRadar } from "@/lib/radar-store";
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
    topics: 3,
    retention: "7-day history",
    features: ["Daily briefing", "Email delivery"],
  },
  {
    id: "personal",
    name: "Personal",
    monthly: 7,
    annual: 60,
    topics: 15,
    retention: "90-day history",
    features: ["Daily and weekly", "Telegram", "Breaking alerts", "AI explanations"],
  },
  {
    id: "pro",
    name: "Pro",
    monthly: 15,
    annual: 120,
    topics: Infinity,
    retention: "1-year history",
    features: ["Multiple schedules", "WhatsApp", "Deeper explanations", "Priority processing"],
  },
] as const;

const INVOICES = [
  { id: "INV-0004", date: "1 August 2026", amount: "$0.00", note: "Free plan" },
  { id: "INV-0003", date: "1 July 2026", amount: "$0.00", note: "Free plan" },
];

function Billing() {
  const { prefs } = useRadar();
  const [current, setCurrent] = useState<string>("free");
  const [annual, setAnnual] = useState(false);

  const plan = PLANS.find((p) => p.id === current) ?? PLANS[0];
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
              {plan.monthly === 0 ? "No payment method needed" : "Renews 1 September 2026"}
            </p>
            <p className="mt-1 text-[13px] tabular-nums">
              {plan.monthly === 0
                ? "$0"
                : annual
                  ? `$${plan.annual} / year`
                  : `$${plan.monthly} / month`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-6 border-t border-hairline pt-5 text-[13px]">
          <span>
            <span className="text-muted-foreground">Topics · </span>
            <span className={cn("tabular-nums", overTopics && "text-destructive")}>
              {prefs.topics.length} of {plan.topics === Infinity ? "unlimited" : plan.topics}
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
              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="display text-4xl tabular-nums">
                  ${annual ? p.annual : p.monthly}
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                  {p.monthly === 0 ? "forever" : annual ? "per year" : "per month"}
                </span>
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
                disabled={active}
                onClick={() => setCurrent(p.id)}
              >
                {active ? "Your plan" : p.monthly === 0 ? "Downgrade" : `Switch to ${p.name}`}
              </Button>
            </div>
          );
        })}
      </div>

      <section className="mt-10">
        <h2 className="text-[17px] font-medium tracking-tight">Invoices</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-surface">
          {INVOICES.map((inv) => (
            <div
              key={inv.id}
              className="flex flex-wrap items-center gap-4 border-b border-hairline px-5 py-4 last:border-0"
            >
              <span className="text-[13.5px] tabular-nums">{inv.id}</span>
              <span className="text-[13px] text-muted-foreground">{inv.date}</span>
              <span className="text-[12.5px] text-muted-foreground">{inv.note}</span>
              <span className="ml-auto text-[13.5px] tabular-nums">{inv.amount}</span>
              <button className="text-[12.5px] text-muted-foreground hover:text-foreground">
                Receipt
              </button>
            </div>
          ))}
        </div>
      </section>
    </DashboardShell>
  );
}
