import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardShell, PageHeader } from "@/components/dashboard/shell";
import { Button } from "@/components/kit";
import { useFeedback } from "@/lib/feedback-store";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs-store";
import { deleteAccount, exportAccountData } from "@/lib/server/account";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/settings")({
  component: Settings,
  head: () => ({ meta: [{ title: "Settings — nyuz" }] }),
});

function Settings() {
  const { prefs, update } = usePrefs();
  // The address on the account, not a stored copy — the account is the only
  // thing that actually receives a briefing.
  const auth = useAuth();
  const email = auth.user?.email ?? "";
  const [nextEmail, setNextEmail] = useState(email);
  const { state, signals, reset } = useFeedback();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"email" | "export" | "pause" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The danger zone stays collapsed until asked for. Typing the address is not
  // a security control — the call is already behind `signedInOnly` — it is
  // there so an irreversible action cannot happen on one stray click.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => setNextEmail(email), [email]);

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const removeAccount = async () => {
    if (busy) return;
    setBusy("delete");
    setDeleteError(null);
    try {
      const result = await deleteAccount({ data: { confirmEmail: confirmEmail.trim() } });
      if (!result.ok) {
        setDeleteError(result.detail);
        return;
      }
      // The session outlives the account until it is cleared, and every request
      // it makes from here on would 401. Signing out is what actually ends the
      // visit; the redirect follows from the auth guard.
      await auth.signOut();
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : "Could not delete the account. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const changeEmail = async () => {
    const value = nextEmail.trim();
    if (!value || value === email || busy) return;
    setBusy("email");
    setError(null);
    try {
      await auth.updateEmail(value);
      save();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the email address.");
    } finally {
      setBusy(null);
    }
  };

  const downloadExport = async () => {
    if (busy) return;
    setBusy("export");
    setError(null);
    try {
      const data = await exportAccountData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `nyuz-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export your data.");
    } finally {
      setBusy(null);
    }
  };

  const pause = async () => {
    if (busy || prefs.paused) return;
    setBusy("pause");
    setError(null);
    await update({ paused: true });
    save();
    setBusy(null);
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
                className="mt-2 h-11 w-full rounded-2xl border border-input bg-background px-4 text-[16px] outline-none focus:border-signal md:text-[14.5px]"
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
                value={nextEmail}
                onChange={(event) => setNextEmail(event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-input bg-background px-4 text-[16px] outline-none focus:border-signal md:text-[14.5px]"
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                Changing this sends a confirmation link to the new address.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void changeEmail()}
                disabled={busy !== null || !nextEmail.trim() || nextEmail.trim() === email}
              >
                {busy === "email" ? "Sending…" : "Change email"}
              </Button>
            </div>
          </div>
          {error ? <p className="mt-4 text-[12.5px] text-destructive">{error}</p> : null}
        </Panel>

        <Panel title="Personalisation">
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex-1">
              <p className="flex items-center gap-2 text-[14px] font-medium">
                <Sparkles className="h-4 w-4 text-signal" /> Your nyuz is learning
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void downloadExport()}
                  disabled={busy !== null}
                >
                  <Download className="h-3.5 w-3.5" />
                  {busy === "export" ? "Preparing…" : "Export"}
                </Button>
              }
            />
            <RowAction
              title="Pause briefings"
              body="Stops delivery without losing your configuration or archive."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void pause()}
                  disabled={busy !== null || prefs.paused}
                >
                  {prefs.paused ? "Paused" : busy === "pause" ? "Pausing…" : "Pause"}
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
                Removes your profile, topics, feedback signals and delivery history. Any paid
                subscription is cancelled first. This cannot be undone.
              </p>
            </div>
            {confirmingDelete ? null : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirmingDelete(true);
                  setDeleteError(null);
                }}
                disabled={busy !== null}
              >
                Delete account
              </Button>
            )}
          </div>

          {confirmingDelete ? (
            <div className="mt-5 rounded-2xl border border-destructive/30 p-4">
              <label htmlFor="confirm-delete" className="text-[12.5px] text-muted-foreground">
                Type <span className="font-medium text-foreground">{email}</span> to confirm.
              </label>
              <input
                id="confirm-delete"
                type="email"
                autoComplete="off"
                value={confirmEmail}
                onChange={(event) => setConfirmEmail(event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-input bg-background px-4 text-[16px] outline-none focus:border-destructive md:text-[14.5px]"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void removeAccount()}
                  disabled={
                    busy !== null || confirmEmail.trim().toLowerCase() !== email.toLowerCase()
                  }
                >
                  {busy === "delete" ? "Deleting…" : "Delete my account"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setConfirmEmail("");
                    setDeleteError(null);
                  }}
                  disabled={busy !== null}
                >
                  Cancel
                </Button>
              </div>
              {deleteError ? (
                <p className="mt-3 text-[12.5px] text-destructive">{deleteError}</p>
              ) : null}
            </div>
          ) : null}
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
