import { MARK_PATH } from "@/components/landing/nav";
import { cn } from "@/lib/utils";

/**
 * Every wait in the product is the mark drawing itself.
 *
 * A generic spinner says "a computer is busy". The mark being written says the
 * same thing in our own hand, and it is the one animation the product can afford
 * to repeat everywhere without it reading as decoration. The trace runs over a
 * faint copy of the finished letterform, so the logo is legible at every frame
 * rather than appearing only at the end of a cycle.
 *
 * `tone` exists because the trace is normally the signal blue, and blue on the
 * primary button — which is already near-black or near-white — loses too much
 * contrast. Inside a button, pass "current" and the mark takes the button's own
 * ink.
 *
 * The label is announced, not drawn. Callers that also want it on screen use
 * `Loading` below rather than repeating the string.
 */
export function LogoLoader({
  className,
  label = "Loading",
  tone = "signal",
}: {
  className?: string;
  label?: string;
  tone?: "signal" | "current";
}) {
  const ink = tone === "current" ? "currentColor" : "var(--signal)";
  return (
    <span role="status" className="inline-flex shrink-0 items-center justify-center">
      <svg viewBox="0 0 40 40" className={cn("h-6 w-6", className)} fill="none" aria-hidden="true">
        {/* The finished mark, held back far enough to read as a track. */}
        <path d={MARK_PATH} stroke="currentColor" strokeWidth="3.48" className="opacity-15" />
        <path
          d={MARK_PATH}
          stroke={ink}
          strokeWidth="3.48"
          strokeLinecap="round"
          className="mark-trace"
        />
        <circle cx="32.11" cy="33.21" r="1.79" fill={ink} className="mark-dot" />
      </svg>
      <span className="sr-only">{label}…</span>
    </span>
  );
}

/**
 * The in-page wait: the mark with its label beside it. This is the shape almost
 * every list and panel wants, which is why the console's `Loading` is now a
 * re-export of it.
 */
export function Loading({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn("flex items-center gap-2.5 py-10 text-[13px] text-muted-foreground", className)}
    >
      <LogoLoader className="h-5 w-5" label={label} />
      <span aria-hidden="true">{label}…</span>
    </div>
  );
}

/**
 * The whole-screen wait, used by the guards that hold a route back until they
 * know who you are. It draws no label on purpose: those waits are usually under
 * a second, and a sentence about checking your session is worse than a mark.
 */
export function PageLoading({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-screen items-center justify-center bg-background", className)}>
      <LogoLoader className="h-9 w-9" label={label} />
    </div>
  );
}

/**
 * The same wait inside a shell that has already drawn its chrome — the sidebar
 * and header are up, only the panel is still coming.
 */
export function PanelLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <LogoLoader className="h-8 w-8" label={label} />
    </div>
  );
}
