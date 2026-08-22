import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Button } from "@/components/kit";
import { useFeedback } from "@/lib/feedback-store";
import { DEFAULT_PREFS, useRadar } from "@/lib/radar-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/settings")({
  component: Settings,
  head: () => ({ meta: [{ title: "Settings — nyuz" }] }),
});

function Settings() {
  const navigate = useNavigate();
  const { prefs, update } = useRadar();
  const { state, signals, reset } = useFeedback();
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const wipe = () => {
    reset();
    update({ ...DEFAULT_PREFS, onboarded: false });
    navigate({ to: "/" });
  };

  return (
    <DashboardShell title="Settings">
      <PageHeader eyebrow="Account" title="Settings.">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-signal/40 px-3 py-1.5 text-[12px] text-signal transition-opacity duration-500",
            saved ? "opacity-100" : "opacity-0",
          )}
        >
          <Check className="h-3.5 w-3.5" /> Saved
        </span>
      </PageHeader>

      <div className="space-y-5">
        <Panel title="Profile">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="text-[13px] text-muted-foreground">
                What should we call you?
              </label>
              <input
                id="name"
                value={prefs.name}
                onChange={(e) => update({ name: e.target.value })}
                onBlur={save}
                className="mt-2 h-11 w-full rounded-2xl border border-input bg-background px-4 text-[14.5px] outline-none focus:border-signal"
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                Used in the greeting at the top of every briefing.
              </p>
            </div>
            <div>
              <label htmlFor="email" className="text-[13px] text-muted-foreground">
                Email address
              </label>
              <input
                id="email"
                type="email"
                defaultValue="vishal@example.com"
                onBlur={save}
                className="mt-2 h-11 w-full rounded-2xl border border-input bg-background px-4 text-[14.5px] outline-none focus:border-signal"
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                Changing this sends a confirmation link to the new address.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Personalisation">
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex-1">
              <p className="flex items-center gap-2 text-[14px] font-medium">
                <Sparkles className="h-4 w-4 text-signal" /> Your radar is learning
              </p>
              <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                {signals === 0
                  ? "No feedback signals yet. Rate stories and your briefing starts shifting toward what you open."
                  : `${signals} signals in play: ${Object.keys(state.votes).length} ratings, ${state.dismissed.length} dismissed, ${state.mutedTopics.length} muted topics, ${state.saved.length} saved.`}
              </p>
              <p className="mt-3 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                Clearing this resets personalisation to your stated topics alone. Your topics and
                schedule are untouched.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={reset} disabled={signals === 0}>
              Clear feedback signals
            </Button>
          </div>
        </Panel>

        <Panel title="Data">
          <div className="space-y-3">
            <RowAction
              title="Export your data"
              body="Topics, schedule, feedback signals and delivery history as JSON."
              action={
                <Button variant="outline" size="sm" onClick={save}>
                  Export
                </Button>
              }
            />
            <RowAction
              title="Pause briefings"
              body="Stops delivery without losing your configuration or archive."
              action={
                <Button variant="outline" size="sm" onClick={save}>
                  Pause
                </Button>
              }
            />
          </div>
        </Panel>

        <section className="rounded-3xl border border-destructive/30 bg-surface p-6 sm:p-7">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive">
            Danger zone
          </h2>
          <div className="mt-5 flex flex-wrap items-start gap-5">
            <div className="flex-1">
              <p className="text-[14px] font-medium">Delete account</p>
              <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                Removes your profile, topics, feedback signals and delivery history. This cannot be
                undone.
              </p>
            </div>
            {confirmDelete ? (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <button
                  onClick={wipe}
                  className="inline-flex h-9 items-center rounded-full bg-destructive px-4 text-[13px] font-medium text-destructive-foreground transition-opacity hover:opacity-90"
                >
                  Yes, delete everything
                </button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete account
              </Button>
            )}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function RowAction({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-hairline bg-surface-2 px-5 py-4">
      <div className="flex-1">
        <p className="text-[14px] font-medium">{title}</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}
