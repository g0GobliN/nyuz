import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, BellOff, Zap } from "lucide-react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { Chip, LinkButton } from "@/components/kit";
import { useRadar } from "@/lib/radar-store";
import { STORIES } from "@/lib/sample-data";

export const Route = createFileRoute("/dashboard/alerts")({
  component: Alerts,
  head: () => ({ meta: [{ title: "Alerts — nyuz" }] }),
});

const SENT = [
  { id: "openai-realtime", at: "Today · 06:14", reason: "Importance 91 · matched AI, OpenAI" },
  { id: "nvidia-supply", at: "18 Aug · 14:02", reason: "Importance 82 · matched Chips" },
];

function Alerts() {
  const { prefs, update } = useRadar();
  const off = prefs.breaking === "off";

  return (
    <DashboardShell title="Alerts">
      <PageHeader
        eyebrow="Outside your schedule"
        title="Breaking alerts."
        sub="Most days these stay silent. They exist for the handful of events that should not wait until 7:30."
      />

      <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={
              "flex h-11 w-11 items-center justify-center rounded-full " +
              (off ? "bg-muted text-muted-foreground" : "bg-signal/15 text-signal")
            }
          >
            {off ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </span>
          <div className="flex-1">
            <p className="text-[15px] font-medium">
              {off ? "Alerts are off" : "Alerts are on"}
            </p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {off
                ? "Everything waits for your next scheduled briefing."
                : prefs.breaking === "everything"
                  ? "Every matched event reaches you as it lands."
                  : "Only events scoring high on importance interrupt you."}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {(["important", "everything", "off"] as const).map((b) => (
            <Chip key={b} active={prefs.breaking === b} onClick={() => update({ breaking: b })}>
              {b === "important" ? "Only important" : b === "everything" ? "Everything" : "Off"}
            </Chip>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-[17px] font-medium tracking-tight">Recently sent</h2>
        {off ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing to show while alerts are off."
              body="Turn them back on and anything urgent enough to interrupt you will be listed here."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {SENT.map((a) => {
              const story = STORIES.find((s) => s.id === a.id);
              if (!story) return null;
              return (
                <Link
                  key={a.id}
                  to="/dashboard/story/$id"
                  params={{ id: story.id }}
                  className="flex items-start gap-4 rounded-2xl border border-hairline bg-surface px-5 py-4 transition-colors hover:border-border"
                >
                  <Zap className="mt-1 h-4 w-4 shrink-0 text-signal" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-medium leading-snug">{story.title}</p>
                    <p className="mt-1.5 text-[12px] text-muted-foreground">{a.reason}</p>
                  </div>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{a.at}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="mt-10 rounded-2xl border border-hairline bg-surface-2 px-5 py-5">
        <p className="text-[14px] font-medium">Alerts follow your delivery channels</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          They go wherever your briefing goes. Change that under Delivery.
        </p>
        <LinkButton to="/dashboard/delivery" variant="outline" size="sm" className="mt-4">
          Delivery settings
        </LinkButton>
      </div>
    </DashboardShell>
  );
}
