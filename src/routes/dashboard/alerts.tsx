import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { Chip, LinkButton } from "@/components/kit";
import { Loading } from "@/components/loading";
import { usePrefs } from "@/lib/prefs-store";
import { loadRecentAlerts } from "@/lib/server/briefing";
import { formatStoryTime } from "@/lib/story-time";
import { usePlan } from "@/lib/plan-state";
import { PLAN_LIMITS, PLAN_NAMES, allowedBreaking } from "@/lib/plans";

export const Route = createFileRoute("/dashboard/alerts")({
  component: Alerts,
  head: () => ({ meta: [{ title: "Alerts — nyuz" }] }),
});

function Alerts() {
  const { prefs, update } = usePrefs();
  const { plan } = usePlan();
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.uno;
  const effectiveBreaking = allowedBreaking(plan, prefs.breaking);
  const off = effectiveBreaking === "off";
  const alertsQ = useQuery({
    queryKey: ["alerts", "recent"],
    queryFn: () => loadRecentAlerts(),
    staleTime: 30_000,
  });
  const sent = alertsQ.data ?? [];

  return (
    <DashboardShell title="Alerts">
      <PageHeader
        eyebrow="Outside your schedule"
        title="Breaking alerts."
        sub="Most days these stay silent. They exist for the handful of events that should not wait until 7:30."
      />

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={
              "flex h-11 w-11 items-center justify-center rounded-full " +
              (off ? "bg-muted text-muted-foreground" : "bg-signal/15 text-signal")
            }
          >
            {off ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </span>
          <div className="flex-1">
            <p className="text-[15px] font-medium">{off ? "Alerts are off" : "Alerts are on"}</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {off
                ? "Everything waits for your next scheduled briefing."
                : effectiveBreaking === "everything"
                  ? `Matched events can interrupt you, up to ${limits.alertDailyCap} a day.`
                  : `Only events scoring 6 or higher interrupt you. Most days that is none — never more than ${limits.alertDailyCap} in a day.`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {(["important", "everything", "off"] as const).map((b) => {
            const locked =
              (limits.alerts === "none" && b !== "off") ||
              (limits.alerts === "important" && b === "everything");
            return (
              <Chip
                key={b}
                active={effectiveBreaking === b}
                onClick={() => {
                  if (!locked) void update({ breaking: b });
                }}
              >
                {b === "important" ? "Only important" : b === "everything" ? "Everything" : "Off"}
                {locked ? ` · ${b === "everything" ? "Omni" : "Paid"}` : ""}
              </Chip>
            );
          })}
        </div>
        {limits.alerts === "none" ? (
          <p className="mt-4 text-[12.5px] text-muted-foreground">
            Alerts are not included on {PLAN_NAMES[plan]}. Your daily briefing still carries every
            matched story within its limit.
          </p>
        ) : null}
      </section>

      <section className="mt-10">
        <h2 className="text-[17px] font-medium tracking-tight">Recently sent</h2>
        {alertsQ.isLoading ? (
          <Loading label="Reading recent alerts" className="justify-center" />
        ) : off && sent.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing to show while alerts are off."
              body="Turn them back on and anything urgent enough to interrupt you will be listed here."
            />
          </div>
        ) : sent.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No alerts sent yet."
              body="Breaking alerts fire outside your schedule, for events that should not wait. None have gone out."
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {sent.map((alert) => (
              <li key={alert.digestId}>
                <Link
                  to="/dashboard/story/$id"
                  params={{ id: alert.eventId }}
                  className="block rounded-3xl border border-hairline bg-surface p-5 transition-colors hover:border-foreground/20"
                >
                  <p className="text-[12px] tabular-nums text-muted-foreground">
                    {formatStoryTime(alert.at)}
                    {alert.status !== "sent" ? ` · ${alert.status}` : ""}
                  </p>
                  <p className="mt-2 text-[15px] font-medium leading-snug">{alert.title}</p>
                  {alert.why ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      {alert.why}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10 rounded-2xl border border-hairline bg-surface-2 px-5 py-5">
        <p className="text-[14px] font-medium">Alerts go out on connected channels</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Email, Telegram once linked, and one notification per story if you enable them. Dismissing
          a notice only clears the notice — Home still has the full set. Change that under Delivery.
        </p>
        <LinkButton to="/dashboard/delivery" variant="outline" size="sm" className="mt-4">
          Delivery settings
        </LinkButton>
      </div>
    </DashboardShell>
  );
}
