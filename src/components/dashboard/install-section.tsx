import { Check, Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/kit";
import { IosInstallSheet } from "@/components/dashboard/ios-steps-dialog";
import { useStandalone } from "@/lib/display-mode";
import { installOffer } from "@/lib/install/offer";
import { runInstallPrompt, useInstallFacts } from "@/lib/install/prompt";
import { isIOS } from "@/lib/platform";

/**
 * "Install Nyuz", on the Profile/Settings page.
 *
 * Four states, and only the middle two have a button:
 *
 * - **prompt** — the browser captured a real install event, so the button calls
 *   the browser's own dialog. This is the only state that can install anything
 *   programmatically, and it cannot be faked: if no event was captured this
 *   branch is not reachable, which is why the button is allowed to look this
 *   confident.
 * - **ios-steps** — iPhone and iPad get the Share-sheet steps instead, because
 *   that is the only way installation happens there.
 * - **installed** — a sentence, not an offer. An app already on the Home Screen
 *   asking to be installed is the one thing this section must never do.
 * - **none** — nothing at all. A browser with no install event and no steps to
 *   give shows no section, rather than a dead button or a description of a menu
 *   it may not have.
 *
 * Rendered in both layouts, not only the installed app: the reader most likely to
 * install is the one currently in a browser tab.
 */
export function InstallSection() {
  const standalone = useStandalone();
  const { installed, promptAvailable } = useInstallFacts();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"cancelled" | "refused" | null>(null);

  const offer = installOffer({ standalone, installed, ios: isIOS(), promptAvailable });

  // After the hooks, never before: a section that vanishes must not skip them.
  if (offer === "none") return null;

  const install = async () => {
    setBusy(true);
    setNote(null);
    const outcome = await runInstallPrompt();
    setBusy(false);
    // Both non-answers are worth a sentence, and they are different sentences.
    // The captured event is single-use, so once the reader has declined, this
    // section has nothing left to call — it would otherwise lose its button and
    // read as broken rather than as "no".
    if (outcome === "dismissed") setNote("cancelled");
    if (outcome === "unavailable") setNote("refused");
  };

  return (
    <section className="rounded-3xl border border-hairline bg-surface p-6 sm:p-7">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Install
      </h2>

      {offer === "installed" ? (
        <div className="mt-5">
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <Check className="h-4 w-4 text-signal" />
            Installed on this device
          </p>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
            Nyuz opens from your Home Screen without browser chrome, and the stories you save or
            open stay readable without a connection.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-[14px] font-medium">Get the full Nyuz experience</p>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
            Add Nyuz to your Home Screen for faster launch, cleaner navigation, offline access to
            saved and recently opened stories, and notifications that open straight into Nyuz.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {offer === "prompt" ? (
              <Button size="sm" onClick={() => void install()} disabled={busy}>
                {busy ? "Opening…" : "Install Nyuz"}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStepsOpen(true)}>
                <Share2 className="h-3.5 w-3.5" />
                Add to Home Screen
              </Button>
            )}
            <span className="text-[12px] text-muted-foreground">No App Store required.</span>
          </div>

          {note ? (
            <p className="mt-3 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
              {note === "cancelled"
                ? "Installation was cancelled. Your browser decides when to offer it again — or install Nyuz from its own menu."
                : "Your browser did not open its install prompt. You can still install Nyuz from the browser's own menu."}
            </p>
          ) : null}
        </div>
      )}

      <IosInstallSheet open={stepsOpen} onOpenChange={setStepsOpen} />
    </section>
  );
}
