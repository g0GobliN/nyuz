import { Share2, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/kit";
import { IosInstallSheet } from "@/components/dashboard/ios-steps-dialog";
import { useStandalone } from "@/lib/display-mode";
import { installOffer, shouldShowInstallCard } from "@/lib/install/offer";
import { runInstallPrompt, useInstallFacts } from "@/lib/install/prompt";
import { cardDismissed, dismissInstallCard, recordSession } from "@/lib/install/storage";
import { useOnline } from "@/lib/online";
import { isIOS } from "@/lib/platform";

/**
 * The one nudge, on Home, once.
 *
 * It exists for the reader who has come back — the count is of sessions, not
 * page views — because the value of installing is only legible to somebody who
 * has already read a briefing in a browser tab. Shown on the first visit it is an
 * advert on the door.
 *
 * The same rules as the Settings section apply, plus two of its own: it needs a
 * second session to be allowed to ask at all, and "Not now" is final. Dismissal
 * is stored, not held in state, so it survives the reload, the next deployment
 * and the passage of a month. There is no snooze, because a card that comes back
 * is the definition of nagging.
 *
 * Recording the session happens here rather than in the shell: Home is the
 * destination the card lives on and the one a briefing opens into, so the count
 * measures exactly what the card is asking about — how many times this reader has
 * come to Nyuz.
 */
export function InstallCard() {
  const standalone = useStandalone();
  const online = useOnline();
  const { installed, promptAvailable } = useInstallFacts();
  // Starts dismissed and at zero so the first paint never shows a card that
  // storage is about to take away. Both resolve in one effect, before the reader
  // has read the headline.
  const [dismissed, setDismissed] = useState(true);
  const [sessions, setSessions] = useState(0);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    setDismissed(cardDismissed());
    setSessions(recordSession());
  }, []);

  const ios = isIOS();
  const offer = installOffer({ standalone, installed, ios, promptAvailable });

  if (!shouldShowInstallCard({ offer, sessions, dismissed, online })) return null;

  const dismiss = () => {
    dismissInstallCard();
    setDismissed(true);
  };

  const install = async () => {
    setBusy(true);
    setRefused(false);
    const outcome = await runInstallPrompt();
    setBusy(false);
    // Declining the browser's own dialog counts as having answered the card. It
    // gets one question, and leaving it on screen after a "no" — with no prompt
    // left to offer, because the event is single-use — would be a card that can
    // no longer do anything except ask again.
    if (outcome === "dismissed") {
      dismiss();
      return;
    }
    if (outcome === "unavailable") setRefused(true);
  };

  return (
    <div className="mb-8 flex flex-wrap items-start gap-4 rounded-3xl border border-signal/30 bg-surface p-5 sm:p-6">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal">
        <Smartphone className="h-4.5 w-4.5" />
      </span>

      <div className="min-w-[14rem] flex-1">
        <p className="text-[14px] font-medium">Nyuz works better from your Home Screen</p>
        <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-muted-foreground">
          Faster launch, offline reading, cleaner navigation and the full reader experience. No App
          Store required.
        </p>

        <div className="mt-3.5 flex flex-wrap items-center gap-4">
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
          <button
            onClick={dismiss}
            className="text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Not now
          </button>
        </div>

        {refused ? (
          <p className="mt-3 max-w-lg text-[12.5px] leading-relaxed text-muted-foreground">
            Your browser did not open its install prompt. You can still install Nyuz from the
            browser's own menu.
          </p>
        ) : null}
      </div>

      <IosInstallSheet open={stepsOpen} onOpenChange={setStepsOpen} />
    </div>
  );
}
