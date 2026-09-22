import { RefreshCw } from "lucide-react";
import { applyUpdate, useUpdateReady } from "@/lib/sw";

/**
 * Offers the waiting version, instead of taking it.
 *
 * The worker installs a new version and then stops — it does not activate itself,
 * because swapping the asset set under a running app is how a lazily imported
 * chunk goes missing and a page goes blank (see public/sw.js). Something has to
 * hand over, and this is the whole of that something: one line, one button, and
 * no automatic reload that would interrupt a reader mid-story.
 *
 * A reader who never taps it still gets the new version — the browser activates
 * a waiting worker once every window of the old one has closed — so the prompt is
 * an offer rather than a requirement. It says so, rather than implying the app is
 * stuck until somebody acts.
 *
 * Renders nothing when there is nothing waiting, which is almost always.
 */
export function UpdateNotice() {
  const ready = useUpdateReady();
  if (!ready) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground"
    >
      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
      <p className="flex-1">
        <span className="font-medium text-foreground">A new version is ready.</span> It will load by
        itself next time you open nyuz.
      </p>
      <button
        onClick={applyUpdate}
        className="rounded-full border border-border px-3.5 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-muted"
      >
        Reload now
      </button>
    </div>
  );
}
