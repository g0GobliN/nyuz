import { Archive, CloudOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { archiveAccount, latestSavedAt } from "@/lib/offline/archive";
import { useServedCopySavedAt } from "@/lib/offline/copies";
import { useOnline } from "@/lib/online";

/**
 * Says, in one line, that what is on screen is a copy.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 *
 * Without it, an offline reader gets yesterday's briefing with no indication
 * that it is yesterday's — which is worse than an error, because a stale
 * briefing that looks current is exactly the failure the product exists to
 * prevent. The strip is the smallest honest answer: a caption, not a modal, and
 * never a spinner over content that is already readable.
 *
 * ---------------------------------------------------------------------------
 * Two different reasons, two different sentences
 * ---------------------------------------------------------------------------
 *
 * A dead network and a failed request both end at the archive, and the reader
 * needs to know which one happened:
 *
 *   offline        the browser has no network at all. Nothing is wrong with
 *                  nyuz, and nothing was attempted.
 *   a served copy  the network was up, the request did not come back, and the
 *                  archive answered. This is the case that used to be silent,
 *                  because the strip only drew when `navigator.onLine` was
 *                  false — so a live failure looked identical to a quiet news
 *                  day. `copies.ts` marks the answer and this draws for it.
 *
 * The second one clears itself: a live answer for the same screen removes the
 * mark, so the caption goes away when the request starts working again.
 *
 * Monochrome by house rule — `destructive` is deliberately greyscale because a
 * coloured error state competes with the accent for attention — so this leans on
 * an icon and a hairline, not on a colour.
 */
export function OfflineNotice() {
  const online = useOnline();
  const servedAt = useServedCopySavedAt();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (online) return;
    const userId = archiveAccount();
    if (!userId) {
      setChecked(true);
      return;
    }
    let active = true;
    void latestSavedAt(userId).then((at) => {
      if (!active) return;
      setSavedAt(at);
      setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [online]);

  if (online) {
    // No copy on screen: no strip. This is the common case and it renders
    // nothing at all, so a reader who is simply online never sees this.
    if (servedAt === null) return null;
    return (
      <Strip icon={<Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" />} lead="Saved copy.">
        The live request did not come back, so this is the copy saved on this device, last updated{" "}
        {formatSavedAt(servedAt)}.
      </Strip>
    );
  }

  return (
    <Strip icon={<CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />} lead="Offline.">
      {savedAt
        ? `Showing the copies saved on this device, last updated ${formatSavedAt(savedAt)}.`
        : checked
          ? "Nothing has been saved on this device yet, so there is nothing to read until you are back online."
          : "Reading from this device."}
    </Strip>
  );
}

/** The caption itself: an icon, a hairline, one sentence. */
function Strip({ icon, lead, children }: { icon: ReactNode; lead: string; children: ReactNode }) {
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-2xl border border-hairline bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground"
    >
      {icon}
      <p>
        <span className="font-medium text-foreground">{lead}</span> {children}
      </p>
    </div>
  );
}

/** Local time, since it is telling the reader about their own device's copy. */
function formatSavedAt(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "earlier";
  }
}
