import { Pill, formatDateTime } from "@/components/admin/shell";
import type { DeliveryChannelHealth } from "@/lib/server/operations-diagnostics";

/**
 * Per-channel delivery health, as a status rather than a count (Audit 41).
 *
 * This lives beside the console's other components rather than in the route
 * that draws it for one reason: it is the panel that has to be readable when
 * something is wrong, so what it draws is pinned by a render test. The verdict
 * itself is computed on the server in `deliveryHealthOf`; this only shows it.
 */
export function DeliveryHealth({ rows }: { rows: DeliveryChannelHealth[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 divide-y divide-[var(--hairline)] rounded-lg border border-[var(--hairline)] text-[12px]">
      {rows.map((row) => (
        <div key={row.channel} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
          {/*
            Only `failing` takes the accent. `degraded` is deliberately quiet:
            on a low-volume channel one failure in four attempts reaches the
            threshold, and a chip that lights up for that would be noise.
          */}
          <Pill tone={row.verdict === "failing" ? "signal" : "neutral"}>
            {row.channel} · {row.verdict}
          </Pill>
          <span className="text-muted-foreground">
            last 24h: {row.recent.sent} sent · {row.recent.failed} failed
          </span>
          <span className="text-muted-foreground">
            {row.attempts === 0 || row.successRate === null
              ? "nothing resolved yet"
              : `success ${Math.round(row.successRate * 100)}% of ${row.attempts} resolved`}
          </span>
          <span className="text-muted-foreground">
            last success {row.lastSuccessAt ? formatDateTime(row.lastSuccessAt) : "none in window"}
          </span>
          {/* Dated on purpose: a channel reading ok can still carry a terminal
              failure from weeks ago, and the date is what says it is stale. */}
          {row.latestTerminalError ? (
            <span className="text-muted-foreground">
              terminal {formatDateTime(row.latestTerminalAt)} · {row.latestTerminalError}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
