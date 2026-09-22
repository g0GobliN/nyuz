import { Share2 } from "lucide-react";

import { Button } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The steps, written once.
 *
 * Apple requires a Share-sheet action for installation and offers no API for it,
 * so on iOS the instructions *are* the affordance — and there were two places
 * that needed them: turning on push notifications, which WebKit only exposes to
 * Home Screen web apps, and the install section itself. Two copies of the same
 * three steps is how one of them ends up describing an iOS that no longer exists.
 *
 * A share glyph sits beside the first step for the same reason the product has
 * no screenshots: on iOS 16 and later the Share button is an icon in a toolbar
 * the reader is looking at, and naming it in words alone is a hunt.
 */
/** The three steps, in the words of the product rather than of Apple's menus. */
const IOS_INSTALL_STEPS = ["Tap the Share button", 'Choose "Add to Home Screen"', 'Tap "Add"'];

export function IosStepsDialog({
  open,
  onOpenChange,
  title,
  intro,
  steps,
  note,
  confirmLabel = "Got it",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  intro?: string;
  steps: string[];
  note?: string;
  confirmLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <div className="mt-4 space-y-4 text-left text-[13px] text-muted-foreground">
            {intro ? <p>{intro}</p> : null}
            <ol className="space-y-3">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-[11px] font-semibold text-signal">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">
                    {step}
                    {index === 0 ? (
                      <Share2 className="ml-1.5 inline h-3.5 w-3.5 -translate-y-px" />
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            {note ? <p className="pt-1">{note}</p> : null}
          </div>
        </DialogHeader>
        <div className="mt-6 flex justify-end">
          <Button variant="primary" size="sm" onClick={() => onOpenChange(false)}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The install sheet itself, already filled in.
 *
 * Both places that offer installation render this — the Settings section and the
 * Home card — because they are making the same offer, and two copies of a
 * three-step instruction are how one of them ends up describing a Share menu
 * that no longer exists. The push dialog is deliberately *not* this component:
 * it has a fourth step (the notification permission) that has nothing to do
 * with installing.
 */
export function IosInstallSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <IosStepsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Nyuz to your Home Screen"
      intro="iPhone and iPad install from the Share menu. It takes a few seconds, and only once."
      steps={IOS_INSTALL_STEPS}
      note="Nyuz opens from your Home Screen like any other app. No App Store required."
    />
  );
}
