import { CloudOff } from "lucide-react";
import { useEffect, useState } from "react";
import { archiveAccount, latestSavedAt } from "@/lib/offline/archive";
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
 * It renders nothing at all when online, so a reader with a network never sees
 * it and the layout does not carry it around.
 *
 * Monochrome by house rule — `destructive` is deliberately greyscale because a
 * coloured error state competes with the accent for attention — so this leans on
 * an icon and a hairline, not on a colour.
 */
export function OfflineNotice() {
  const online = useOnline();
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

  // No SSR participation: the server snapshot of `useOnline` is "online", so the
  // server never renders this, and the client only ever adds it after mount.
  if (online) return null;

  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-2xl border border-hairline bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground"
    >
      <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        <span className="font-medium text-foreground">Offline.</span>{" "}
        {savedAt
          ? `Showing the copies saved on this device, last updated ${formatSavedAt(savedAt)}.`
          : checked
            ? "Nothing has been saved on this device yet, so there is nothing to read until you are back online."
            : "Reading from this device."}
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
