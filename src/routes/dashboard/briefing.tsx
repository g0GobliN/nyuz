import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Mail, MessageCircle } from "lucide-react";
import { useMemo } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { BriefingPreview } from "@/components/briefing-preview";
import { PanelLoading } from "@/components/loading";
import { Chip, LinkButton } from "@/components/kit";
import { useDisplayName } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs-store";
import { withOfflineFallback } from "@/lib/offline/fallback";
import { useWarmSavedStories } from "@/lib/offline/warm";
import { loadDigestStories, loadHistory, loadSavedStories } from "@/lib/server/briefing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/dashboard/briefing")({
  component: Briefing,
  // Two params, both narrowing something a URL should not be able to invent.
  //
  // `digest` is how History opens one particular day. Without it this page only
  // knew how to fetch the latest digest, so every row in the archive led back
  // to today's briefing whichever one you clicked. Anything that is not a uuid
  // is dropped rather than forwarded — the server would refuse it anyway, and
  // falling back to the latest briefing is the harmless reading of a typo.
  //
  // `tab` is which of the two views is showing, and it is in the URL because the
  // installed app's Saved tab has to be able to open it. It used to be local
  // state, which meant Saved was unreachable except by tapping a chip on this
  // page: not linkable, not restored by the back button, and lost by opening a
  // story and coming back — the reader would return to Today with no sign of
  // where they had been. Defaults to today, so a bare /dashboard/briefing is
  // unchanged.
  validateSearch: (search: Record<string, unknown>): { digest?: string; tab?: Tab } => {
    const digest = search["digest"];
    const tab = search["tab"] === "saved" ? "saved" : undefined;
    return {
      ...(typeof digest === "string" && UUID.test(digest) ? { digest } : {}),
      ...(tab ? { tab } : {}),
    };
  },
  head: () => ({ meta: [{ title: "My briefing — nyuz" }] }),
});

type Tab = "today" | "saved";

function Briefing() {
  const { prefs } = usePrefs();
  const who = useDisplayName(prefs.name);
  const navigate = useNavigate();
  const { digest, tab = "today" } = Route.useSearch();
  const setTab = (next: Tab) =>
    // `replace`, because the two chips are one page seen two ways; leaving a
    // history entry per chip means Back walks through them before it leaves.
    //
    // The digest is spread rather than passed as `undefined`: `undefined` is not
    // a digest, and `exactOptionalPropertyTypes` is on, so handing the router an
    // explicit one is a type error and dropping the day would be a real one.
    void navigate({
      to: "/dashboard/briefing",
      search: { ...(digest ? { digest } : {}), tab: next },
      replace: true,
    });

  const pretty = useMemo(() => {
    const [rawH, rawM] = prefs.time.split(":");
    const h = Number(rawH ?? 7);
    const m = Number(rawM ?? 30);
    const suffix = h < 12 ? "AM" : "PM";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
  }, [prefs.time]);

  const todayQ = useQuery({
    // The id belongs in the key: two different days must not share one cache
    // entry, or the second one you open shows the first one's stories.
    queryKey: ["briefing", "today", digest ?? "latest"],
    // Both lists are archived, so both are offlineFirst — see
    // src/lib/offline/fallback.ts for why the network mode is load-bearing.
    networkMode: "offlineFirst",
    queryFn: () =>
      withOfflineFallback(["briefing", "today", digest ?? "latest"], () =>
        loadDigestStories({ data: digest ? { digestId: digest } : {} }),
      ),
    staleTime: 60_000,
  });
  const savedQ = useQuery({
    queryKey: ["briefing", "saved"],
    networkMode: "offlineFirst",
    queryFn: () => withOfflineFallback(["briefing", "saved"], () => loadSavedStories()),
    staleTime: 60_000,
  });
  // Only used to name the day on screen. History is fetched a month at a time
  // now, so the digest id goes with the request: the server resolves which
  // month that briefing falls in — and returns nothing at all if the reader's
  // plan no longer reaches it.
  const historyQ = useQuery({
    queryKey: ["briefing", "history", "digest", digest ?? ""],
    queryFn: () => loadHistory({ data: digest ? { digestId: digest } : {} }),
    staleTime: 60_000,
    enabled: Boolean(digest),
  });
  const day = historyQ.data?.days.find((d) => d.digestId === digest);

  const today = todayQ.data ?? [];
  const saved = savedQ.data ?? [];
  // Gives the shelf a reading copy while there is a network to fetch one. See
  // src/lib/offline/warm.ts for why Saved is warmed and Home is not.
  useWarmSavedStories(saved);
  const shown = tab === "today" ? today : saved;
  // An in-flight query and a genuinely empty briefing look identical once the
  // data defaults to []. Without this the page asserts "No briefing today"
  // before it has asked, which is the one thing a briefing must never get wrong.
  const waiting = tab === "today" ? todayQ.isLoading : savedQ.isLoading;

  return (
    <DashboardShell title="My briefing">
      <PageHeader
        eyebrow={day ? `Delivered · ${day.date}` : "Delivered"}
        title="Exactly what landed in your inbox."
        sub="This is the briefing as your channels received it. Nothing here was reordered for the web."
      >
        {/* Says out loud that this is not today's briefing, and offers the way
            back. An older digest that looks identical to the current one is how
            somebody ends up acting on week-old news. */}
        {digest ? (
          <Link
            to="/dashboard/briefing"
            search={{ tab }}
            className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to the latest briefing
          </Link>
        ) : null}
      </PageHeader>

      <div className="mb-7 flex flex-wrap items-center gap-2">
        <Chip active={tab === "today"} onClick={() => setTab("today")}>
          {day ? day.weekday : "Today"} · {today.length}
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

      {waiting ? (
        <PanelLoading
          label={tab === "today" ? "Fetching today's briefing" : "Fetching your saves"}
        />
      ) : shown.length > 0 ? (
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
      ) : digest ? (
        <EmptyState
          title={day ? `No briefing on ${day.date}.` : "No briefing that day."}
          body="Nothing crossed the threshold you had set. We would rather send nothing than fill the space."
          action={
            <LinkButton to="/dashboard/history" variant="outline" size="sm">
              Back to history
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
        Source descriptions and generated coverage can contain errors. Every story links to the
        original reporting.
      </p>
    </DashboardShell>
  );
}
