import { mailWhy } from "@/lib/article-body";
import {
  type Email,
  button,
  emptyState,
  escapeHtml,
  layout,
  p,
  pMuted,
  panel,
  storyBrief,
} from "./shell";

/**
 * Every lifecycle email nyuz sends, as pure functions.
 *
 * No transport, no secrets, no environment. A template takes plain data and
 * returns a subject, an HTML body and a plain-text body, which makes the whole
 * set testable in the node runner the rest of the project already uses and
 * keeps the copy reviewable without running a mail server.
 *
 * The plain-text part is written out by hand rather than stripped from the HTML.
 * Auto-stripping produces text nobody would send, and the text part is what a
 * spam filter reads most carefully — a message with no real text alternative is
 * a message that lands in the promotions tab.
 *
 * The voice is the product's: say what happened, say what it costs, do not
 * manufacture urgency and do not beg. "Quiet days stay quiet" is a promise the
 * mail has to keep too.
 */

export type PlanLabel = "Personal" | "Pro";

type Base = {
  /** Blank is fine — every greeting here works without a name. */
  name?: string;
  /** Absolute origin, e.g. https://nyuz.app. Links in email cannot be relative. */
  baseUrl: string;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "3 September 2026", built by hand.
 *
 * `toLocaleDateString` depends on the ICU data present in the runtime, and
 * Cloudflare Workers is not a machine whose locale anybody chose. A billing
 * date is the wrong place to discover that. The long form also avoids the
 * 03/09 reading that means two different days on two continents.
 */
export function formatEmailDate(date: Date): string {
  const month = MONTHS[date.getUTCMonth()] ?? "";
  return `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/** "Hello Sam," or "Hello," — never an invented placeholder name. */
function greet(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? `Hello ${escapeHtml(trimmed)},` : "Hello,";
}

function greetText(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? `Hello ${trimmed},` : "Hello,";
}

/* ---------------------------------------------------------------------- */
/* 1. Account created                                                      */
/* ---------------------------------------------------------------------- */

export function welcomeEmail({ name, baseUrl }: Base): Email {
  const href = `${baseUrl}/dashboard/topics`;

  return {
    subject: "Your nyuz account is ready",
    html: layout({
      preheader: "Tell it what to watch for and your first briefing follows.",
      eyebrow: "Account",
      heading: "Welcome to nyuz.",
      baseUrl,
      body: [
        p(greet(name)),
        p(
          "Your account is set up. One thing is left, and it is the only thing that decides whether any of this is useful: telling nyuz what matters to you.",
        ),
        p(
          "Topics, companies, technologies — and, just as importantly, what to ignore. An exclusion holds: a term you have excluded cannot be smuggled back in by a topic you follow.",
        ),
        button("Choose my topics", href),
        pMuted(
          "After that it runs on its own. Most mornings a briefing is six stories. Some mornings it is one. Occasionally it is none, and we will tell you that rather than padding it out.",
        ),
      ].join("\n"),
    }),
    text: [
      greetText(name),
      "",
      "Your nyuz account is set up. One thing is left, and it is the only thing that decides whether any of this is useful: telling nyuz what matters to you.",
      "",
      "Topics, companies, technologies - and, just as importantly, what to ignore. An exclusion holds: a term you have excluded cannot be smuggled back in by a topic you follow.",
      "",
      `Choose my topics: ${href}`,
      "",
      "After that it runs on its own. Most mornings a briefing is six stories. Some mornings it is one. Occasionally it is none, and we will tell you that rather than padding it out.",
      "",
      `Manage your briefing: ${baseUrl}/dashboard/settings`,
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 2. Subscription started                                                 */
/* ---------------------------------------------------------------------- */

export function subscriptionStartedEmail({
  name,
  baseUrl,
  plan,
  priceLabel,
  renewsOn,
}: Base & { plan: PlanLabel; priceLabel: string; renewsOn: Date }): Email {
  const href = `${baseUrl}/dashboard/billing`;
  const renews = formatEmailDate(renewsOn);

  return {
    subject: `You are on nyuz ${plan}`,
    html: layout({
      preheader: `${plan} is active. Renews ${renews}.`,
      eyebrow: "Billing",
      heading: `You are on ${plan}.`,
      baseUrl,
      body: [
        p(greet(name)),
        p("Payment went through and your plan is active from now."),
        panel([
          { label: "Plan", value: `nyuz ${plan}` },
          { label: "Price", value: priceLabel },
          { label: "Renews", value: renews },
        ]),
        p(
          "Nothing else changes about how nyuz works — the same briefing, at the same time, with more room in it.",
        ),
        button("View billing", href),
        pMuted(
          "Cancel whenever you like from the billing page. Cancelling keeps your access until the end of the period you have already paid for.",
        ),
      ].join("\n"),
    }),
    text: [
      greetText(name),
      "",
      "Payment went through and your plan is active from now.",
      "",
      `Plan:    nyuz ${plan}`,
      `Price:   ${priceLabel}`,
      `Renews:  ${renews}`,
      "",
      "Nothing else changes about how nyuz works - the same briefing, at the same time, with more room in it.",
      "",
      `View billing: ${href}`,
      "",
      "Cancel whenever you like from the billing page. Cancelling keeps your access until the end of the period you have already paid for.",
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 3. Subscription cancelled                                               */
/* ---------------------------------------------------------------------- */

export function subscriptionCancelledEmail({
  name,
  baseUrl,
  plan,
  accessUntil,
}: Base & { plan: PlanLabel; accessUntil: Date }): Email {
  const href = `${baseUrl}/dashboard/billing`;
  const until = formatEmailDate(accessUntil);

  return {
    subject: `Your nyuz ${plan} plan is cancelled`,
    html: layout({
      preheader: `You keep ${plan} until ${until}. Nothing is deleted.`,
      eyebrow: "Billing",
      heading: "Your plan is cancelled.",
      baseUrl,
      body: [
        p(greet(name)),
        p(
          `That is done — you will not be charged again. You keep everything ${escapeHtml(plan)} includes until <strong>${escapeHtml(until)}</strong>, the end of the period you have already paid for.`,
        ),
        p(
          "After that the account moves to Free rather than closing. Your topics, exclusions and schedule stay exactly as you left them, and briefings keep arriving within the Free plan's limits.",
        ),
        button("Reactivate", href),
        pMuted(
          "If something specific pushed you off the paid plan, replying to this message reaches a person.",
        ),
      ].join("\n"),
    }),
    text: [
      greetText(name),
      "",
      `That is done - you will not be charged again. You keep everything ${plan} includes until ${until}, the end of the period you have already paid for.`,
      "",
      "After that the account moves to Free rather than closing. Your topics, exclusions and schedule stay exactly as you left them, and briefings keep arriving within the Free plan's limits.",
      "",
      `Reactivate: ${href}`,
      "",
      "If something specific pushed you off the paid plan, replying to this message reaches a person.",
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 4. Payment failed                                                       */
/* ---------------------------------------------------------------------- */

export function paymentFailedEmail({
  name,
  baseUrl,
  plan,
  retryOn,
}: Base & { plan: PlanLabel; retryOn: Date }): Email {
  const href = `${baseUrl}/dashboard/billing`;
  const retry = formatEmailDate(retryOn);

  return {
    subject: "Your nyuz payment did not go through",
    html: layout({
      preheader: `We will try again on ${retry}. Your briefings keep arriving until then.`,
      eyebrow: "Billing",
      heading: "That payment did not go through.",
      baseUrl,
      body: [
        p(greet(name)),
        p(
          `Your card was declined for the nyuz ${escapeHtml(plan)} renewal. That is usually an expired card or a bank holding an online charge, not anything wrong at your end.`,
        ),
        p(
          `We will try again on <strong>${escapeHtml(retry)}</strong>. Until then nothing changes — your briefings keep arriving exactly as they are.`,
        ),
        button("Update payment method", href),
        pMuted(
          "If the retry fails too, the account moves to Free rather than closing. Nothing is deleted and nothing is lost.",
        ),
      ].join("\n"),
    }),
    text: [
      greetText(name),
      "",
      `Your card was declined for the nyuz ${plan} renewal. That is usually an expired card or a bank holding an online charge, not anything wrong at your end.`,
      "",
      `We will try again on ${retry}. Until then nothing changes - your briefings keep arriving exactly as they are.`,
      "",
      `Update payment method: ${href}`,
      "",
      "If the retry fails too, the account moves to Free rather than closing. Nothing is deleted and nothing is lost.",
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 5. Briefings paused from settings                                       */
/* ---------------------------------------------------------------------- */

export function briefingsPausedEmail({ name, baseUrl }: Base): Email {
  const href = `${baseUrl}/dashboard/delivery`;

  return {
    subject: "Your nyuz briefings are paused",
    html: layout({
      preheader: "Nothing will arrive until you turn them back on.",
      eyebrow: "Delivery",
      heading: "Briefings paused.",
      baseUrl,
      body: [
        p(greet(name)),
        p(
          "Nothing will arrive from now on. This is a confirmation, not a nudge — there is no follow-up to this message and no campaign behind it.",
        ),
        p(
          "Your account, topics and schedule are untouched. Turning briefings back on resumes exactly where you left off.",
        ),
        button("Resume briefings", href),
      ].join("\n"),
    }),
    text: [
      greetText(name),
      "",
      "Nothing will arrive from now on. This is a confirmation, not a nudge - there is no follow-up to this message and no campaign behind it.",
      "",
      "Your account, topics and schedule are untouched. Turning briefings back on resumes exactly where you left off.",
      "",
      `Resume briefings: ${href}`,
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 6. Dormant reader                                                       */
/* ---------------------------------------------------------------------- */

export function dormantEmail({
  name,
  baseUrl,
  days,
  unsubscribeUrl,
}: Base & { days: number; unsubscribeUrl: string }): Email {
  const topics = `${baseUrl}/dashboard/topics`;
  const delivery = `${baseUrl}/dashboard/delivery`;

  return {
    subject: `You have not visited nyuz in ${days} days`,
    html: layout({
      preheader: "Worth tuning, or worth turning off. Both are one click.",
      eyebrow: "Your briefing",
      heading: "Is this still useful?",
      baseUrl,
      unsubscribeUrl,
      body: [
        p(greet(name)),
        p(
          `You have not visited nyuz in ${String(days)} days. Free briefings pause automatically after 30 inactive days, so this is a good moment to tune them or keep them running.`,
        ),
        p(
          "<strong>The stories are not right.</strong> Topics too broad, or something you follow dragging in noise you did not want. Exclusions are the sharper tool here — they win over topics, always.",
        ),
        p(
          "<strong>It arrives at the wrong moment.</strong> The time, the days and the volume are all yours to set, on a dial from only-if-major to tell-me-everything.",
        ),
        button("Adjust my topics", topics),
        pMuted(
          `Or change when it arrives: <a href="${escapeHtml(delivery)}" style="color:#656565;">delivery settings</a>. If the honest answer is that you do not want it, unsubscribing below is a perfectly good outcome and we will not chase it.`,
        ),
      ].join("\n"),
    }),
    text: [
      greetText(name),
      "",
      `You have not visited nyuz in ${days} days. Free briefings pause automatically after 30 inactive days, so this is a good moment to tune them or keep them running.`,
      "",
      "The stories are not right. Topics too broad, or something you follow dragging in noise you did not want. Exclusions are the sharper tool here - they win over topics, always.",
      "",
      "It arrives at the wrong moment. The time, the days and the volume are all yours to set.",
      "",
      `Adjust my topics: ${topics}`,
      `Delivery settings: ${delivery}`,
      "",
      `If the honest answer is that you do not want it, unsubscribing is a perfectly good outcome and we will not chase it: ${unsubscribeUrl}`,
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 7. Daily briefing                                                       */
/* ---------------------------------------------------------------------- */

export type BriefingItem = {
  title: string;
  why: string;
  href: string;
  /** Half the Read column. Empty falls back to `why` so older callers still send a body. */
  grafs?: string[] | undefined;
};

function resolvedGrafs(item: { grafs?: string[] | undefined; why: string }): string[] {
  if (item.grafs && item.grafs.length > 0) return item.grafs;
  return item.why.trim() ? [item.why] : [];
}

function storyText(item: BriefingItem): string {
  const grafs = resolvedGrafs(item);
  const why = mailWhy(item.why, grafs);
  return [
    item.title,
    "",
    ...grafs,
    ...(why ? ["", `Why it matters: ${why}`] : []),
    "",
    `Read the full story: ${item.href}`,
  ].join("\n");
}

export function briefingEmail({
  baseUrl,
  scheduledFor,
  items,
  unsubscribeUrl,
}: Base & { scheduledFor: Date; items: BriefingItem[]; unsubscribeUrl: string }): Email {
  const date = formatEmailDate(scheduledFor);
  const href = `${baseUrl}/dashboard/briefing`;
  const quiet = items.length === 0;
  const count = items.length;
  const preheader = quiet
    ? "Nothing crossed the threshold you set."
    : (items[0]?.title ?? `${count} ${count === 1 ? "story" : "stories"}.`);

  const storyBlocks = items
    .map((item, i) => {
      const grafs = resolvedGrafs(item);
      return storyBrief({
        index: i,
        title: item.title,
        grafs,
        why: mailWhy(item.why, grafs),
        href: item.href,
        last: i === items.length - 1,
      });
    })
    .join("");

  const stories = quiet
    ? emptyState(
        p(
          "Nothing crossed the threshold you set. A quiet day is a real answer, not a failure, so this briefing is empty on purpose.",
        ),
      )
    : storyBlocks;

  const textStories = quiet
    ? "Nothing crossed the threshold you set. A quiet day is a real answer, not a failure, so this briefing is empty on purpose."
    : items.map(storyText).join("\n\n");

  return {
    subject: quiet ? `Your nyuz — a quiet ${date}` : `Your nyuz — ${date}`,
    html: layout({
      preheader,
      eyebrow: date,
      heading: quiet ? "A quiet day." : "Your briefing",
      baseUrl,
      unsubscribeUrl,
      disclaimer: true,
      body: [
        stories,
        quiet
          ? ""
          : [
              pMuted(
                "The rest of each piece — sources, the longer brief, and questions — is on nyuz.",
              ),
              button("Open the rest on nyuz", href),
            ].join("\n"),
      ].join("\n"),
    }),
    text: [
      textStories,
      "",
      ...(quiet ? [] : [`Open the rest on nyuz: ${href}`, ""]),
      `Stop these: ${unsubscribeUrl}`,
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 8. Breaking alert                                                       */
/* ---------------------------------------------------------------------- */

export function breakingEmail({
  baseUrl,
  title,
  why,
  href,
  grafs,
  unsubscribeUrl,
}: Base & {
  title: string;
  why: string;
  href: string;
  grafs?: string[] | undefined;
  unsubscribeUrl: string;
}): Email {
  const bodyGrafs = resolvedGrafs({ grafs, why });
  const aside = mailWhy(why, bodyGrafs);
  const preview = (bodyGrafs[0] ?? why).slice(0, 90);

  return {
    subject: title,
    html: layout({
      preheader: preview,
      eyebrow: "Breaking",
      heading: "Outside your schedule.",
      baseUrl,
      unsubscribeUrl,
      disclaimer: true,
      body: [
        storyBrief({ index: 0, title, grafs: bodyGrafs, why: aside, href, last: true }),
        pMuted("The full story, sources, and questions are on nyuz."),
        button("Open the rest on nyuz", href),
      ].join("\n"),
    }),
    text: [
      storyText({ title, why, href, grafs: bodyGrafs }),
      "",
      `Open the rest on nyuz: ${href}`,
      "",
      `Stop these: ${unsubscribeUrl}`,
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 8. Waitlist — joined                                                    */
/* ---------------------------------------------------------------------- */

/**
 * Sent when somebody leaves their address because nyuz was full.
 *
 * Promises a place in a queue and nothing else. No date, because the operator
 * does not know one, and a "soon" that turns into three months is worse than
 * saying plainly that it depends on people leaving.
 */
export function waitlistJoinedEmail({ name, baseUrl }: Base): Email {
  return {
    subject: "You're on the nyuz waitlist",
    html: layout({
      preheader: "We'll write the moment a place opens up.",
      eyebrow: "Waitlist",
      heading: "You're on the list.",
      baseUrl,
      body: [
        p(greet(name)),
        p(
          "nyuz is full at the moment. We keep the number of accounts deliberately small while the product is still finding its feet — it is easier to make something good for a few hundred people than for everybody at once.",
        ),
        p(
          "You are in the queue in the order you arrived. When a place opens we will email you, and that email will let you create your account.",
        ),
        pMuted(
          "We cannot promise a date, because it depends on people leaving rather than on a schedule. We will not email you about anything else in the meantime.",
        ),
      ].join("\n"),
    }),
    text: [
      greetText(name),
      "",
      "nyuz is full at the moment. We keep the number of accounts deliberately small while the product is still finding its feet - it is easier to make something good for a few hundred people than for everybody at once.",
      "",
      "You are in the queue in the order you arrived. When a place opens we will email you, and that email will let you create your account.",
      "",
      "We cannot promise a date, because it depends on people leaving rather than on a schedule. We will not email you about anything else in the meantime.",
      "",
      baseUrl,
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- */
/* 9. Waitlist — invited                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Sent when an operator opens a seat for this address.
 *
 * The link goes to /auth rather than to a magic token: the invitation is a row
 * in the database keyed on the address, and the signup trigger spends it when
 * an account is created with that email. Nothing here is a credential, so
 * forwarding this mail gives nobody else a seat.
 */
export function waitlistInvitedEmail({ name, baseUrl }: Base): Email {
  const href = `${baseUrl}/auth`;

  return {
    subject: "Your place at nyuz is ready",
    html: layout({
      preheader: "A place has opened up. Your account is ready to create.",
      eyebrow: "Waitlist",
      heading: "A place has opened up.",
      baseUrl,
      body: [
        p(greet(name)),
        p(
          "You asked to be told when nyuz had room. It does, and your place is held against this email address.",
        ),
        button("Create my account", href),
        p(
          "Sign up with this same address and you will be let straight in. Signing up with a different one will not work, because the place is held against this one.",
        ),
        pMuted(
          "If you have changed your mind, do nothing — the place goes to the next person on the list and you will not hear from us again.",
        ),
      ].join("\n"),
    }),
    text: [
      greetText(name),
      "",
      "You asked to be told when nyuz had room. It does, and your place is held against this email address.",
      "",
      `Create my account: ${href}`,
      "",
      "Sign up with this same address and you will be let straight in. Signing up with a different one will not work, because the place is held against this one.",
      "",
      "If you have changed your mind, do nothing - the place goes to the next person on the list and you will not hear from us again.",
    ].join("\n"),
  };
}
