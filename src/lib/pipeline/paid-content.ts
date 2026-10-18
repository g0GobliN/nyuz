/**
 * A publisher's paid-content lane, read off the article's URL.
 *
 * The arbiter's ruling #7 (2026-10-17, Q1, option 1): a story whose *every*
 * coverage URL is paid content is not a briefing item, so it is refused at
 * readiness rather than composed. The measured case was live in the pool that
 * day: *"NTT Global Data Centers weighs the price tag of not building fast
 * enough"*, whose only coverage URL is
 * `the register.com/ai-and-ml/2026/10/16/sponsored-global-data-centers-...` -- The
 * Register's sponsored lane. It had not reached a digest (no `digest_items` row),
 * so no reader had met that one; 36 of the 48,151 stored articles carry these
 * shapes (2026-10-18), and five of the 29 all-paid events **had** reached a
 * digest -- three briefings and two alerts, both of those alerts sent.
 *
 * A URL path is the signal because it is what the publisher publishes under: the
 * paid lane is a section of the site, not a property of the prose, which is why
 * the title-shaped rules could not see this story at all (its title reads exactly
 * like a reported feature). The rung is all-or-nothing on purpose -- the ruling's
 * condition -- because a story an outlet both reported and sold space around is a
 * news story with an advert beside it.
 */
const PAID_CONTENT_URL =
  /\/(?:sponsored|paid|advertorial|partner[-_]?content|brand[-_]?content|promoted|commercial)(?:[-/]|$)/i;

/** Whether this article URL is in a publisher's paid-content lane. */
export function isPaidContentUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && PAID_CONTENT_URL.test(url);
}
