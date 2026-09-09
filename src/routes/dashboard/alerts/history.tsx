import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { humanError } from "@/lib/errors";
import { Button } from "@/components/kit";
import { Loading } from "@/components/loading";
import { groupAlertsByMonth } from "@/lib/alerts-recent";
import { loadAlertHistory } from "@/lib/server/alerts";
import { formatStoryTime } from "@/lib/story-time";
import { usePlan } from "@/lib/plan-state";
import { PLAN_LIMITS, PLAN_NAMES } from "@/lib/plans";

export const Route = createFileRoute("/dashboard/alerts/history")({
  component: AlertHistory,
  head: () => ({ meta: [{ title: "Alert history — nyuz" }] }),
});

/**
 * Everything that interrupted this reader, inside their alert window.
 *
 * Paged rather than loaded whole, and grouped by month rather than filtered by
 * one. A month picker has to know which months hold alerts before it can offer
 * them, which is an aggregate query over the entire window — the exact cost
 * paging is here to avoid. Headings give the same orientation for the price of
 * the rows already on screen.
 *
 * Still not a feed: no filters, no search, no infinite scroll. These are the
 * handful of events important enough to have interrupted somebody's day, and a
 * reader asks for the next page deliberately.
 */
function AlertHistory() {
  const { plan } = usePlan();
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.uno;
  const entitled = limits.alertRetentionDays > 0;

  const historyQ = useInfiniteQuery({
    queryKey: ["alerts", "history"],
    queryFn: ({ pageParam }) => loadAlertHistory({ data: pageParam ? { before: pageParam } : {} }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    staleTime: 30_000,
    enabled: entitled,
  });

  const alerts = historyQ.data?.pages.flatMap((page) => page.alerts) ?? [];
  const months = groupAlertsByMonth(alerts);

  return (
    <DashboardShell title="Alert history">
      <Link
        to="/dashboard/alerts"
        className="inline-flex items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to alerts
      </Link>

      <PageHeader
        // eyebrow="Outside your schedule"
        title="Alert history."
        sub={
          entitled
            ? `Every breaking alert delivered to you in the last ${limits.alertRetentionDays} days.`
            : "Breaking alerts are not included on your plan, so there is no alert history to keep."
        }
      />

      {!entitled ? (
        <EmptyState
          title={`Alerts are not included on ${PLAN_NAMES[plan]}.`}
          body="Your daily briefing still carries every matched story within its limit."
        />
      ) : historyQ.isLoading ? (
        <Loading label="Reading alert history" className="justify-center" />
      ) : alerts.length === 0 ? (
        <EmptyState
          title="No alerts yet."
          body="Breaking alerts fire outside your schedule, for events that should not wait. None have gone out."
        />
      ) : (
        <>
          <div className="space-y-9">
            {months.map((month) => (
              <section key={month.key}>
                <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {month.label}
                </h2>
                <ul className="mt-4 space-y-3">
                  {month.alerts.map((alert) => (
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
              </section>
            ))}
          </div>

          {/*
            A failed page said nothing at all before this: the spinner stopped,
            the list did not grow, and the only honest reading available to a
            reader was "I must have no older alerts". A page that cannot load
            has to say so.
          */}
          {historyQ.isError ? (
            <p className="mt-8 text-center text-[12.5px] text-muted-foreground">
              {humanError(historyQ.error, "Could not load older alerts.")}
            </p>
          ) : null}

          {historyQ.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void historyQ.fetchNextPage()}
                disabled={historyQ.isFetchingNextPage}
              >
                {historyQ.isFetchingNextPage ? "Loading…" : "Load older alerts"}
              </Button>
            </div>
          ) : historyQ.isError ? null : (
            <p className="mt-8 text-center text-[12px] text-muted-foreground">
              That is every alert in the last {limits.alertRetentionDays} days.
            </p>
          )}
        </>
      )}
    </DashboardShell>
  );
}
