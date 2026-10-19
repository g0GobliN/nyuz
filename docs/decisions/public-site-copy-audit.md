# The public site, read as a stranger (2026-10-19)

**Status: measured; the copy changes need a ruling.** A reader-facing audit of the marketing and legal
pages, taken the way the loop requires — opened and read as a stranger would, not inferred from the repo.
Provenance: the live origin `https://nyuz.grgvishal-gurung17.workers.dev`, every route in `sitemap.xml`
plus `/blog/why-i-built-nyuz`, fetched 2026-10-19 and read as rendered text. The five quotes below marked
**(verified personally)** were re-fetched and checked character by character before this file was written;
the rest are as reported by the reading pass and are marked as such.

## The defects, worst first

1. **Three pages give three answers about languages.** **(verified personally)**
   `/support`: *"Not yet. Briefings are delivered in English today, and translation is not part of this
   release — there is no language setting to choose from."* — `/legal/terms`: *"You can choose a reading
   language other than English."* — `/how-it-works`: *"Language preferences are stored, but new AI
   translations are not generated."* The binding document promises a control the support page says does
   not exist. A reader who asks support and then reads the terms has been told two different things by
   the same product.

2. **The privacy policy names China; the page it points at does not.** **(verified personally)**
   `/legal/privacy`: *"Some providers process data outside your country, including in the United States and
   China. The locations and the data involved are listed on the Service providers page."* The providers
   table lists every provider's region as **"Global"** and never names China. A privacy policy that names a
   jurisdiction and then points at a disclosure that omits it is the most alarming sentence on the site,
   and it is the one a stranger deciding whether to trust the service will read.

3. **Telegram reads as free on three pages and as paid on the pricing page.** **(verified personally for
   the pricing column)** `/pricing` lists *"Email + push + Telegram"* under Plura and Omni; `/` says
   *"Live sources · Email, Telegram or notifications"*; `/about` says *"Receive your personalized digest
   via email, Telegram, or browser notifications"*; `/legal/tokushoho` calls *"Telegram and browser
   notifications … optional extras"*. Nothing is marked coming-soon, and delivery today is push and the
   dashboard.

4. **A support instruction the free plan cannot follow.** **(reported)** `/support`: *"Go to Settings →
   Delivery in your dashboard to set when you want your briefing."* — `/pricing` lists *"Custom delivery
   time"* under Plura and Omni only.

5. **"Seats exist" against "one account per person".** **(reported)** `/legal/acceptable-use`: *"Share one
   account across a team. Seats exist; ask us about them."* — `/legal/terms`: *"One account per person"*,
   and no seat plan exists on `/pricing`.

6. **One page, two names.** **(verified personally)** The footer link says *"Subprocessors"*, the page's own
   title and heading say *"Service providers"*, and `/legal/privacy` uses both names in consecutive
   paragraphs. A reader chasing the disclosure the privacy policy points at cannot tell whether they are
   one page or two.

7. **A broken sentence in the pricing table.** **(verified personally)** `/pricing`: *"At least 2 months
   back on an annual plan."* — it reads as "two months ago", and nothing on the page explains it.

8. **The landing page promises more stories than the free plan allows.** **(reported)** `/`: *"Most mornings
   that's six stories."* — the Uno column caps at *"Up to 5 stories per briefing"*, and the page's own demo
   shows "4 things worth knowing".

9. **A three-stop volume control whose labels are not on one axis.** **(reported)** `/pricing`: *"How much
   noise do you want?"* with *"Focused" / "Minimal" / "Deep"* — none of the three means "more", and only
   the first carries a number.

10. **Brand case drifts inside one page.** **(reported)** `/` uses *"Nyuz doesn't stop at what happened"* and
    *"When thirty outlets cover the same thing, Nyuz brings them together"*; everywhere else, including the
    logo, it is lowercase **nyuz**.

11. **The operator's legal name carries a quoted handle.** **(reported)** *"Vishal \"goblin\" Gurung, trading
    as nyuz"* on the terms, privacy, commercial-disclosure and contact pages. It is how the operator is
    actually known, and it still reads oddly in a binding contract and a commercial disclosure.

**Clean:** `/blog`, `/blog/why-i-built-nyuz`, `/legal/security`, `/legal/cookies`, `/legal/refunds`,
`sitemap.xml`, `robots.txt` — no defects found. All 16 sitemap URLs returned 200, every in-site href
resolved, no `nyuz.app` links, and the plan numbers (5/15/25 stories, 1/5/12 alerts, 7/90/365-day history,
8/20 custom sources) agree across pricing, privacy, support and how-it-works.

## Ruled (#15, 2026-10-19) and applied

Put to the arbiter the same session with the quotes above; it ruled each item and drew the boundary itself.
Quoted in the parts that bind:

> 1. **Languages — change the pages, not the product.** […] remove the statement that users can choose a
> reading language other than English [from terms] […] remove or rewrite the statement that language
> preferences are stored [in how-it-works] […] Support: retain the current explanation. […] all public pages
> consistently state that briefings are delivered in English and that language selection and translation are
> not currently available.
> 2. **Telegram — change the pages to match the paid-plan boundary.** Telegram is a paid-plan feature, not a
> universally available free delivery channel. […] Do not remove Telegram from the product or expand it to
> the free plan just to reconcile marketing copy.
> 3. **Delivery time — change the support page.** [custom delivery time remains paid] […] a free user is not
> instructed to expect a custom delivery-time control that their plan does not provide.
> 4. **Seats — change the acceptable-use page.** No team-seat entitlement is promised at launch.
> 5. **Operator's name — change the legal copy.** Use the operator's proper name in binding and regulatory
> disclosures; omit the informal nickname.
> Verification requirement: after editing, revisit every route in sitemap.xml and test the resulting claims
> against the live product and plan matrix. Search for the contradictory phrases across the repository as
> well; fixing only the five cited locations is insufficient if the same promise appears elsewhere.

**What changed** (all copy; no predicate, plan or product behaviour touched):

| page | before | after |
| --- | --- | --- |
| terms, *The service* | "You can choose a reading language other than English…" | "Briefings are delivered in English. Language selection and translation are not currently available." |
| how-it-works FAQ | "Language preferences are stored, but new AI translations are not generated." | "Briefings are delivered in English, and there is no language setting yet." |
| privacy, *What we store* | "…your delivery schedule, channels and reading language…" | "…your delivery schedule and channels…" (sweep — the same promise in a second place) |
| privacy, *What the AI provider receives* | "Translations work the same way and are shared between readers of the same language." | "There is no translation step, so the summaries are shared exactly as written." (sweep) |
| providers table | "AI for grouping and summarising stories, translation, and answering questions you ask" | "…grouping and summarising stories, and for answering questions you ask" (sweep) |
| landing footnote | "Live sources · Email, Telegram or notifications" | "Live sources · Email, push, and Telegram on paid plans" |
| about, step 4 | "…via email, Telegram, or browser notifications — on your schedule." | "…by email and browser notifications — and, on paid plans, Telegram — on your schedule." |
| commercial disclosure, *Requirements* | "Telegram and browser notifications are optional extras." | "Browser notifications are available to every reader; Telegram delivery is included on paid plans." |
| support, delivery time | "Go to Settings → Delivery… You can choose a specific time…" | "On Plura and Omni, open Settings → Delivery… Uno briefings arrive on the default schedule." |
| acceptable use | "Share one account across a team. Seats exist; ask us about them." | "Share one account with anyone else. Accounts are per person; there is no team or seat plan." |
| `ENTITY.operator` | `Vishal "goblin" Gurung` | `Vishal Gurung` (used by all four pages that name the operator) |

**Not changed, deliberately:** the privacy claim about China, and the providers table it points at. The
ruling put that on its own footing — *"only after reading the actual provider configuration. Until then,
leave both the factual claim and the provider table unchanged. Do not reconcile them by guessing."* The
mechanical items (the two page names, "At least 2 months back", "six stories" against a five-story cap, the
noise-control labels, brand case) are ruled a **separate cleanup pass**, not bundled into these contractual
corrections.

## Why this went to a ruling rather than a patch

Every item is copy a reader reads, and several change what a reader is *promised* (languages, Telegram,
custom delivery time, seats, history). Changing them is a product decision — the one thing that must not
be done is to make the pages consistent with each other by choosing the version that is cheapest to
implement. Items 1, 3, 4 and 5 in particular have two honest resolutions each: change the page, or change
the promise to match what ships. That choice is the arbiter's, so the case goes to it with the quotes and
the four readings of what each item could mean.

**One item is not copy and is not in that request:** #2 is a factual claim about where data is processed.
It needs a reading of the actual provider configuration before any wording changes — a page cannot be
"fixed" to say something the configuration does not do.

## Ruled (#16) and applied: the provider table names DeepSeek and China

The configuration read the ruling asked for first, and what it found:

- the AI provider is **DeepSeek** (`DEEPSEEK_BASE_URL` defaults to `https://api.deepseek.com`,
  `src/lib/ai/config.ts`, `src/lib/ai/deepseek.ts`) — a China-based service, so the privacy sentence's
  "China" refers to it and the sentence itself is defensible; the **table** was the vague half;
- routing can also be set from the database (`ai provider routes` with `slug`, `base_url`, `api_key_env`),
  so the endpoint is configuration rather than a constant;
- **no reader data reaches it today:** `ai_usage_ledger` holds no rows in the last seven days and its
  newest row is 2026-10-01T06:24Z. The pipeline is deterministic and the AI paths are off.

Ruling, quoted in the parts that bind:

> **Ruling #16: Option 1 — name DeepSeek and China in the provider table.** […] The privacy policy names
> China, while the provider table leaves readers to infer which provider and location that refers to. […]
> **Current activity: Make no new claim about whether reader data is being sent.** The measured absence of
> recent ledger entries is relevant operational evidence, but it does not need to become a potentially
> stale legal disclosure. […] because database routing can change the provider and endpoint, do not present
> China as the exclusive processing location for every possible configuration. […] **Acceptance criteria:** A
> stranger reading both pages should be able to connect the privacy policy's reference to China with the
> named AI provider, without concluding that AI features are necessarily active today.

**Applied:** the row reads *"DeepSeek (the default AI provider)"* … region *"China for the default
configuration. Routing can be pointed at another provider, in which case the region follows that
provider."* The privacy sentence is unchanged, nothing new is claimed about today's traffic, and the
deterministic-product policy is untouched.

---

## The mechanical pass the ruling kept separate (2026-10-19)

Ruling #15 corrected the promise-level defects and deliberately left the cosmetic ones: *"I would keep
them as a separate cleanup pass rather than bundling them into these contractual decisions."* This is
that pass. Five items, each measured on the live pages before and after; every change makes the page
true rather than better-sounding, and none of them moves a price, a plan limit or a pipeline predicate.

**1. One page, two names.** The footer link said **Subprocessors**, the page it opens is headed
**Service providers**, and the privacy policy used both names one paragraph apart. The page's own title
is the anchor and "Service providers" is the plainer term, so every reference now reads **Service
providers** (`footer.tsx` link, the privacy paragraph, and the comment in the footer about what the
column is for). The URL slug `/legal/subprocessors` is unchanged — it is a link target, not a name a
reader is shown, and changing it would need a redirect for no reader benefit.

**2. A sentence that read as a date.** `/pricing` printed *"At least 2 months back on an annual plan."*
under the billing toggle. The number is not editorial: `annualCaption()` derives it from the plan data
(the least-saving paid plan's annual discount in months), and an e2e test pins that derivation. The
defect was the wording — a stranger reads "2 months back" as a time reference rather than money. It now
reads **"At least 2 months free on an annual plan."**, which is the repository's own language for the
same figure (`plans.ts`: *"Exactly two months free against twelve months of the monthly price"*), and
the derived number, the unit and the rounding are all unchanged. The test's locator moved with the
wording; the assertions on the number did not.

**3. A claim over the ceiling.** The landing page said *"Most mornings that's six stories."* while the
plan it is written for caps at **5** (`LAUNCH_PLANS.uno.storiesPerBriefing`) and the page's own demo
shows four. Now: *"Most mornings that's five stories or fewer. Some mornings it's one."*

**4. Three labels on two axes.** The density dial printed the current band's name in large type
("Focused", "Minimal", "Broad", "Deep" as the reader drags) while labelling only two of the four bands
under the track ("Minimal" … "Deep"), so the reader could not see where the band they were in began or
ended. The track now carries **one label per band, each over the part of the track that band owns**
(0-20, 20-45, 45-70, 70-100), taken from `LEVELS`, so the slider and the query cannot disagree about
what a label means — which is the reason the bands live in `@/lib/density` and not in the component.

**5. Brand case.** The landing page wrote the product as **Nyuz** in six places while the logo and every
other surface use lowercase **nyuz**. Corrected to the brand's own case.

**Verified:** `npx tsc --noEmit` clean; the two e2e tests that failed on this tree while it was being
edited pass on the settled tree (`the annual saving is stated in months and not invented`, `the
recovery path exists…`); the full gate ran on the final tree before the push.
