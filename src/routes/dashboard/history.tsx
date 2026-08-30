import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { LinkButton } from "@/components/kit";
import { Loading } from "@/components/loading";
import { usePlan } from "@/lib/plan-state";
import { loadHistory, searchStories } from "@/lib/server/briefing";
import { useReveal } from "@/lib/use-reveal";

export const Route = createFileRoute("/dashboard/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "History — nyuz" }] }),
});

function HistoryPage() {
  const [q, setQ] = useState("");
  const ref = useReveal<HTMLDivElement>();
  const term = q.trim();
  const { retention } = usePlan();

  const history = useQuery({
    queryKey: ["briefing", "history"],
    queryFn: () => loadHistory(),
    staleTime: 60_000,
  });

  const results = useQuery({
    queryKey: ["briefing", "search", term],
    queryFn: () => searchStories({ data: { q: term } }),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });

  const days = history.data?.days ?? [];
  const total = days.reduce((n, d) => n + d.count, 0);

  return (
    <DashboardShell title="History">
      <div ref={ref}>
        <PageHeader
          eyebrow={total === 0 ? "No briefings yet" : `${total} stories in your window`}
          title="Everything your nyuz has sent."
          sub="Your archive is searchable back through your plan's retention window."
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
                  body="Try a company name or a topic. Search covers headlines, summaries and tags."
                />
              ) : null}
            </div>
          </section>
        ) : (
          <div className="relative mt-10 pl-7">
            <span className="absolute bottom-4 left-[5px] top-4 w-px bg-border" />
            {history.isLoading ? (
              <Loading label="Opening your archive" />
            ) : days.length === 0 ? (
              <EmptyState
                title="No briefings in this window."
                body="Once a briefing is generated it lands here, including the quiet days."
              />
            ) : (
              days.map((d, i) => (
                <section
                  key={d.digestId}
                  className="reveal relative pb-8 last:pb-0"
                  style={{ transitionDelay: `${i * 70}ms` }}
                >
                  <span
                    className="absolute -left-7 top-2 h-[9px] w-[9px] rounded-full"
                    style={{ background: d.count > 0 ? "var(--signal)" : "var(--border)" }}
                  />
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h2 className="text-[17px] font-medium tracking-tight">{d.date}</h2>
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
                        className="mt-3 inline-block text-[12.5px] text-muted-foreground hover:text-foreground"
                      >
                        Open briefing
                      </Link>
                    </div>
                  )}
                </section>
              ))
            )}
          </div>
        )}

        <div className="mt-12 rounded-2xl border border-hairline bg-surface-2 px-5 py-5">
          <p className="text-[14px] font-medium">Your archive ends here</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Your plan keeps {retention}. Older briefings are deleted, not archived.
          </p>
          <LinkButton to="/dashboard/billing" variant="outline" size="sm" className="mt-4">
            See plans
          </LinkButton>
        </div>
      </div>
    </DashboardShell>
  );
}
