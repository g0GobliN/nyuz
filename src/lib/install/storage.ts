import { bumpSessions } from "./offer";

/**
 * The card's memory: how many times this browser has opened Nyuz, and whether
 * the reader has already said no.
 *
 * `localStorage`, not the account, and that is the interesting decision. Both
 * facts are about a *device*: the reader who dismissed the card on their phone
 * has not dismissed it on the laptop, and a reader who has opened Nyuz three
 * times on a desktop has not thereby earned a nudge on the iPad they just
 * bought. Syncing either one through the account would also mean a schema, a
 * migration and a server write for a piece of advice about an icon.
 *
 * Everything here is best-effort. Private modes refuse to store, and a reader
 * whose browser forgets the count simply sees the card later than they might
 * have — the failure direction is a delay, not a nagging, because a count that
 * cannot be read is a count of one.
 */

const SESSIONS_KEY = "nyuz.sessions";
const CARD_KEY = "nyuz.install-card";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private modes refuse to store. Nothing here is load-bearing. */
  }
}

function parseSessions(): { count: number; last: number } | null {
  const raw = read(SESSIONS_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { count, last } = parsed as { count?: unknown; last?: unknown };
    if (typeof count !== "number" || typeof last !== "number") return null;
    return { count, last };
  } catch {
    // A corrupt blob is treated as no blob, which starts the count over. See the
    // header: the cost is that the card arrives one visit later.
    return null;
  }
}

/**
 * Records that Nyuz has been opened, and returns the session count including
 * this one. Called once per visit to Home, which is the destination the card
 * lives on and the one a briefing opens into.
 */
export function recordSession(now: number = Date.now()): number {
  const next = bumpSessions(parseSessions(), now);
  write(SESSIONS_KEY, JSON.stringify(next));
  return next.count;
}

/** The count as last recorded, for surfaces that only want to read it. */
export function readSessions(): number {
  return parseSessions()?.count ?? 0;
}

export function cardDismissed(): boolean {
  return read(CARD_KEY) === "dismissed";
}

export function dismissInstallCard(): void {
  write(CARD_KEY, "dismissed");
}
