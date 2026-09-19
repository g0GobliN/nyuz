import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ConsoleHeader,
  ErrorNote,
  Loading,
  Panel,
  Pill,
  Stat,
  StatGrid,
  formatDateTime,
  formatNumber,
} from "@/components/admin/shell";
import { getStoryDiagnostic } from "@/lib/server/story-diagnostics";

export const Route = createFileRoute("/admin/story/$id")({ component: StoryDiagnosticPage });

function StoryDiagnosticPage() {
  const { id } = Route.useParams();
  const query = useQuery({
    queryKey: ["admin", "story-diagnostic", id],
    queryFn: () => getStoryDiagnostic({ data: { id } }),
    staleTime: 30_000,
  });
  if (query.isLoading) return <Loading label="Reading story diagnostics" />;
  if (query.error) return <ErrorNote error={query.error} />;
  const d = query.data;
  if (!d) {
    return (
      <>
        <ConsoleHeader title="Story diagnostics" sub="No event exists for this identifier." />
        <Link to="/admin/diagnostics" className="text-[13px] underline underline-offset-4">
          Back to diagnostics
        </Link>
      </>
    );
  }
  return (
    <>
      <ConsoleHeader
        title="Story diagnostics"
        sub="Internal build-path inspection. Source text and provider secrets are never displayed here."
      >
        <Link
          to="/admin/diagnostics"
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          Back to diagnostics
        </Link>
      </ConsoleHeader>
      <div className="space-y-5">
        <Panel title={d.event.title} note={`Event ${d.event.id}`}>
          <StatGrid>
            <Stat label="Status" value={d.event.status} />
            <Stat label="Category" value={d.event.category ?? "—"} />
            <Stat label="First seen" value={formatDateTime(d.event.firstSeen)} />
            <Stat label="Last seen" value={formatDateTime(d.event.lastSeen)} />
          </StatGrid>
          <div className="mt-4 flex flex-wrap gap-2">
            {d.event.topics.map((topic) => (
              <Pill key={topic} tone="outline">
                {topic}
              </Pill>
            ))}
            <Pill tone="outline">importance {d.event.importance}</Pill>
            <Pill tone="outline">novelty {d.event.novelty}</Pill>
          </div>
        </Panel>

        <Panel title="Reader build">
          <StatGrid>
            <Stat label="Mode" value={d.reader.mode} />
            <Stat label="Quality" value={d.reader.quality} />
            <Stat label="Words" value={formatNumber(d.reader.words)} />
            <Stat label="AI article" value={d.reader.aiArticle ? "yes" : "no"} />
          </StatGrid>
        </Panel>

        <Panel
          title="Article evidence"
          note="Evidence rows contain bounded extracted units only; full publisher pages are not retained."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-hairline text-muted-foreground">
                  <th className="pb-2">Article</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Published</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Units</th>
                  <th className="pb-2">Words</th>
                </tr>
              </thead>
              <tbody>
                {d.articles.map((article) => (
                  <tr key={article.id} className="border-b border-hairline">
                    <td className="max-w-[28rem] py-2 font-medium">{article.title}</td>
                    <td className="py-2">{article.source ?? "—"}</td>
                    <td className="py-2 text-muted-foreground">
                      {formatDateTime(article.publishedAt)}
                    </td>
                    <td className="py-2">{article.evidenceStatus ?? "not attempted"}</td>
                    <td className="py-2">{article.evidenceCount}</td>
                    <td className="py-2">{article.sourceWords}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Related-event diagnostics" note={d.related.note}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Candidates evaluated" value={formatNumber(d.related.candidates)} />
            <Stat label="Accepted" value={formatNumber(d.related.accepted)} />
            <Stat label="Rejected" value="not persisted" />
          </div>
        </Panel>
      </div>
    </>
  );
}
