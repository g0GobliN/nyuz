import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Lock, Search } from "lucide-react";
import { useState } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { Loading } from "@/components/loading";
import { shortPlanName, type HistoryMonth } from "@/lib/history-window";
import { loadHistory, searchStories, type HistoryDay } from "@/lib/server/briefing";
import { useReveal } from "@/lib/use-reveal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "History — nyuz" }] }),
});

/**
 * The archive, one month at a time.
 *
 * ---------------------------------------------------------------------------
 * Why months, and why the same layout for every plan
 * ---------------------------------------------------------------------------
 *
 * A year of daily briefings is 365 rows. Rendering that as one scroll was fine
 * while the only reader was on a seven-day window and unbearable the moment
 * anybody bought Omni, so months are the navigation and only the open one is
 * fetched. An Uno reader whose seven days straddle a month boundary simply has
 * two month rows, both readable — the entitlement is a date, and a month is
 * only ever a heading.
 *
 * There is deliberately no branch on the plan anywhere below. A month row is
 * locked when the server says the reader has rows there they may no longer
 * open, and someone who has always been Uno has no such rows, so they see
 * their seven days and nothing else. The twelve grey month rows that would
 * make a free plan feel like a locked door never get generated, because there
 * is nothing behind them to lock.
 *
 * What a downgraded reader sees instead is their own months, held for thirty
 * days, labelled with the plan that would genuinely bring each one back. That
 * plan is worked out from the real dates of the rows in the month — a month
 * whose days are 100 days old says Omni, because Plura's ninety would not
 * reach them, and promising otherwise would be a lie the reader pays for.
 */
function HistoryPage() {
  const [q, setQ] = useState("");
  const [month, setMonth] = useState<string | null>(null);
  const ref = useReveal<HTMLDivElement>();
  const term = q.trim();

  const history = useQuery({
    queryKey: ["briefing", "history", month ?? "latest"],
    queryFn: () => loadHistory({ data: month ? { month } : {} }),
    staleTime: 60_000,
    // Each month is its own cache entry, so without this the month list itself
    // unmounts on every click and the page flashes back to a full-page spinner
    // to fetch thirty rows. Keeping the previous answer means only the days
    // inside the opening month show a loader.
    placeholderData: keepPreviousData,
  });

  const results = useQuery({
    queryKey: ["briefing", "search", term],
    queryFn: () => searchStories({ data: { q: term } }),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });

  const days = history.data?.days ?? [];
  const months = history.data?.months ?? [];
  const openMonth = history.data?.month ?? null;
  // While the clicked month is in flight the previous month's answer is still
  // on screen, so the row that opens is the one just clicked — otherwise the
  // click appears to do nothing until the request lands.
  const showing = history.isFetching && month ? month : openMonth;
  const plan = history.data?.plan ?? "uno";
  const graceUntil = history.data?.graceUntil ?? null;
  const readable = months.reduce((n, m) => n + m.count, 0);

  return (
    <DashboardShell title="History">
      <div ref={ref}>
        <PageHeader
          eyebrow={readable === 0 ? "No briefings yet" : `${readable} briefings you can open`}
          title="Everything your nyuz has sent."
          sub="Pick a month. Your plan decides how far back the archive goes."
        />

        <div className="flex items-center gap-2.5 rounded-full border border-input bg-surface px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Show me everything about OpenAI"
            className="h-12 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-[15px]"
          />
        </div>

        {term.length >= 2 ? (
          <section className="mt-8">
            <p className="text-[12.5px] text-muted-foreground">
              {(results.data ?? []).length}{" "}
              {(results.data ?? []).length === 1 ? "result" : "results"} for &ldquo;{term}&rdquo;
            </p>
            <div className="mt-4 space-y-2">
              {results.isLoading ? (
                <Loading label="Searching your archive" className="justify-center" />
              ) : null}
              {(results.data ?? []).map((s) => (
                <Link
                  key={s.id}
                  to="/dashboard/story/$id"
                  params={{ id: s.id }}
                  className="block rounded-2xl border border-hairline bg-surface px-5 py-4 transition-colors hover:border-border"
                >
                  <p className="text-[11px] uppercase tracking-[0.14em] text-signal">{s.org}</p>
                  <p className="mt-1.5 text-[15px] font-medium leading-snug">{s.title}</p>
                  <p className="mt-2 text-[12.5px] text-muted-foreground">
                    {s.sources} sources · {s.time}
                  </p>
                </Link>
              ))}
              {!results.isLoading && results.data?.length === 0 ? (
                <EmptyState
                  title="Nothing in your archive matches that."
                  body="Search covers the window your plan keeps. Try a company name or a topic."
                />
              ) : null}
            </div>
          </section>
        ) : (
          <div className="mt-10">
            {history.isLoading ? (
              <Loading label="Opening your archive" />
            ) : months.length === 0 ? (
              <EmptyState
                title="No briefings yet."
                body="Once a briefing is generated it lands here, including the quiet days."
              />
            ) : (
              <div className="divide-y divide-hairline border-y border-hairline">
                {months.map((m) => (
                  <MonthRow
                    key={m.key}
                    month={m}
                    open={m.key === showing}
                    onOpen={() => setMonth(m.key)}
                  >
                    {m.key === showing ? (
                      <Days days={m.key === openMonth ? days : []} loading={history.isFetching} />
                    ) : null}
                  </MonthRow>
                ))}
              </div>
            )}

            {graceUntil ? <GraceNote until={graceUntil} /> : null}
            {!history.isLoading && plan !== "omni" ? <UpgradeNote /> : null}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

/**
 * One month.
 *
 * Readable months are buttons; a locked one is not, because there is nothing
 * behind it to open and a row that depresses and does nothing is worse than a
 * row that plainly says why.
 */
function MonthRow({
  month,
  open,
  onOpen,
  children,
}: {
  month: HistoryMonth;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const locked = month.state === "locked";
  const title = cn("text-[15px] font-medium tracking-tight", locked && "text-muted-foreground");

  return (
    <section className={cn("reveal", open && "bg-surface-2/40")}>
      {/* The name is the control, not the row: a partly-available month carries
          a restore link, and an anchor inside a button is neither valid nor
          operable with a keyboard. */}
      <div className="flex items-baseline gap-3 px-1 py-4">
        {locked ? (
          <h2 className={title}>{month.label}</h2>
        ) : (
          <button type="button" onClick={onOpen} aria-expanded={open} className="text-left">
            <h2 className={title}>{month.label}</h2>
          </button>
        )}
        <MonthNote month={month} />
        <span className="ml-auto text-[12.5px] tabular-nums text-muted-foreground">
          {locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : month.count}
        </span>
      </div>
      {children}
    </section>
  );
}

/**
 * The line beside the month name.
 *
 * `restorePartial` is the honest case and the reason this is not a single
 * string: a ninety-day window can reach the start of a month and not its end,
 * and "Restore with Plura" would then be a promise the plan does not keep.
 */
function MonthNote({ month }: { month: HistoryMonth }) {
  if (month.state === "available") return null;

  const plan = month.restorePlan ? shortPlanName(month.restorePlan) : null;
  const restore = !plan
    ? null
    : month.restorePartial
      ? `${plan} restores part of this month`
      : `Restore with ${plan}`;

  const prefix = month.state === "locked" ? "Locked" : "Partly available";

  return (
    <p className="text-[12.5px] text-muted-foreground">
      {prefix}
      {restore ? (
        <>
          {" · "}
          <Link to="/dashboard/billing" className="underline-offset-2 hover:underline">
            {restore}
          </Link>
        </>
      ) : null}
    </p>
  );
}

/** The days of the open month, on the same timeline the page always used. */
function Days({ days, loading }: { days: HistoryDay[]; loading: boolean }) {
  if (loading && days.length === 0) {
    return (
      <div className="pb-6 pl-7">
        <Loading label="Opening that month" />
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <p className="pb-6 pl-1 text-[12.5px] text-muted-foreground">
        Nothing was sent in this month.
      </p>
    );
  }

  return (
    <div className="relative pb-4 pl-7">
      <span className="absolute bottom-4 left-[5px] top-2 w-px bg-border" />
      {days.map((d, i) => (
        <div
          key={d.digestId}
          className="reveal relative pb-8 last:pb-2"
          style={{ transitionDelay: `${i * 50}ms` }}
        >
          <span
            className="absolute -left-7 top-2 h-[9px] w-[9px] rounded-full"
            style={{ background: d.count > 0 ? "var(--signal)" : "var(--border)" }}
          />
          <div className="flex flex-wrap items-baseline gap-3">
            <h3 className="text-[16px] font-medium tracking-tight">{d.date}</h3>
            <span className="text-[12.5px] text-muted-foreground">{d.weekday}</span>
            <span className="ml-auto text-[12.5px] tabular-nums text-muted-foreground">
              {d.skipped ? "No briefing" : `${d.count} stories`}
            </span>
          </div>

          {d.skipped ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border px-5 py-6">
              <p className="text-[14px]">Nothing important happened for your nyuz.</p>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                We would rather send nothing than fill the space.
              </p>
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-hairline bg-surface px-5 py-4">
              <p className="text-[14.5px] font-medium">{d.headline}</p>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                and {Math.max(0, d.count - 1)} more
              </p>
              <Link
                to="/dashboard/briefing"
                search={{ digest: d.digestId }}
                className="mt-3 inline-block text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                Open briefing
              </Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Shown only while a downgrade's grace is running.
 *
 * The point of the whole grace mechanism is that a plan change should read as a
 * plan change rather than as data loss, and that is a sentence, not a colour.
 */
function GraceNote({ until }: { until: string }) {
  const date = new Date(until).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
  });
  return (
    <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
      Your plan changed, so the months above are locked rather than gone. They stay recoverable
      until {date}.
    </p>
  );
}

/** Quiet, once, at the bottom. Not a paywall. */
function UpgradeNote() {
  return (
    <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
      Need more history?{" "}
      <Link to="/dashboard/billing" className="underline-offset-2 hover:underline">
        Plura keeps 90 days and Omni keeps 1 year.
      </Link>
    </p>
  );
}
