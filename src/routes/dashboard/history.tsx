import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { HistoryMonthSelector } from "@/components/dashboard/history-month-selector";
import { LoadState } from "@/components/dashboard/load-state";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { Loading } from "@/components/loading";
import { loadPhase } from "@/lib/load-state";
import { loadHistory, searchStories, type HistoryDay } from "@/lib/server/briefing";
import { sourceCount } from "@/lib/story";
import { useReveal } from "@/lib/use-reveal";

export const Route = createFileRoute("/dashboard/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "History — nyuz" }] }),
});

/** The archive, fetching only the selected month of the allowed window. */
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

  const found = results.data ?? [];
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
  // The archive's state, asked once for the words above the panel — the
  // eyebrow counts what the archive holds, so on a request that has not
  // answered, or one that failed, the honest answer is that we do not know yet.
  // Same function, same inputs as the panel below draws from, so the two can
  // never disagree.
  const phase = loadPhase(history, { hasContent: readable > 0 });
  const eye =
    phase === "waiting"
      ? "Opening your archive"
      : phase === "failed"
        ? "We couldn't open your archive"
        : readable === 0
          ? "No briefings yet"
          : `${readable} briefings you can open`;

  return (
    <DashboardShell title="History">
      <div ref={ref}>
        <PageHeader
          eyebrow={eye}
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
            {/*
              Three states, decided once, in src/lib/load-state.ts. The count and
              "Nothing in your archive matches that." are both the answer to the
              search, so both live inside slots only an answer reaches: a request
              that never ran used to print "0 results for …", which is the right
              answer to the wrong question.
            */}
            <LoadState
              query={results}
              hasContent={found.length > 0}
              content={
                <>
                  <SearchCount found={found.length} term={term} />
                  <div className="mt-4 space-y-2">
                    {found.map((s) => (
                      <Link
                        key={s.id}
                        to="/dashboard/story/$id"
                        params={{ id: s.id }}
                        className="block rounded-2xl border border-hairline bg-surface px-5 py-4 transition-colors hover:border-border"
                      >
                        <p className="text-[11px] uppercase tracking-[0.14em] text-signal">
                          {s.org}
                        </p>
                        <p className="mt-1.5 text-[15px] font-medium leading-snug">{s.title}</p>
                        <p className="mt-2 text-[12.5px] text-muted-foreground">
                          {sourceCount(s.sources)} · {s.time}
                        </p>
                      </Link>
                    ))}
                  </div>
                </>
              }
              loading={<Loading label="Searching your archive" className="justify-center" />}
              failed="We couldn't search your archive."
              empty={() => (
                <>
                  <SearchCount found={found.length} term={term} />
                  <div className="mt-4">
                    <EmptyState
                      title="Nothing in your archive matches that."
                      body="Search covers the window your plan keeps. Try a company name or a topic."
                    />
                  </div>
                </>
              )}
            />
          </section>
        ) : (
          <div className="mt-10">
            {/*
              Three states, decided once, in src/lib/load-state.ts. "No
              briefings yet." is the last thing somebody should conclude from a
              bad connection, so it lives in `empty`; the failure is reachable
              only with nothing on screen, so a month that fails to open behind
              a rendered archive keeps the archive.
            */}
            <LoadState
              query={history}
              hasContent={readable > 0}
              content={
                <>
                  <HistoryMonthSelector months={months} selected={showing} onSelect={setMonth} />
                  <Days days={showing === openMonth ? days : []} loading={history.isFetching} />
                </>
              }
              loading={<Loading label="Opening your archive" />}
              failed="We couldn't open your archive."
              empty={() => (
                <EmptyState
                  title="No briefings yet."
                  body="Once a briefing is generated it lands here, including the quiet days."
                />
              )}
            />

            {graceUntil ? <GraceNote until={graceUntil} /> : null}
            {/*
             * The plan is read from the same answer as the archive, and it falls
             * back to the cheapest one — so without `history.data` a failed
             * request pitched an upgrade at the reader's actual plan.
             */}
            {history.data && plan !== "omni" ? <UpgradeNote /> : null}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

/**
 * The count above the search results.
 *
 * Its own component because it is drawn in two states — a search that found
 * something and a search that found nothing — and both of them are answers. It
 * is deliberately absent from the wait: a count is a claim, and "0 results" is
 * not a claim a request that has not run may make.
 */
function SearchCount({ found, term }: { found: number; term: string }) {
  /*
   * One expression rather than JSX text: prettier wraps that line, and a wrap
   * inside `&ldquo;{term}&rdquo;` renders the closing quote with a space in
   * front of it.
   */
  return (
    <p className="text-[12.5px] text-muted-foreground">
      {`${found} ${found === 1 ? "result" : "results"} for “${term}”`}
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
            <h2 className="text-[16px] font-medium tracking-tight">{d.date}</h2>
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
            /*
             * The whole card is the way in. Alerts already solved this: one
             * anchor per row, the border warming on hover, so the reader's
             * pointer and the keyboard both have a target the size of the thing
             * they are looking at. The label stays as the visible affordance,
             * demoted to a span because an anchor inside an anchor is invalid
             * and would put a second focus stop inside a card that is already
             * one. `rounded-3xl` and the hover border are the alert card's own
             * vocabulary, which is also what P2 (radius drift) asked for.
             */
            <Link
              to="/dashboard/briefing"
              search={{ digest: d.digestId }}
              className="group mt-3 block rounded-3xl border border-hairline bg-surface px-5 py-4 transition-colors hover:border-foreground/20"
            >
              <p className="text-[14.5px] font-medium">{d.headline}</p>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                and {Math.max(0, d.count - 1)} more
              </p>
              <span className="mt-3 inline-block text-[12.5px] text-muted-foreground group-hover:text-foreground">
                Open briefing
              </span>
            </Link>
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
      History from your previous plan stays recoverable until {date} if you change back.
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
