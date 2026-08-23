import { createFileRoute } from "@tanstack/react-router";
import { Bookmark, Mail, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DashboardShell,
  EmptyState,
  PageHeader,
  SampleDataNotice,
} from "@/components/dashboard/shell";
import { BriefingPreview } from "@/components/briefing-preview";
import { Chip, LinkButton } from "@/components/kit";
import { useFeedback } from "@/lib/feedback-store";
import { useDisplayName } from "@/lib/auth";
import { matchStories } from "@/lib/matching";
import { usePrefs } from "@/lib/prefs-store";
import { STORIES } from "@/lib/sample-data";

export const Route = createFileRoute("/dashboard/briefing")({
  component: Briefing,
  head: () => ({ meta: [{ title: "My briefing — nyuz" }] }),
});

type Tab = "today" | "saved";

function Briefing() {
  const { prefs } = usePrefs();
  const who = useDisplayName() || prefs.name;
  const { state } = useFeedback();
  const [tab, setTab] = useState<Tab>("today");

  const pretty = useMemo(() => {
    const [rawH, rawM] = prefs.time.split(":");
    const h = Number(rawH ?? 7);
    const m = Number(rawM ?? 30);
    const suffix = h < 12 ? "AM" : "PM";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
  }, [prefs.time]);

  // Matched against your topics first, exactly as the home feed is — a briefing
  // that contained stories the dashboard filtered out would not be "exactly
  // what landed in your inbox", which is what this page claims to be.
  const today = matchStories(STORIES, prefs)
    .map((m) => m.story)
    .filter(
      (s) =>
        !state.dismissed.includes(s.id) && !s.topics.some((t) => state.mutedTopics.includes(t)),
    );
  const saved = STORIES.filter((s) => state.saved.includes(s.id));
  const shown = tab === "today" ? today : saved;

  return (
    <DashboardShell title="My briefing">
      <SampleDataNotice />
      <PageHeader
        eyebrow="Delivered"
        title="Exactly what landed in your inbox."
        sub="This is the briefing as your channels received it. Nothing here was reordered for the web."
      />

      <div className="mb-7 flex flex-wrap items-center gap-2">
        <Chip active={tab === "today"} onClick={() => setTab("today")}>
          Today · {today.length}
        </Chip>
        <Chip active={tab === "saved"} onClick={() => setTab("saved")}>
          <Bookmark className="mr-1 inline h-3 w-3" />
          Saved · {saved.length}
        </Chip>
        <div className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
          {prefs.channels.email ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1">
              <Mail className="h-3 w-3" /> Email
            </span>
          ) : null}
          {prefs.channels.telegram ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1">
              <MessageCircle className="h-3 w-3" /> Telegram
            </span>
          ) : null}
        </div>
      </div>

      {shown.length > 0 ? (
        <BriefingPreview
          key={tab}
          stories={shown}
          time={pretty}
          name={who}
          className="animate-rise"
        />
      ) : tab === "saved" ? (
        <EmptyState
          title="Nothing saved yet."
          body="Save a story from your home feed and it stays here past its retention window."
          action={
            <LinkButton to="/dashboard" variant="outline" size="sm">
              Back to today
            </LinkButton>
          }
        />
      ) : (
        <EmptyState
          title="No briefing today."
          body="Nothing crossed the threshold you set. A quiet day is a real answer, not a failure."
          action={
            <LinkButton to="/dashboard/delivery" variant="outline" size="sm">
              Lower my threshold
            </LinkButton>
          }
        />
      )}

      <p className="mt-8 text-center text-[12px] leading-relaxed text-muted-foreground">
        Summaries are generated and can be wrong. Every story links to the reporting it came from.
      </p>
    </DashboardShell>
  );
}
