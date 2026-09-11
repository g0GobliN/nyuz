/**
 * Whether briefings are arriving when their readers asked for them.
 *
 *   npm run briefing:timing              # every reader, last 14 slots each
 *   npm run briefing:timing -- --days 3
 *
 * The one number this exists to print is `late` — seconds between the deadline
 * the reader chose and the moment the briefing actually reached them. Before
 * 0077 that number was not recorded anywhere and had to be reconstructed from
 * `generated_at` minus `scheduled_for`, which measured the wrong thing: it
 * missed the twenty minutes an on-time briefing could then spend behind a
 * delivery claim held by a worker that had died.
 *
 * Reads `public.briefing_timing`. Writes nothing, and is meant to be run
 * against production.
 */

import { db, heading, main, say } from "./lib/db.ts";

type Row = {
  scheduled_local: string;
  scheduled_timezone: string;
  scheduled_utc: string;
  generation_started_at: string | null;
  generation_completed_at: string | null;
  generation_attempts: number;
  digest_status: string;
  item_count: number;
  generation_failure_reason: string | null;
  channel: string | null;
  delivery_claimed_at: string | null;
  delivery_first_attempt_at: string | null;
  delivery_attempts: number | null;
  delivery_status: string | null;
  delivered_at: string | null;
  delivery_last_error: string | null;
  lateness_seconds: number | null;
};

function arg(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : fallback;
}

/** Seconds as something an operator reads at a glance rather than divides. */
function human(seconds: number | null): string {
  if (seconds === null) return "—";
  const sign = seconds < 0 ? "-" : "+";
  const n = Math.abs(seconds);
  if (n < 90) return `${sign}${n}s`;
  if (n < 5400) return `${sign}${Math.round(n / 60)}m`;
  return `${sign}${(n / 3600).toFixed(1)}h`;
}

/** The gap between two instants, or null when either is missing. */
function gap(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  return human(Math.round((Date.parse(to) - Date.parse(from)) / 1000));
}

main(async () => {
  const days = arg("days", 14);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data, error } = await db()
    .from("briefing_timing")
    .select("*")
    .gte("scheduled_utc", since)
    .order("scheduled_utc", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) {
    say(`No briefings scheduled in the last ${days} days.`);
    return;
  }

  heading(`Briefing timing, last ${days} days`);
  say(
    [
      "promised".padEnd(17),
      "zone".padEnd(14),
      "ch".padEnd(9),
      "gen".padEnd(7),
      "late".padEnd(7),
      "items".padEnd(6),
      "status",
    ].join(" "),
  );

  for (const row of rows) {
    // Generation lead: negative means it finished before the deadline, which is
    // the whole intent of the prepare window.
    const lead = gap(row.scheduled_utc, row.generation_completed_at);
    // A row claimed but never attempted is a worker that died between taking
    // the briefing and calling the provider. It is worth saying out loud,
    // because it is the one failure that looks like nothing happened at all.
    const stranded = row.delivery_claimed_at !== null && row.delivery_first_attempt_at === null;
    const note = stranded
      ? "claimed, never attempted (worker lost)"
      : (row.generation_failure_reason ??
        row.delivery_last_error ??
        `${row.digest_status}/${row.delivery_status ?? "no delivery"}`);

    say(
      [
        row.scheduled_local.padEnd(17),
        row.scheduled_timezone.slice(0, 13).padEnd(14),
        (row.channel ?? "—").padEnd(9),
        lead.padEnd(7),
        human(row.lateness_seconds).padEnd(7),
        String(row.item_count).padEnd(6),
        note,
      ].join(" "),
    );
  }

  const delivered = rows.filter((r) => r.lateness_seconds !== null);
  const late = delivered.filter((r) => (r.lateness_seconds ?? 0) > 120);
  heading("Contract");
  say(`delivered:      ${delivered.length} of ${rows.length}`);
  say(`over 2m late:   ${late.length}`);
  if (delivered.length > 0) {
    const worst = Math.max(...delivered.map((r) => r.lateness_seconds ?? 0));
    const median =
      delivered.map((r) => r.lateness_seconds ?? 0).sort((a, b) => a - b)[
        Math.floor(delivered.length / 2)
      ] ?? 0;
    say(`median lateness: ${human(median)}`);
    say(`worst lateness:  ${human(worst)}`);
  }
});
