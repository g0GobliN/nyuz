import { TopicControls } from "@/components/topic-controls";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, PauseCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { DashboardShell, EmptyState, PageHeader } from "@/components/dashboard/shell";
import { ExclusionPicker } from "@/components/exclusion-picker";
import { Button } from "@/components/kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePlan } from "@/lib/plan-state";
import { PLAN_NAMES, formatTopicLimit, nextPlanUp } from "@/lib/plans";
import { usePrefs } from "@/lib/prefs-store";
import { TopicPicker } from "@/components/topic-picker";
import { topicSlug } from "@/lib/topics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/topics")({
  component: Topics,
  head: () => ({ meta: [{ title: "Topics — nyuz" }] }),
});

function Topics() {
  const { prefs, update } = usePrefs();
  const { plan, topicLimit, loading: planLoading } = usePlan();
  const [open, setOpen] = useState<string | null>(null);
  const [limitPrompt, setLimitPrompt] = useState(false);

  // The server clips on save and match. Anything already stored past the cap
  // is shown paused so the reader can drop it; they cannot add more.
  const overBy = Math.max(0, prefs.topics.length - topicLimit);
  const upgrade = nextPlanUp(plan);

  const atCap = !planLoading && prefs.topics.length >= topicLimit;

  const toggle = (t: string) => {
    if (prefs.topics.some((x) => topicSlug(x) === topicSlug(t))) {
      remove(t);
      return;
    }
    update({ topics: [...prefs.topics, t] });
  };
  const remove = (t: string) =>
    update({ topics: prefs.topics.filter((x) => topicSlug(x) !== topicSlug(t)) });

  return (
    <DashboardShell title="Topics">
      <PageHeader
        eyebrow="Your nyuz"
        title="What do you want nyuz to watch?"
        sub="Pick from the suggestions, or type anything you want followed."
      />

      {!planLoading ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
          <span
            className={cn("tabular-nums", overBy > 0 ? "text-signal" : "text-muted-foreground")}
          >
            {prefs.topics.length} of {formatTopicLimit(topicLimit)} topics
            <span className="text-muted-foreground"> · {PLAN_NAMES[plan]} plan</span>
          </span>
          {overBy > 0 ? (
            <Link
              to="/dashboard/billing"
              className="text-signal underline-offset-4 hover:underline"
            >
              {overBy} paused · upgrade to include {overBy === 1 ? "it" : "them"}
            </Link>
          ) : null}
        </div>
      ) : null}

      <TopicPicker
        selected={prefs.topics}
        onToggle={toggle}
        atCap={atCap}
        onCapHit={() => setLimitPrompt(true)}
      />

      <div className="mt-9 space-y-2">
        {prefs.topics.length === 0 ? (
          <EmptyState
            title="No topics yet."
            body="Your nyuz has nothing to watch for. Add a few above and the next briefing fills in."
          />
        ) : null}

        {prefs.topics.map((t, i) => {
          const isOpen = open === t;
          // Order is the weighting the product has: the tail is what gets
          // dropped, which is what the billing page means by "lowest-weighted".
          const paused = i >= topicLimit;
          return (
            <div
              key={t}
              className={cn(
                "overflow-hidden rounded-2xl border bg-surface",
                paused ? "border-dashed border-signal/40" : "border-hairline",
              )}
            >
              <div className="flex items-center gap-3 px-5 py-4">
                <button
                  onClick={() => setOpen(isOpen ? null : t)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={cn("text-[15px] font-medium", paused && "text-muted-foreground")}
                  >
                    {t}
                  </span>
                  {paused ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-signal/40 px-2 py-0.5 text-[11px] text-signal">
                      <PauseCircle className="h-3 w-3" /> Not in your briefing
                    </span>
                  ) : null}
                  <span className="text-[12px] text-muted-foreground">
                    {paused ? "Saved for a higher plan" : "Following"}
                  </span>
                  <ChevronDown
                    className={cn(
                      "ml-auto h-4 w-4 text-muted-foreground transition-transform duration-300",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                <button
                  onClick={() => remove(t)}
                  aria-label={`Remove ${t}`}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div
                className="grid transition-all duration-400"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <div className="space-y-5 border-t border-hairline px-5 py-5">
                    <TopicControls topic={t} plan={plan} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <section className="mt-12">
        <h2 className="text-[17px] font-medium tracking-tight">Never send me</h2>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          Exclusions win over topics. If a story matches both, it stays out.
        </p>
        <div className="mt-5">
          <ExclusionPicker
            selected={prefs.exclusions}
            onChange={(exclusions) => update({ exclusions })}
          />
        </div>
      </section>

      {/* Shown once, on the add that crosses the line. The list itself carries
          the state afterwards, so repeating this for every further topic would
          be nagging rather than informing. */}
      <Dialog open={limitPrompt} onOpenChange={setLimitPrompt}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {PLAN_NAMES[plan]} covers {formatTopicLimit(topicLimit)} topics.
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-[13.5px] leading-relaxed">
                <p>
                  Only {formatTopicLimit(topicLimit)} {topicLimit === 1 ? "topic is" : "topics are"}{" "}
                  matched on this plan. Remove one to add another
                  {upgrade ? `, or move to ${PLAN_NAMES[upgrade]}` : ""}.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setLimitPrompt(false)}>
              Close
            </Button>
            {upgrade ? (
              <Link
                to="/dashboard/billing"
                onClick={() => setLimitPrompt(false)}
                className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                See {PLAN_NAMES[upgrade]}
              </Link>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
