import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Mail, MessageCircle } from "lucide-react";
import { useMemo } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { BriefingPreview } from "@/components/briefing-preview";
import { LoadState } from "@/components/dashboard/load-state";
import { PanelLoading } from "@/components/loading";
import { Chip, LinkButton } from "@/components/kit";
import { useDisplayName } from "@/lib/auth";
import { withPendingSaved } from "@/lib/feedback-store";
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
  // `tab` is which of the two views is showing, and it is in the URL so the saved
  // view is a place rather than a mode: linkable, restored by the back button,
  // and not lost by opening a story and coming back — which is what local state
  // used to do, returning the reader to Today with no sign of where they had
  // been. Both chromes' strips open this route as a whole, so the chips are how
  // you choose the view; defaults to today, so a bare /dashboard/briefing is
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
    // Always stale, unlike the two lists either side of it. A bookmark is tapped
    // from wherever the story is — including another device — so the shelf is the
    // one screen where last minute's copy is the wrong answer, and the count it
    // prints on the Today chip is the same answer in smaller type. A save also
    // marks this entry stale directly (`toggleSaved`), which covers the reader
    // who never leaves the page this was mounted on. Offline it costs nothing:
    // the fallback serves the archive without making a request.
    staleTime: 0,
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
  // Bookmarked but not yet confirmed by the server, merged over the list the
  // server last returned — the shelf has to agree with the Save button the
  // reader just pressed, and it is the answer from *before* that press. Memoised
  // on the query data for the same reason the merge exists: a new array here
  // would restart the warming effect below on every render.
  const saved = useMemo(() => withPendingSaved(savedQ.data ?? []), [savedQ.data]);
  // Gives the shelf a reading copy while there is a network to fetch one. See
  // src/lib/offline/warm.ts for why Saved is warmed and Home is not.
  useWarmSavedStories(saved);
  const shown = tab === "today" ? today : saved;
  // The query behind whichever chip is up. The two answer with the same shape,
  // so the chips choose which list is asked for, not what comes back.
  const shownQ = tab === "today" ? todayQ : savedQ;
  // A count is a claim as well, and it is the one the reader checks first. Both
  // chips print the length of a list, and neither a list that failed to load nor
  // one that has not answered yet has a length worth reporting: "Saved · 0"
  // beside a bookmark the reader just made is the reading that sends them
  // looking for a story that was never gone. An answer is the only thing that
  // has a length.
  const todayTally = todayQ.data !== undefined ? String(today.length) : "—";
  const savedTally = savedQ.data !== undefined ? String(saved.length) : "—";

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
          {day ? day.weekday : "Today"} · {todayTally}
        </Chip>
        <Chip active={tab === "saved"} onClick={() => setTab("saved")}>
          <Bookmark className="h-3 w-3" />
          Saved · {savedTally}
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

      {/*
        Three states, decided once, in src/lib/load-state.ts. The failure is
        only reachable with nothing on screen, so a refetch dying behind a
        briefing that is already up never replaces it with an apology; and every
        sentence in `empty` is a claim about what was delivered, so none of them
        can be written from a request that has not answered.
      */}
      <LoadState
        query={shownQ}
        hasContent={shown.length > 0}
        content={
          <BriefingPreview
            key={tab}
            stories={shown}
            time={pretty}
            name={who}
            className="animate-rise"
          />
        }
        loading={
          <PanelLoading
            label={tab === "today" ? "Fetching today's briefing" : "Fetching your saves"}
          />
        }
        failed={
          tab === "saved" ? "We couldn't load your saves." : "We couldn't load this briefing."
        }
        empty={() =>
          tab === "saved" ? (
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
          )
        }
      />

      <p className="mt-8 text-center text-[12px] leading-relaxed text-muted-foreground">
        Source descriptions and generated coverage can contain errors. Every story links to the
        original reporting.
      </p>
    </DashboardShell>
  );
}
