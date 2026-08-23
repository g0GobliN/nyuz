import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { loadMatches, type MatchedEvent } from "@/lib/server/briefing";
import { cn } from "@/lib/utils";

/**
 * The reader's real matched events, on the dashboard.
 *
 * This is the visible half of stage 6. Everything else in that stage happens
 * server-side and would be invisible: rows appear in `user_events` and nobody
 * ever sees them. So the day-one backfill ends here, above the fixtures the rest
 * of the page still renders, labelled as the thing it is.
 *
 * It is deliberately NOT the fixture card. `StoryCard` deep-links to
 * `/dashboard/story/$id`, which reads `sample-data` — pointing it at a real
 * event id would produce a card that looks finished and 404s when clicked. These
 * events also have no `why_it_matters` yet; that is one generated paragraph per
 * person, which is stage 7. What is shown here is exactly what the database
 * actually holds: the neutral title analysis wrote, its plain account of what
 * happened, the topics it was matched on, and the outlets that reported it.
 *
 * Replacing the fixtures outright, and the story pages behind them, is stage 8.
 */
export function LiveBriefing() {
  const matches = useQuery({
    queryKey: ["briefing", "matches"],
    queryFn: () => loadMatches(),
    // Matching runs on a half-hourly cron, so a minute of staleness cannot hide
    // anything a reader could have caused.
    staleTime: 60_000,
  });

  // Nothing is drawn while the answer is unknown. A skeleton here would push the
  // rest of the page down a beat after it settled, and this block is above
  // everything else on the page.
  if (matches.isLoading) return null;

  // A failed read is not worth an error panel on a page that still has content
  // below it. The console log is the record; the reader sees the page they had.
  if (matches.error || !matches.data) return null;

  const { events, windowHours } = matches.data;

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/40 px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-signal">
          <Radio className="h-3 w-3" /> Live
        </span>
        <h2 className="text-[13px] text-muted-foreground">
          {events.length > 0
            ? `Matched for you from real reporting — ${events.length} ${
                events.length === 1 ? "event" : "events"
              }.`
            : `Nothing from the last ${windowHours} hours matched your topics yet.`}
        </h2>
      </div>

      {events.length > 0 ? (
        <div className="space-y-3">
          {events.map((event) => (
            <MatchedCard key={event.eventId} event={event} />
          ))}
        </div>
      ) : (
        /* The quiet answer, said plainly. The product promises quiet days stay
           quiet, so this must not be softened into "check back soon" — the
           honest distinction is between a corpus that has nothing for you and a
           topic nobody covers, and only the second is worth acting on. */
        <p className="rounded-2xl border border-hairline bg-surface-2 px-5 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
          Coverage so far is weighted towards technology. Nothing collected in the last{" "}
          {windowHours} hours touched what you follow, so there is nothing here rather than
          something padded out to fill the space.
        </p>
      )}
    </section>
  );
}

/** Importance is the shared score, so the band is the shared one too. */
function band(importance: number): { label: string; tone: string } {
  if (importance >= 6) return { label: "High", tone: "text-signal border-signal/40" };
  if (importance >= 3) return { label: "Medium", tone: "text-foreground border-border" };
  return { label: "Notable", tone: "text-muted-foreground border-hairline" };
}

function MatchedCard({ event }: { event: MatchedEvent }) {
  const tone = band(event.importance);

  return (
    <article className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-signal">
          {event.sources[0] ?? "Unattributed"}
        </span>
        <span className={cn("ml-auto rounded-full border px-2.5 py-0.5 text-[11px]", tone.tone)}>
          {tone.label}
        </span>
      </div>

      <h3 className="mt-3 text-[19px] font-medium leading-snug tracking-tight sm:text-[21px]">
        {event.title}
      </h3>

      {event.whatHappened ? (
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
          {event.whatHappened}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
        {event.topics.length > 0 ? <span>Because you follow {event.topics.join(", ")}</span> : null}
        {event.sources.length > 1 ? (
          <span className="tabular-nums">{event.sources.length} sources</span>
        ) : null}
        {/* The two scores are different things and are labelled as such: one is
            what the model thought of the event, the other is what stage 5
            thought of it for this reader. Showing a single blended number would
            hide the fact that the personal one is allowed to outrank the
            shared one. */}
        <span className="tabular-nums">
          importance {event.importance.toFixed(1)} · relevance {event.relevance.toFixed(1)}
        </span>
      </div>
    </article>
  );
}
