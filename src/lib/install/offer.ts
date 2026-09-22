/**
 * How long a gap makes the next visit a new session.
 *
 * Thirty minutes is the usual guess at how long a reader stays "in" a sitting,
 * and the exact number matters less than the shape: it has to be long enough
 * that a reload or a wander between tabs is the same session, and short enough
 * that a morning briefing and an evening read count as two.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Return visits before the card is allowed to ask. Two means "they came back". */
export const SESSIONS_BEFORE_CARD = 2;

/**
 * What to offer this window, decided in one place.
 *
 * The order of the checks is the whole content of this module, and each step
 * exists because the obvious order is wrong:
 *
 * 1. Installed wins over everything. An app that is already on the Home Screen
 *    must never be told to install, even if the browser offers the event (it
 *    usually will not, but "usually" is not a thing to build a nag on).
 * 2. A real prompt beats the written steps. Chromium on Android and on the
 *    desktop hands us an event, and a button that calls the browser's own dialog
 *    is better than three sentences describing a menu.
 * 3. iOS is the one platform where the steps are the affordance, because there
 *    is no event and no API — Apple requires a Share-sheet action.
 * 4. Everything else is nothing. A browser that cannot install, or has already
 *    refused to offer it, gets no section at all rather than a disabled button
 *    or a set of instructions for a menu it may not have.
 *
 * That last case is the point of the module: "never fake installation" is not a
 * guideline here, it is a branch that returns no UI.
 *
 * `standalone` is passed as well as `installed`, even though `installedHere()`
 * already counts a standalone window, because the two are read differently:
 * `installed` comes from a snapshot that only recomputes when something happens,
 * and `standalone` is live. A window that changes display mode — Chrome's device
 * toolbar, or a tab that gets installed and relaunched — must stop being offered
 * installation immediately, not at the next `appinstalled`.
 */
export type InstallOffer = "installed" | "prompt" | "ios-steps" | "none";

export function installOffer(facts: {
  standalone: boolean;
  installed: boolean;
  ios: boolean;
  promptAvailable: boolean;
}): InstallOffer {
  if (facts.standalone || facts.installed) return "installed";
  if (facts.promptAvailable) return "prompt";
  if (facts.ios) return "ios-steps";
  return "none";
}

/**
 * One reader, one nudge — and only to somebody who has come back.
 *
 * The card exists to catch the reader who has used Nyuz enough to want it, which
 * is a small window: shown on the first visit it is an advert on the door, and
 * shown for weeks it is nagging. So the count is of *sessions*, where a session
 * is a visit that begins at least [SESSION_GAP_MS] after the previous one. A
 * single long afternoon in one tab is one session, deliberately: nothing about
 * that reader's day says they want the icon yet, and the card will be there
 * tomorrow.
 */
export function bumpSessions(
  stored: { count: number; last: number } | null,
  now: number,
): { count: number; last: number } {
  if (!stored || !Number.isFinite(stored.last) || stored.count < 1) {
    return { count: 1, last: now };
  }
  // `last` moves on every visit, so the next session is measured from the end of
  // this one rather than from the first visit that ever happened.
  return now - stored.last >= SESSION_GAP_MS
    ? { count: stored.count + 1, last: now }
    : { count: stored.count, last: now };
}

/**
 * Whether the Home card may be drawn at all.
 *
 * `online` is in here because the card is an offer to install for offline
 * reading, and making it while the reader is offline and reading a saved story
 * is noise at the worst moment. Dismissal is absolute, not a snooze: this is the
 * only card in the product that asks for something, and asking twice after being
 * told no is how a product becomes something to ignore.
 */
export function shouldShowInstallCard(facts: {
  offer: InstallOffer;
  sessions: number;
  dismissed: boolean;
  online: boolean;
}): boolean {
  if (facts.dismissed) return false;
  if (!facts.online) return false;
  if (facts.sessions < SESSIONS_BEFORE_CARD) return false;
  return facts.offer === "prompt" || facts.offer === "ios-steps";
}
