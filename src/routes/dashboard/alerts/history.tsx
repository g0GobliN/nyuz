import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { LoadState } from "@/components/dashboard/load-state";
import { humanError } from "@/lib/errors";
import { Button } from "@/components/kit";
import { Loading } from "@/components/loading";
import { groupAlertsByMonth } from "@/lib/alerts-recent";
import {
  ALERT_PERIODS,
  groupAlertsByDay,
  isAlertPeriod,
  periodStart,
  type AlertPeriod,
} from "@/lib/alerts-periods";
import { loadAlertHistory } from "@/lib/server/alerts";
import { formatStoryTime } from "@/lib/story-time";
import { usePlan } from "@/lib/plan-state";
import { PLAN_LIMITS, PLAN_NAMES } from "@/lib/plans";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/alerts/history")({
  validateSearch: (search: Record<string, unknown>) => {
    // `search` here is an index signature, so TS4111 demands bracket access.
    const range = typeof search["range"] === "string" ? search["range"] : undefined;
    return { range: isAlertPeriod(range) ? range : ("week" as AlertPeriod) };
  },
  component: AlertHistory,
  head: () => ({ meta: [{ title: "Alert history — nyuz" }] }),
});

/**
 * Everything that interrupted this reader, inside their alert window.
 *
 * Read in periods, not as one wall. A ninety-day window at Plura's ceiling
 * paged 25 at a time is a scroll with no destination; a reader arriving here
 * is asking "what fired recently", so Week and Month render whole periods at
 * once and All keeps the paged, month-grouped long view. The tabs change the
 * lens over rows the query already returns — no second way to count an alert.
 *
 * The range lives in the URL (`?range=month`), so the back button and a
 * bookmarked period both survive a reload.
 */
function AlertHistory() {
  const { plan } = usePlan();
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.uno;
  const entitled = limits.alertRetentionDays > 0;
  const search = useSearch({ from: "/dashboard/alerts/history" });
  const period: AlertPeriod = search.range;

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

  // The period filter runs on what is loaded. For Week this is complete as
  // soon as the first page reaches back past the period's start, which the
  // 25-row first page almost always does; Month can need a second page on a
  // chatty account, and the "load older" control below covers exactly that
  // case rather than hiding the rest of the period behind silence.
  const cutoff = periodStart(period, new Date());
  const inPeriod = cutoff ? alerts.filter((a) => new Date(a.firedAt) >= cutoff) : alerts;
  const days = groupAlertsByDay(inPeriod);
  const periodMightHaveMore =
    cutoff !== null && alerts.length > 0 && new Date(alerts[alerts.length - 1]!.firedAt) >= cutoff;

  return (
    <DashboardShell title="Alert history">
      <Link
        to="/dashboard/alerts"
        className="inline-flex items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to alerts
      </Link>

      <PageHeader
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
      ) : (
        <LoadState
          query={historyQ}
          hasContent={alerts.length > 0}
          content={
            <>
              <div
                role="tablist"
                aria-label="History period"
                className="inline-flex rounded-full border border-hairline p-1"
              >
                {ALERT_PERIODS.map((p) => (
                  <Link
                    key={p.key}
                    to="/dashboard/alerts/history"
                    search={{ range: p.key }}
                    replace
                    role="tab"
                    aria-selected={period === p.key}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-[13px] transition-colors",
                      period === p.key
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </Link>
                ))}
              </div>

              {period === "all" ? (
                <div className="mt-8 space-y-9">
                  {months.map((month) => (
                    <section key={month.key}>
                      <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {month.label} · {month.alerts.length}
                      </h2>
                      <ul className="mt-4 space-y-3">
                        {month.alerts.map((alert) => (
                          <AlertRow key={alert.digestId} alert={alert} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="mt-8 space-y-7">
                  <p className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
                    {inPeriod.length} alert{inPeriod.length === 1 ? "" : "s"} this {period}
                  </p>
                  {days.map((day) => (
                    <section key={day.key}>
                      <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {day.label} · {day.alerts.length}
                      </h2>
                      <ul className="mt-4 space-y-3">
                        {day.alerts.map((alert) => (
                          <AlertRow key={alert.digestId} alert={alert} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}

              {historyQ.isError ? (
                <p className="mt-8 text-center text-[12.5px] text-muted-foreground">
                  {humanError(historyQ.error, "Could not load older alerts.")}
                </p>
              ) : null}

              {period === "all" && historyQ.hasNextPage ? (
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
              ) : periodMightHaveMore && !historyQ.isError ? (
                <div className="mt-8 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void historyQ.fetchNextPage()}
                    disabled={historyQ.isFetchingNextPage}
                  >
                    {historyQ.isFetchingNextPage ? "Loading…" : `Load more of this ${period}`}
                  </Button>
                </div>
              ) : !historyQ.isError ? (
                <p className="mt-8 text-center text-[12px] text-muted-foreground">
                  {period === "all"
                    ? `That is every alert in the last ${limits.alertRetentionDays} days.`
                    : `That is the whole ${period}.`}
                </p>
              ) : null}
            </>
          }
          loading={<Loading label="Reading alert history" className="justify-center" />}
          failed="We couldn't read your alert history."
          empty={() => (
            <EmptyState
              title="No alerts yet."
              body="Breaking alerts fire outside your schedule, for events that should not wait. None have gone out."
            />
          )}
        />
      )}
    </DashboardShell>
  );
}

function AlertRow({
  alert,
}: {
  alert: { digestId: string; eventId: string; at: string; title: string; why?: string | null };
}) {
  return (
    <li>
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
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{alert.why}</p>
        ) : null}
      </Link>
    </li>
  );
}
