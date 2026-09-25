import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bell, BellOff } from "lucide-react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { LoadState } from "@/components/dashboard/load-state";
import { Chip, LinkButton } from "@/components/kit";
import { Loading } from "@/components/loading";
import { usePrefs } from "@/lib/prefs-store";
import { loadRecentAlerts } from "@/lib/server/alerts";
import { formatStoryTime } from "@/lib/story-time";
import { usePlan } from "@/lib/plan-state";
import { PLAN_LIMITS, PLAN_NAMES, allowedBreaking } from "@/lib/plans";

export const Route = createFileRoute("/dashboard/alerts/")({
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
  const sent = alertsQ.data?.alerts ?? [];
  // Offered only when it would lead somewhere: alert twenty-one existing is
  // the whole reason to have a history page, and a link to an empty one is
  // worse than no link.
  const showHistory = limits.alertRetentionDays > 0 && (alertsQ.data?.hasMore ?? false);

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
                  ? `Important matched events can interrupt you, up to ${limits.alertDailyCap} a day.`
                  : `Only events scoring 6 or higher interrupt you. Most days that is none — never more than ${limits.alertDailyCap} in a day.`}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {(["important", "off"] as const).map((b) => {
            return (
              <Chip
                key={b}
                active={
                  (effectiveBreaking === "everything" ? "important" : effectiveBreaking) === b
                }
                onClick={() => {
                  void update({ breaking: b });
                }}
              >
                {b === "important" ? "Only important" : "Off"}
              </Chip>
            );
          })}
        </div>
        <p className="mt-4 text-sm">
          <a
            href={plan === "uno" ? "/dashboard/billing" : "/dashboard/topics"}
            className="text-signal"
          >
            {plan === "uno"
              ? "Personalize topic notifications with Plura"
              : "Configure topic notification rules"}
          </a>
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-[17px] font-medium tracking-tight">Recent alerts</h2>
        {/*
          Three states, decided once, in src/lib/load-state.ts. Both sentences
          in `empty` are claims about what has gone out, so neither can be drawn
          from a request that has not answered — including the one about alerts
          being off, which is not purely a fact about settings: it also says
          there is nothing to list.
        */}
        <LoadState
          query={alertsQ}
          hasContent={sent.length > 0}
          content={
            <ul className="space-y-3">
              {sent.map((alert) => (
                <li key={alert.digestId}>
                  <Link
                    to="/dashboard/story/$id"
                    params={{ id: alert.eventId }}
                    search={{ from: "alerts" }}
                    className="block rounded-3xl border border-hairline bg-surface p-5 transition-colors hover:border-foreground/20"
                  >
                    <p className="text-[12px] tabular-nums text-muted-foreground">
                      {formatStoryTime(alert.at)}
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
          }
          loading={<Loading label="Reading recent alerts" className="justify-center" />}
          failed="We couldn't read your recent alerts."
          empty={() =>
            off ? (
              <EmptyState
                title="Nothing to show while alerts are off."
                body="Turn them back on and anything urgent enough to interrupt you will be listed here."
              />
            ) : (
              <EmptyState
                title="No alerts sent yet."
                body="Breaking alerts fire outside your schedule, for events that should not wait. None have gone out."
              />
            )
          }
          className="mt-4"
        />
        {showHistory ? (
          <Link
            to="/dashboard/alerts/history"
            className="mt-5 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            View alert history <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
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
