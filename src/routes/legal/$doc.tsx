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

const DOCS: Record<string, Doc> = {
  privacy: {
    title: "Privacy",
    updated: UPDATED,
    group: "Trust",
    intro:
      "We hold as little as the product needs, and we never send your interest list to a model.",
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
          "Your account email, the topics and exclusions you configure, your delivery schedule and channels, and the feedback signals you give on individual stories.",
          "We store which briefings were generated and delivered so you can read your history and so we can retry failed deliveries.",
          "We record the time of your most recent visit. It distinguishes active from dormant accounts; Free briefings pause after 30 inactive days and resume when you return.",
        ],
      },
      {
        h: "What we never send to a third party",
        p: [
          "Your interest profile is matched against stories inside our own database. That matching is a database query, not a model call.",
          "When a personalised paragraph is written, the model receives your followed topic labels, the selected stories and any custom briefing instruction you supplied. It never receives your identity or email.",
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
          "Delivery logs are kept for 30 days so that a bounce can be diagnosed and retried, then deleted.",
        ],
      },
      {
        h: "Your rights",
        p: [
          `You can ask us for a copy of your data, ask us to correct it, ask us to delete it, or ask us to stop processing it. Most of these you can do yourself from Settings; for the rest, write to ${ENTITY.mail.privacy} and we will respond within 30 days.`,
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
          "Deleting your account removes your profile, topics, feedback signals and delivery history. Aggregated, non-identifying counts about pipeline volume remain, because they contain nothing that could identify you.",
          "Deletion is immediate in the application and completes in backups within 30 days.",
        ],
      },
      {
        h: "Where your data goes",
        p: [
          "We use a small number of processors to run the service. Each one, what it does and where it holds data, is listed on the Subprocessors page.",
          "Some of them operate outside your country. Where that happens, transfers rely on the standard contractual clauses in our agreements with them.",
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
    updated: UPDATED,
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
          "nyuz collects publicly available reporting, groups articles describing the same event, and delivers a personalised summary on the schedule you choose.",
          "Availability targets are best-effort. A missed or delayed briefing is not grounds for compensation beyond a pro-rata refund of paid time.",
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
          "Paid plans renew until cancelled. Cancelling stops the next renewal and keeps access until the end of the current period. Topic, briefing, source-priority, alert, Ask AI and history limits follow your active plan.",
          "Prices can change. If yours does, we will tell you before the renewal it applies to, and you can cancel before being charged the new amount.",
          "Refunds are covered on the Refunds page.",
        ],
      },
      {
        h: "Suspension and termination",
        p: [
          "We may suspend an account that breaks the acceptable use policy, threatens the service, or is being used to send abuse. Where it is safe and lawful to do so, we will tell you why and give you a chance to fix it.",
          "You can close your account at any time from Settings. We will refund unused paid time on a pro-rata basis.",
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
    updated: UPDATED,
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
    title: "Subprocessors",
    updated: UPDATED,
    group: "Trust",
    intro:
      "Every third party that touches your data, what it does, and where. This list is short by design, and changing it is a change we tell you about.",
    sections: [
      {
        h: "Current subprocessors",
        p: [],
        table: {
          head: ["Provider", "What it does", "Data it sees", "Region"],
          rows: [
            [
              "Supabase",
              "Database, authentication and storage",
              "Account email, topics, schedule, briefing history",
              "[Region]",
            ],
            [
              "Cloudflare",
              "Application hosting and the ingestion pipeline",
              "Requests in transit; no stored account data",
              "Global edge",
            ],
            [
              "DeepSeek",
              "Language model for clustering, scoring and the personal paragraph",
              "Article text, and the story a paragraph is being written about. No account identifiers.",
              "[Region]",
            ],
            [
              "[Email provider]",
              "Briefing delivery",
              "Your email address and the briefing being sent",
              "[Region]",
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
          "Matching happens in our database. For personalised writing, the model provider receives your followed topic labels and any custom briefing instruction, but not your email, identity, exclusions or history.",
          "The per-person paragraph is generated from the selected story and those preferences, not from anything that identifies you.",
        ],
      },
      {
        h: "Changing this list",
        p: [
          "We will publish a change here and email account holders at least 30 days before a new subprocessor starts handling personal data, so that anyone who objects has time to close their account first.",
        ],
      },
    ],
  },

  security: {
    title: "Security",
    updated: UPDATED,
    group: "Trust",
    intro:
      "How the service is built so one account cannot read another, and how to tell us when that is no longer true.",
    sections: [
      {
        h: "How access is controlled",
        p: [
          "Every table holding customer data enforces row-level security in the database itself, so a query can only ever return the rows belonging to the account that asked. This is enforced below the application, not by it — an application bug cannot hand you somebody else's briefing.",
          "Administrative access is role-based, held by named individuals, and every action taken in the operator console is written to an append-only audit log.",
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
          "All traffic is TLS. Data at rest is encrypted by our database and hosting providers. Backups are encrypted and access to them is logged.",
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
          "If a breach affects your data, we will tell you what happened, what was exposed and what we have done about it — within 72 hours of establishing it, and without waiting for the investigation to finish.",
        ],
      },
    ],
  },

  cookies: {
    title: "Cookie policy",
    updated: UPDATED,
    group: "Policies",
    intro: "A session cookie to stay signed in. Nothing that follows you off this site.",
    sections: [
      {
        h: "Essential",
        p: [
          "A session cookie keeps you signed in. Without it, the dashboard cannot tell who you are. It expires when your session does.",
        ],
      },
      {
        h: "Preferences",
        p: [
          "Local storage holds your colour theme and your unsaved onboarding progress so a refresh does not lose your work. This never leaves your browser and is not readable by us.",
        ],
      },
      {
        h: "What we skip",
        p: [
          "No advertising cookies, no cross-site trackers, no analytics that follow you off this site, and no third-party pixels in your briefing emails beyond the delivery receipt needed to retry failures.",
          "Because we set nothing that is not essential or set by you, there is no consent banner. That is the point.",
        ],
      },
      {
        h: "Controlling them",
        p: [
          "Your browser can clear or block all of these. Blocking the session cookie will sign you out and keep you out; everything else degrades to a default.",
        ],
      },
    ],
  },

  tokushoho: {
    title: "Commercial disclosure",
    updated: UPDATED,
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
              "Free: US$0. Personal: US$7.00 per month or US$69.00 per year. Pro: US$15.00 per month or US$149.00 per year. Current prices are always on the Pricing page.",
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
          "For anything about your account, delivery or billing, reach us from the Settings page in your dashboard so we can see your configuration alongside your message.",
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
          `Access, correction, deletion and portability requests go to ${ENTITY.mail.privacy} and are answered within 30 days. Most of them you can complete yourself in Settings, faster.`,
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
