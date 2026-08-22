import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { LinkButton } from "@/components/kit";
import { HISTORY, STORIES } from "@/lib/sample-data";
import { useReveal } from "@/lib/use-reveal";

export const Route = createFileRoute("/dashboard/history")({
  component: HistoryPage,
  head: () => ({ meta: [{ title: "History — nyuz" }] }),
});

function HistoryPage() {
  const [q, setQ] = useState("");
  const ref = useReveal<HTMLDivElement>();
  const term = q.trim().toLowerCase();

  const results = useMemo(() => {
    if (!term) return null;
    return STORIES.filter(
      (s) =>
        s.title.toLowerCase().includes(term) ||
        s.org.toLowerCase().includes(term) ||
        s.what.toLowerCase().includes(term) ||
        s.topics.some((t) => t.toLowerCase().includes(term)),
    );
  }, [term]);

  const total = HISTORY.reduce((n, d) => n + d.count, 0);

  return (
    <DashboardShell title="History">
      <div ref={ref}>
        <PageHeader
          eyebrow={`${total} stories this week`}
          title="Everything your nyuz has sent."
          sub="Your archive is searchable back through your plan's retention window."
        />

        <div className="flex items-center gap-2.5 rounded-full border border-input bg-surface px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Show me everything about OpenAI"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
        </div>

        {results ? (
          <section className="mt-8">
            <p className="text-[12.5px] text-muted-foreground">
              {results.length} {results.length === 1 ? "result" : "results"} for &ldquo;{q.trim()}
              &rdquo;
            </p>
            <div className="mt-4 space-y-2">
              {results.map((s) => (
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
              {results.length === 0 ? (
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
            {HISTORY.map((d, i) => (
              <section
                key={d.date}
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
                    {d.count === 0 ? "No briefing" : `${d.count} stories`}
                  </span>
                </div>

                {d.count === 0 ? (
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
                      and {d.count - 1} more
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
            ))}
          </div>
        )}

        <div className="mt-12 rounded-2xl border border-hairline bg-surface-2 px-5 py-5">
          <p className="text-[14px] font-medium">Your archive ends here</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            You are on the Free plan, which keeps 7 days. Personal keeps 90, Pro keeps a year.
          </p>
          <LinkButton to="/dashboard/billing" variant="outline" size="sm" className="mt-4">
            See plans
          </LinkButton>
        </div>
      </div>
    </DashboardShell>
  );
}
