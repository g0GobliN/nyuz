import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { SiteNav } from "@/components/landing/nav";
import { SiteFooter } from "@/components/landing/footer";
import { getPublicSiteContent } from "@/lib/server/settings";

/**
 * The published policies.
 *
 * ────────────────────────────────────────────────────────────────────────
 * BEFORE LAUNCH: these are drafts, not vetted legal documents. They describe
 * what this system actually does — which is the hard part and the part a
 * template cannot give you — but they have not been reviewed by a lawyer.
 * ENTITY is filled for an unregistered operator in Japan; incorporate later
 * and this block has to change.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Kept in the bundle rather than in `site_settings` on purpose. Policy text is
 * a legal commitment with a change history; editing it from a console with no
 * versioning, no diff and no approval step is the wrong tool. The console can
 * change the marketing copy; changing the terms should require a deploy and
 * therefore a code review.
 */

/**
 * Operator identity. Not a registered company — a sole trader trading as nyuz.
 * Address is city + postcode only; no building.
 */
const ENTITY = {
  name: "nyuz",
  operator: 'Vishal "goblin" Gurung',
  address: "Matsudo, Chiba, 〒270-0004, Japan",
  jurisdiction: "Japan",
  mail: {
    contact: "contact@nyuz.app",
    privacy: "privacy@nyuz.app",
    security: "security@nyuz.app",
    billing: "billing@nyuz.app",
  },
} as const;

type Section = {
  h: string;
  p: string[];
  list?: string[];
  table?: { head: string[]; rows: string[][] };
};

type Doc = {
  title: string;
  updated: string;
  intro: string;
  /** Shown in the sidebar grouping. */
  group: "Policies" | "Trust" | "Company";
  sections: Section[];
};

const UPDATED = "25 August 2026";

/**
 * The V2 revision date, carried only by the documents V2 actually changed.
 *
 * Sharing one constant across all nine would re-date the refunds policy and the
 * cookie policy because the privacy policy changed, and "last updated" on a
 * legal document is a claim about that document. A reader comparing against a
 * copy they saved should find a new date only where the text is new.
 *
 * Changed on 30 August 2026: privacy, subprocessors, terms, acceptable use and
 * security, all for the same underlying change — the per-reader paragraph that
 * used to be generated for every story is gone, so less is sent to the model
 * provider than these documents previously described, and readers can now
 * submit sources of their own for us to fetch.
 *
 * Two rules for the customer-visible text below, learned the hard way.
 *
 * Do not narrate what these documents used to say. A privacy policy states what
 * happens now; a paragraph explaining that an earlier version disclosed more is
 * an invitation to argue about the earlier version, and it helps nobody reading
 * to decide whether to sign up.
 *
 * Do not publish the mechanism behind a security control. Saying submitted
 * addresses are checked is a commitment we can keep. Listing which address
 * ranges are refused and at which point in a redirect chain is both a map for
 * somebody probing it and a specific promise to be held to the day an edge case
 * turns out to behave differently. Describe the protection, not the
 * implementation.
 */
const UPDATED_V2 = "31 August 2026";

const DOCS: Record<string, Doc> = {
  privacy: {
    title: "Privacy",
    updated: UPDATED_V2,
    group: "Trust",
    intro:
      "We hold as little as the product needs, and making your briefing does not involve sending your interests or your identity to an AI provider.",
    sections: [
      {
        h: "Who we are",
        p: [
          `${ENTITY.operator}, trading as ${ENTITY.name}, of ${ENTITY.address}, is the controller of the personal data described here. For anything in this policy, write to ${ENTITY.mail.privacy}.`,
        ],
      },
      {
        h: "What we store",
        p: [
          "Your account email, the topics and exclusions you configure, your delivery schedule, channels and reading language, and the feedback signals you give on individual stories.",
          "We store which briefings were generated and delivered so you can read your history and so we can retry failed deliveries.",
          "We record the time of your most recent visit. It distinguishes active from dormant accounts; Free briefings pause after 30 inactive days and resume when you return.",
          "If you add a source of your own, we store the address of the feed and the fact that you follow it. Feeds are shared: if another reader adds the same one, you both follow the same feed. We do not publish who follows what.",
          "If you enable Telegram or browser push, we store the delivery identifier needed to reach that account or browser. For paid plans, Stripe gives us billing identifiers and subscription status; nyuz does not receive your full card number.",
        ],
      },
      {
        h: "What the AI provider receives",
        p: [
          "Deciding which stories belong in your briefing happens on our own systems, using what you have told us you care about. Your interests are not sent anywhere in order to do it.",
          "The stories themselves are read and summarised once, from the published reporting, before anyone is matched to them. Nothing about you goes into that, and your briefing is put together from those summaries on our side. Translations work the same way and are shared between readers of the same language.",
          "The exception is when you ask a question about a story. To answer it, DeepSeek receives that story and the question you typed. It does not receive your name, your email address, your topic list, your exclusions, your history or the reason that story matched you. DeepSeek processes this material in China, so do not put personal or confidential information in a question.",
        ],
      },
      {
        h: "Why we are allowed to hold it",
        p: [
          "To perform our contract with you: your account, your interests, your schedule and your delivery history. Without these there is no product.",
          "Our legitimate interest in a working service: security logs, failure counts and aggregate volume figures, held in the smallest form that answers the question.",
          "Your consent, where you have given it, for optional delivery channels. Telegram sends once you connect it in Delivery. Browser notifications send one notice per story if you enable them; dismissing a notice does not delete the story. Other services may be added later. You can withdraw any of these in Delivery settings.",
        ],
      },
      {
        h: "How long we keep it",
        p: [
          "Briefing history follows your plan's retention window — 7 days on Free, 90 days on Personal, one year on Pro. Older items are deleted, not archived.",
          "Feedback signals are kept while your account is open, because they are what stops us sending you the same irrelevant story twice. You can clear them at any time from Settings, which resets personalisation to your stated topics alone.",
          "Our delivery records expire with the briefing history for your plan. Email providers may keep separate delivery, bounce and complaint metadata under their own retention policies.",
        ],
      },
      {
        h: "Your rights",
        p: [
          `You can ask us for a copy of your data, ask us to correct it, ask us to delete it, or ask us to stop processing it. Settings lets you export your account data and clear feedback. For anything else, write to ${ENTITY.mail.privacy}; we will verify the request and respond within 30 days.`,
        ],
        list: [
          "Access — a copy of everything we hold about you.",
          "Correction — fix anything inaccurate.",
          "Deletion — remove your account and its data.",
          "Portability — your topics and history in a machine-readable file.",
          "Objection — tell us to stop processing on legitimate-interest grounds.",
          "Complaint — raise it with your local data protection authority.",
        ],
      },
      {
        h: "Deletion",
        p: [
          "An account-deletion request removes your profile, topics, feedback signals and delivery history after we verify the request and deal with any active subscription or legal retention duty. Aggregated, non-identifying counts about pipeline volume remain because they cannot identify you.",
          "We complete verified deletion requests within 30 days. Copies may remain temporarily in provider backups until those backups rotate, and are not restored except for disaster recovery.",
        ],
      },
      {
        h: "Where your data goes",
        p: [
          "We use a small number of processors to run the service. Each one, what it does and where it holds data, is listed on the Subprocessors page.",
          "Some providers process data outside your country, including in the United States and China. The locations and the data involved are listed on the Service providers page. We use contractual and other transfer safeguards where applicable law requires them; do not use Ask AI for personal or confidential information.",
        ],
      },
      {
        h: "Children",
        p: [
          "nyuz is not intended for anyone under 16, and we do not knowingly hold data about children. If you believe a child has created an account, tell us and we will delete it.",
        ],
      },
      {
        h: "Changes",
        p: [
          "If we change this policy in a way that affects what we do with your data, we will email you before it takes effect rather than relying on you to notice a new date at the top of this page.",
        ],
      },
    ],
  },

  terms: {
    title: "Terms",
    updated: UPDATED_V2,
    group: "Policies",
    intro:
      "We watch public sources and send you a summary of what changed. These terms are the agreement for that, under Japanese law.",
    sections: [
      {
        h: "The agreement",
        p: [
          `These terms are between you and ${ENTITY.operator}, trading as ${ENTITY.name}. Using nyuz means accepting them. They are governed by the laws of ${ENTITY.jurisdiction}.`,
        ],
      },
      {
        h: "The service",
        p: [
          "nyuz collects publicly available reporting, groups articles describing the same event, and sends you a briefing on the schedule you choose, selected for you from what it has covered.",
          "Story summaries are written once and shared by everyone who receives that story. What is personal to you is the selection: which stories reach you, in what order, and at what threshold.",
          "On a paid plan you can ask us to watch sources of your own, up to the number your plan includes. Feeds are shared between readers who follow the same one. We may decline a source, or stop using it, if it cannot be reached, does not work as a feed, or should not be fetched.",
          "You can choose a reading language other than English. English is the language nyuz works in, and other languages are translations of it, which may be delayed or unavailable.",
          "Availability targets are best-effort. Refunds for a missed or delayed briefing follow the Refunds policy.",
          "A quiet day is a working day. If nothing clears your threshold, you get a short briefing or none — that is the product behaving correctly, not an outage.",
          "Free briefings pause after 30 days without a visit so unused accounts do not keep generating work. We warn you first, preserve your settings, and resume automatically when you return.",
        ],
      },
      {
        h: "Your account",
        p: [
          "One account per person. You are responsible for what happens under yours, and for keeping your sign-in details to yourself.",
          "You must be old enough to enter a contract where you live, and at least 16.",
        ],
      },
      {
        h: "Accuracy",
        p: [
          "Summaries are generated by language models and can be wrong, incomplete or out of date. Every story links to the sources it was built from.",
          "Do not treat a briefing as verified fact. Check the original reporting before acting on anything consequential — financial, legal, medical or otherwise. nyuz is a way of noticing things, not a source of record.",
        ],
      },
      {
        h: "Content and attribution",
        p: [
          "We store metadata and short summaries, and we link to original publications. We do not reproduce articles wholesale, and nyuz is never presented as the origin of a story.",
          "Publishers who want a source removed, an attribution corrected or a feed prioritised can contact us and we will act on it.",
          "You may read, quote and share your briefings. You may not resell them, or scrape the service to build a competing product.",
        ],
      },
      {
        h: "Acceptable use",
        p: [
          "There is a short list of things that will get an account suspended, and it is on the Acceptable use page. The summary: do not attack the service, do not use it to harass anyone, and do not resell it.",
        ],
      },
      {
        h: "Billing",
        p: [
          "Paid plans renew until cancelled. Cancelling stops the next renewal and keeps access until the end of the current period. Topic, briefing, source-priority, custom-source, alert, Ask AI and history limits follow your active plan.",
          "The limit on sources of your own is checked when you add one. Moving to a plan with a lower limit does not remove sources you already follow, but you will not be able to add another until you are inside the new limit.",
          "Prices can change. If yours does, we will tell you before the renewal it applies to, and you can cancel before being charged the new amount.",
          "Refunds are covered on the Refunds page.",
        ],
      },
      {
        h: "Suspension and termination",
        p: [
          "We may suspend an account that breaks the acceptable use policy, threatens the service, or is being used to send abuse. Where it is safe and lawful to do so, we will tell you why and give you a chance to fix it.",
          "You can request account closure at any time from Settings. We will cancel any active subscription and apply the Refunds policy before deleting the account.",
        ],
      },
      {
        h: "Liability",
        p: [
          "To the extent the law allows, our total liability to you is limited to what you paid us in the twelve months before the claim. We are not liable for decisions taken on the basis of a summary — which is why the sources are always one tap away.",
          "Nothing here limits liability for death, personal injury, or fraud.",
        ],
      },
      {
        h: "Changes to these terms",
        p: [
          "We will email you before a material change takes effect. Continuing to use nyuz after that date means accepting the new terms; if you would rather not, close your account and we will refund unused paid time.",
        ],
      },
    ],
  },

  "acceptable-use": {
    title: "Acceptable use",
    updated: UPDATED_V2,
    group: "Policies",
    intro:
      "A short list, because a long one is a list nobody reads. These are the things that will get an account suspended.",
    sections: [
      {
        h: "Do not",
        p: [],
        list: [
          "Attack the service — scraping at volume, probing for vulnerabilities without permission, or trying to exhaust our capacity.",
          "Resell briefings, or use nyuz to build a competing summarisation product.",
          "Share one account across a team. Seats exist; ask us about them.",
          "Use delivery channels to send anything to anyone other than yourself.",
          "Configure topics or instructions designed to make the service generate harassment, or content targeting a private individual.",
          "Circumvent plan limits, whether by automation or by holding multiple free accounts.",
          "Submit a source in order to make us fetch something you could not or should not fetch yourself, such as an address on a private or internal network.",
          "Submit a source to point us at somebody else's service as a way of putting load on it, or at material you have no right to have collected.",
        ],
      },
      {
        h: "About sources you add",
        p: [
          "A feed you add is fetched by us, on a schedule. We check an address before we start using it, and we may refuse one or stop using it at any time.",
          "Please do not use that feature to probe what we will and will not fetch. If you want to test our security, do it the way described below and you are welcome to.",
        ],
      },
      {
        h: "Security research",
        p: [
          "Testing our security is welcome if you tell us first and give us a reasonable window to fix what you find. The Security page says how to reach us. Research conducted that way is never a violation of this policy.",
        ],
      },
      {
        h: "What happens if you break it",
        p: [
          "In most cases we will contact you and ask you to stop. For anything that threatens the service or another person, we will suspend the account first and explain afterwards.",
          "Suspension for cause does not earn a refund of the current period.",
        ],
      },
    ],
  },

  refunds: {
    title: "Refunds",
    updated: UPDATED,
    group: "Policies",
    intro:
      "A briefing product is easy to evaluate before paying, so the free plan is the trial. When a refund is right, we would rather give it than argue.",
    sections: [
      {
        h: "Within 14 days",
        p: [
          "A full refund on request for any reason, on your first paid period. No questions, no form — write to us and it is done.",
        ],
      },
      {
        h: "After 14 days",
        p: [
          "Cancelling stops the next renewal and keeps your access until the period you have already paid for ends. We do not pro-rate a mid-period cancellation by default.",
          "If the service failed you — briefings that did not arrive, a fault we did not fix — tell us and we will refund the affected time. That is a judgement call and we will make it in your favour.",
        ],
      },
      {
        h: "Annual plans",
        p: [
          "The same 14-day window applies. After it, cancelling an annual plan refunds the unused whole months, minus any discount you received for paying annually.",
        ],
      },
      {
        h: "If we close your account",
        p: [
          "If we suspend an account for breaking the acceptable use policy, the current period is not refunded. If we close it for any other reason — including discontinuing the service — we refund unused time in full.",
        ],
      },
      {
        h: "How to ask",
        p: [
          `Write to ${ENTITY.mail.billing} from the address on the account. Refunds are processed to the original payment method and take up to ten working days to appear.`,
        ],
      },
    ],
  },

  subprocessors: {
    title: "Service providers",
    updated: UPDATED_V2,
    group: "Trust",
    intro:
      "The third parties that operate nyuz, what they receive, and where they process it. Optional services apply only when you choose them.",
    sections: [
      {
        h: "Current providers",
        p: [],
        table: {
          head: ["Provider", "What it does", "Data it sees", "Region"],
          rows: [
            [
              "Supabase",
              "Database, authentication and storage",
              "Account email, topics, schedule, briefing history",
              "The Supabase project region selected by nyuz; provider support may be global",
            ],
            [
              "Cloudflare",
              "Application hosting and the ingestion pipeline",
              "Requests, IP address and operational metadata",
              "Global edge",
            ],
            [
              "DeepSeek",
              "AI for grouping and summarising stories, translation, and answering questions you ask",
              "Published article text. When you ask a question: that story and your question. No name, email or account details.",
              "People's Republic of China",
            ],
            [
              "Resend",
              "Briefing delivery",
              "Your email address and the briefing being sent",
              "United States",
            ],
            [
              "Stripe",
              "Payments and subscription management",
              "Account email, plan, billing identifiers and payment details you give Stripe",
              "Global; primarily United States",
            ],
            [
              "Google or GitHub",
              "Optional account sign-in",
              "The identity and email address you authorize that provider to share",
              "Global",
            ],
            [
              "Google Fonts",
              "Website typefaces",
              "IP address, browser and request metadata when a page loads",
              "Global",
            ],
            [
              "Telegram",
              "Optional briefing delivery",
              "Your Telegram chat id and the briefing being sent",
              "Global",
            ],
            [
              "Browser push services",
              "Optional per-story notifications",
              "Story title, a short line, and a link to the story",
              "Your browser vendor",
            ],
          ],
        },
      },
      {
        h: "What the model provider does not receive",
        p: [
          "Choosing what belongs in your briefing, and putting it together, both happen on our own systems. Making a briefing does not involve sending anything about you to our AI provider.",
          "The only time anything of yours reaches it is a question you type about a specific story. It receives that story and the question, and not your email, name, topic list, exclusions or history.",
        ],
      },
      {
        h: "Changing this list",
        p: [
          "We will publish changes here before a new provider starts handling account data. Where a material change affects how your personal data is used, we will also email you in advance.",
        ],
      },
    ],
  },

  security: {
    title: "Security",
    updated: UPDATED_V2,
    group: "Trust",
    intro:
      "How the service is built so one account cannot read another, and how to tell us when that is no longer true.",
    sections: [
      {
        h: "How access is controlled",
        p: [
          "Every table holding customer data enforces row-level security against direct browser access. Server functions separately verify the signed-in session and scope each query to that account before using privileged database access.",
          "Content that everyone sees — stories, their summaries, the source list — is read-only to customer accounts. Changing what other people are shown is not something an account is able to do.",
          "Administrative access is role-based, held by named individuals, and every action taken in the operator console is written to an append-only audit log.",
        ],
      },
      {
        h: "Plan limits",
        p: [
          "Limits that cost us something — how many sources you can add, how many questions you can ask in a day — are enforced in the database rather than only in the app, so that sending several requests at once does not get around them.",
        ],
      },
      {
        h: "Addresses you submit",
        p: [
          "A feed you submit gets particular attention, because it is the one place where something a customer types becomes a request our own systems make. We check the address before using it, check again if it redirects elsewhere, and limit how much we will download from it. Addresses pointing into private or internal networks are refused.",
        ],
      },
      {
        h: "Secrets",
        p: [
          "API keys and service credentials are held as deployment secrets, never in the database and never in the code. The configuration that says which AI provider we use records the name of the secret, not its value.",
        ],
      },
      {
        h: "In transit and at rest",
        p: [
          "Production traffic uses TLS. Our database and hosting providers encrypt stored customer data, and privileged access is restricted.",
        ],
      },
      {
        h: "Reporting a vulnerability",
        p: [
          `Write to ${ENTITY.mail.security} with enough detail to reproduce it. Please give us a reasonable window before disclosing publicly.`,
          "We will confirm receipt within two working days, keep you updated through the fix, and credit you when it ships if you would like us to. We will not pursue anyone who reports in good faith and does not access or destroy other people's data.",
        ],
      },
      {
        h: "If something goes wrong",
        p: [
          "If a breach affects your data, we will investigate, contain it, notify Japan's Personal Information Protection Commission and affected people when applicable law requires it, and provide updates as reliable information becomes available.",
        ],
      },
    ],
  },

  cookies: {
    title: "Cookie policy",
    updated: UPDATED_V2,
    group: "Policies",
    intro:
      "No advertising cookies and no cross-site tracking. Essential account state stays in your browser.",
    sections: [
      {
        h: "Authentication",
        p: [
          "Supabase stores your signed-in session in browser local storage. The browser sends that token only when nyuz asks Supabase or a nyuz server function for your account data. Signing out removes the local session.",
        ],
      },
      {
        h: "Preferences",
        p: [
          "Local storage also holds your colour theme and a cached copy of your preferences so a refresh is immediate. Signed-in preference changes are also saved to your account; the local copy is not sent to advertising or analytics services.",
        ],
      },
      {
        h: "What we skip",
        p: [
          "We do not add advertising cookies, cross-site trackers or advertising pixels. Our delivery provider processes delivery, bounce and complaint metadata needed to operate email.",
          "Because nyuz does not set non-essential cookies, it does not show a cookie-consent banner. If that changes, this policy and the interface must change first.",
        ],
      },
      {
        h: "Controlling them",
        p: [
          "You can clear site data in your browser at any time. Clearing authentication storage signs you out; clearing preferences restores local defaults until the account copy loads again.",
        ],
      },
    ],
  },

  tokushoho: {
    title: "Commercial disclosure",
    updated: UPDATED_V2,
    group: "Company",
    intro:
      "The disclosure Japanese law requires from anyone selling online. Who is charging you, what for, and how to stop.",
    sections: [
      {
        h: "特定商取引法に基づく表記",
        p: [
          "This page is the notice required by Article 11 of Japan's Act on Specified Commercial Transactions. It applies because nyuz is operated from Japan and sells subscriptions to consumers.",
        ],
        table: {
          head: ["Item", "Detail"],
          rows: [
            [
              "販売業者 — Seller",
              `${ENTITY.operator}, trading as ${ENTITY.name}. A sole trader, not a registered company.`,
            ],
            ["運営統括責任者 — Operator", ENTITY.operator],
            [
              "所在地 — Address",
              "Not published here. Disclosed without delay on request — see below.",
            ],
            [
              "電話番号 — Telephone",
              "Not published here. Disclosed without delay on request — see below.",
            ],
            ["メールアドレス — Email", ENTITY.mail.contact],
            [
              "販売価格 — Price",
              "Free: US$0. Personal: US$14.99 per month or US$149.90 per year. Pro: US$29.99 per month or US$299.90 per year. Current prices are always on the Pricing page.",
            ],
            [
              "商品代金以外の必要料金 — Additional charges",
              "None from us. Prices are in US dollars, so your bank or card issuer may add its own currency conversion fee.",
            ],
            [
              "支払方法 — Payment method",
              "Credit and debit card, processed by Stripe. We never see or store your card number.",
            ],
            [
              "支払時期 — Payment timing",
              "Charged when you subscribe, then at the start of each renewal period until you cancel.",
            ],
            [
              "役務の提供時期 — Service start",
              "Immediately on payment. Your first briefing follows the delivery schedule you set.",
            ],
            [
              "返品・キャンセル — Cancellation",
              "Cancel any time from Settings. Refund terms are on the Refunds page.",
            ],
            [
              "動作環境 — Requirements",
              "A current web browser and a working email address. Telegram and browser notifications are optional extras.",
            ],
          ],
        },
      },
      {
        h: "Address and telephone",
        p: [
          `nyuz is one person with no business premises, so neither is printed above. The law permits that on condition the operator hands them over promptly when asked, and we will: write to ${ENTITY.mail.contact} and you will have both without delay and without needing to give a reason.`,
        ],
      },
      {
        h: "Cancelling and refunds",
        p: [
          "Cancelling stops the next renewal and keeps your access until the period you have already paid for ends. There is nothing to return and no cancellation fee.",
          "A full refund is available on request within 14 days of your first paid period, and beyond that where the service failed you. The Refunds page has the detail.",
        ],
      },
    ],
  },

  contact: {
    title: "Contact",
    updated: UPDATED,
    group: "Company",
    intro: "One operator. Four mailboxes. A reply, not a ticket queue.",
    sections: [
      {
        h: "Support",
        p: [
          `For anything about your account or delivery, write to ${ENTITY.mail.contact}. For billing, write to ${ENTITY.mail.billing}.`,
          `If you cannot sign in, write to ${ENTITY.mail.contact} from the address on the account.`,
        ],
      },
      {
        h: "Publishers and sources",
        p: [
          `If you publish a source we monitor and want your attribution changed, your content excluded, or your feed prioritised, write to ${ENTITY.mail.contact} and we will action it.`,
        ],
      },
      {
        h: "Privacy requests",
        p: [
          `Access, correction, deletion and portability requests go to ${ENTITY.mail.privacy} and are answered within 30 days. Settings can export your account data and clear feedback immediately.`,
        ],
      },
      {
        h: "Security",
        p: [
          `Report a vulnerability privately to ${ENTITY.mail.security} before disclosing it. The Security page has the detail.`,
        ],
      },
      {
        h: "Operator details",
        p: [
          `${ENTITY.name} is operated by ${ENTITY.operator} as a sole trader, not a registered company. Correspondence: ${ENTITY.address}. Write to ${ENTITY.mail.contact}. Governed by the laws of ${ENTITY.jurisdiction}.`,
        ],
      },
    ],
  },
};

/** Sidebar grouping order. */
const GROUPS = ["Policies", "Trust", "Company"] as const;

export const Route = createFileRoute("/legal/$doc")({
  // Two things at once: the document, which decides whether this is a 404, and the
  // site chrome. `getPublicSiteContent` never throws, so `notFound()` is still the
  // only way out of here — the content fetch cannot mask a bad slug.
  loader: async ({ params }) => {
    const doc = DOCS[params.doc];
    if (!doc) throw notFound();
    const content = await getPublicSiteContent();
    return { doc, content };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.doc.title} — nyuz` : "nyuz" }],
  }),
  component: LegalDoc,
});

function LegalDoc() {
  const { doc, content } = Route.useLoaderData();
  const current = Route.useParams().doc;

  return (
    <div className="min-h-screen bg-background">
      <SiteNav content={content} />
      <main className="px-5 pb-24 pt-32 sm:px-8">
        <div className="mx-auto grid w-full max-w-5xl gap-14 md:grid-cols-[180px_1fr]">
          <nav className="md:sticky md:top-28 md:self-start">
            {/* Grouped rather than one flat run: there are nine documents now,
                and "Refunds" sitting between "Privacy" and "Security" tells a
                reader nothing about which of them answers their question. */}
            {GROUPS.map((group) => {
              const docs = Object.entries(DOCS).filter(([, d]) => d.group === group);
              if (docs.length === 0) return null;

              return (
                <div key={group} className="mb-7 last:mb-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {group}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 md:flex-col md:gap-2">
                    {docs.map(([slug, d]) => (
                      <Link
                        key={slug}
                        to="/legal/$doc"
                        params={{ doc: slug }}
                        className={
                          "text-[13.5px] transition-colors " +
                          (slug === current
                            ? "text-foreground"
                            : "text-muted-foreground hover:text-foreground")
                        }
                      >
                        {d.title}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <article className="animate-rise">
            <h1 className="display text-4xl sm:text-5xl">{doc.title}</h1>
            <p className="mt-3 text-[12.5px] text-muted-foreground">Last updated {doc.updated}</p>
            <p className="mt-7 max-w-xl font-serif text-xl leading-relaxed">{doc.intro}</p>

            <div className="mt-12 space-y-10">
              {doc.sections.map((s) => (
                <section key={s.h}>
                  <h2 className="text-[17px] font-medium tracking-tight">{s.h}</h2>
                  <div className="mt-3 space-y-3">
                    {s.p.map((p) => (
                      <p
                        key={p}
                        className="max-w-xl text-[14.5px] leading-relaxed text-muted-foreground"
                      >
                        {p}
                      </p>
                    ))}
                  </div>

                  {s.list ? (
                    <ul className="mt-4 max-w-xl space-y-2">
                      {s.list.map((item) => (
                        <li
                          key={item}
                          className="relative pl-5 text-[14.5px] leading-relaxed text-muted-foreground"
                        >
                          <span className="absolute left-0 top-[0.65em] h-[5px] w-[5px] rounded-full bg-signal" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* The subprocessor table is the one place a policy needs
                      columns. It scrolls inside its own box rather than
                      widening the page on a phone. */}
                  {s.table ? (
                    <div className="mt-5 overflow-x-auto rounded-2xl border border-hairline">
                      <table className="w-full min-w-[34rem] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-hairline bg-surface-2">
                            {s.table.head.map((h) => (
                              <th
                                key={h}
                                className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {s.table.rows.map((row) => (
                            <tr
                              key={row.join("|")}
                              className="border-b border-hairline last:border-0"
                            >
                              {row.map((cell, i) => (
                                <td
                                  key={i}
                                  className={
                                    "px-4 py-3.5 align-top text-[13px] leading-relaxed " +
                                    (i === 0 ? "font-medium" : "text-muted-foreground")
                                  }
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>
      <SiteFooter content={content} />
    </div>
  );
}
