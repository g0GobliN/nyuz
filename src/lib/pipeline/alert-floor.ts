/**
 * What an alert is allowed to be.
 *
 * Two parts, both narrower than the briefing's bar.
 *
 *   - `IMPORTANT_FLOOR` — the same floor as Minimal density: "only the things
 *     you would regret missing". Kept in its own module so the alert stage, the
 *     significance rule and the shadow can all read it without importing each
 *     other: `alerts.ts` calls the P4 rule in `subject-significance.ts`, which
 *     needs this number, and a constant reached through a cycle can be read
 *     before it is initialised.
 *   - `assessAlertFloor` — the shape floor. An alert is reserved for a breaking,
 *     important development, which is a stricter claim than "a readable briefing
 *     story". After the D8 gate, five shapes still reached phones that no rule
 *     refused: a vendor roadmap advertorial, a product newsletter, a hobby
 *     hack, a personal blog post and a memory-kit price piece. Each is a
 *     development-free shape a phone must not be interrupted for, so each is
 *     refused here, deliberately one narrow rule per class rather than one
 *     blanket rule that would trade these five for real breaking news.
 */
export const IMPORTANT_FLOOR = 6;

export type AlertFloorKind =
  | "roadmap-advertorial"
  | "product-newsletter"
  | "hobby-hack"
  | "personal-blog"
  | "price-piece"
  | "shelf-deal"
  | "commentary";

export type AlertFloorVerdict =
  { ready: true } | { ready: false; kind: AlertFloorKind; reason: string };

/**
 * A vendor's roadmap pitched at the reader's own estate, not reported as an
 * event. A development about a roadmap is reported in the third person
 * ("Nvidia unveils its 2027 chip roadmap"); the advertorial asks about "your
 * software estate", which is the tell no report carries.
 */
const ROADMAP = /\broadmap\b/i;
const SECOND_PERSON = /\byour\b/i;

/**
 * A vendor announcing what its product now does, in the first person of its
 * own press copy ("Gremlin now uses AI to break distributed systems faster").
 * A reported development carries a news verb or a third-person subject; "now
 * <capability verb>" is the vendor's own release cadence. The one thing this
 * pattern also matches — a code feed's "llama.cpp Vulkan backend now uses CPU
 * writes" changelog — is single-source `github`, which the readiness gate's
 * `primary-source` rung refuses before this floor ever runs, and it sits below
 * the importance floor regardless.
 */
const NOW_CAPABILITY =
  /\bnow\s+(?:uses|offers|adds|supports|introduces|ships|brings|delivers|runs|powers|helps)\b/i;

/**
 * An enthusiast's mod, not a security event. "hack" as a noun that *delivers* a
 * feature ("PS5 hack delivers native PS2 disc support") is modding; a breach
 * steals, exposes or leaks, and never "delivers" a capability to the reader.
 */
const HOBBY_HACK = /\bhack\b\s+delivers?\b/i;

/**
 * A personal-subscription newsletter's edition numbering ("2026.41: It's Not
 * You, It's Me"). Breaking news never wears a year.week prefix.
 */
const PERSONAL_EDITION = /^\d{4}\.\d{1,2}:\s/;

/**
 * A price tag on a consumer object with no event behind it ("Customer sends
 * two-stick $16,000 DDR5 memory kit to repair shop"). The amount is the whole
 * story; a reported price move names what changed, and the money rungs in
 * `readiness.ts` already catch the sale and shelf shapes this is not.
 */
const PRICE = /\$\s?\d[\d,]*/;
const PRICE_OBJECT = /\b(?:memory|ram)\s+kit\b/i;

/**
 * A shelf/deal title: the reader being invited to obtain the object, not told
 * what happened. The arbiter's ruling of 2026-10-17 (#5) added the measured
 * class: "This could be your last chance to grab an RTX 5090" (a deals post,
 * importance 6, alerted 2026-10-16T18:14).
 *
 * Two halves, both required, because either one alone is a shape real news
 * wears: the *urgency frame* addressed at a buyer ("last chance", "while
 * stocks last", "before they sell out") and an *acquisition verb* the reader is
 * being asked to perform ("grab", "buy", "order"). Measured over all 21,908
 * stored event titles, both halves together match exactly 1 title -- that one
 * alert -- and the ruling's three news controls match none of them: "Nvidia
 * agrees to acquire Hugging Face for $13B", "DOJ opens antitrust probe into
 * Nvidia's $20bn Groq deal", and "New York rep announces game ownership bill
 * that would require consumer ownership rather than sale of licenses". The
 * discount-shaped candidates a wider rule would have used ("% off", "save $N",
 * "price drop", "deal of the day") were measured too and match **0** titles at
 * importance >= 6, so they are not added: a clause with no measured class can
 * only refuse news it was never shown to refuse.
 */
const SHELF_FRAME = /\b(?:last chance|while (?:stocks|supplies) last|before they sell out)\b/i;
const SHELF_ACQUIRE = /\b(?:grab|snag|buy|order|pre-?order|claim|get)\b/i;

/**
 * A commentary title: the writer arguing a stance about the reader's own
 * behaviour rather than reporting a development. The arbiter's ruling of
 * 2026-10-17 (#5) added the measured class: "It won't kill you, or humanity, to
 * get off the AI upgrade treadmill" (a commentary column, importance 6,
 * alerted 2026-10-14T12:44).
 *
 * The marker is the *shape* -- a negated modal about an audience ("it won't
 * <verb> you / us / humanity") -- and not the topic word, so it generalises to
 * the next column of that shape without a list of verbs or subjects. Measured
 * over all 21,908 stored event titles: 1 match, that title, and the ruling's
 * analysis control is untouched: "Morgan Stanley/SCMP analysis links US export
 * controls to China supply-chain gains" reports someone else's analysis in the
 * third person and carries no such construct. The narrower candidates (a
 * "treadmill" noun, "to get off", "won't kill") each match the same single
 * title, so the shape is preferred over any of them: it is the one that does
 * not have to be re-measured when the next column rephrases the topic.
 */
const STANCE_MODAL =
  /\bit\s+(?:won['’]t|doesn['’]t|isn['’]t)\s+[a-z]{2,}\s+(?:you|us|anyone|humanity|people|anybody|everybody|your)\b/i;

export function assessAlertFloor(input: {
  title: string;
  whatHappened?: string | null | undefined;
}): AlertFloorVerdict {
  const title = (input.title ?? "").replace(/\s+/gu, " ").trim();

  if (ROADMAP.test(title) && SECOND_PERSON.test(title)) {
    return {
      ready: false,
      kind: "roadmap-advertorial",
      reason: "title is a vendor roadmap advertorial, not a development",
    };
  }

  if (NOW_CAPABILITY.test(title)) {
    return {
      ready: false,
      kind: "product-newsletter",
      reason: "title announces a vendor's own product capability",
    };
  }

  if (HOBBY_HACK.test(title)) {
    return {
      ready: false,
      kind: "hobby-hack",
      reason: "title is an enthusiast hack delivering a feature, not a development",
    };
  }

  if (PERSONAL_EDITION.test(title)) {
    return {
      ready: false,
      kind: "personal-blog",
      reason: "title is a numbered personal-newsletter edition",
    };
  }

  if (PRICE.test(title) && PRICE_OBJECT.test(title)) {
    return {
      ready: false,
      kind: "price-piece",
      reason: "title is a priced consumer object, not a development",
    };
  }

  if (SHELF_FRAME.test(title) && SHELF_ACQUIRE.test(title)) {
    return {
      ready: false,
      kind: "shelf-deal",
      reason: "title is a shelf or deal offer, not a development",
    };
  }

  if (STANCE_MODAL.test(title)) {
    return {
      ready: false,
      kind: "commentary",
      reason: "title argues a stance about the reader, not a development",
    };
  }

  return { ready: true };
}
