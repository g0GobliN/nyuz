# The origin every reader-facing link points at does not resolve (2026-10-12, blocked — owner-side)

**Found by doing the thing `AGENTS.md` now requires: opening the live product and reading it as a
stranger.** Not from a test, not from a snapshot. The public landing page renders correctly, and the
first thing a reader's tooling reads about it is wrong.

**Status: RULED 2026-10-12 — fix it now, without buying a domain.** The arbiter ruled: _"Set
`VITE_SITE_URL` to the verified Cloudflare-provided Worker origin. Do not wait for a purchased
domain."_ So Option C below is the ruling, Option A is deferred, and the fix is an origin repoint
rather than a purchase. Two parts are **required**, not optional: the complete email and checkout
flows must be **verified on that origin** (a link that resolves is not a flow that works), and the
claim must become a check — a **deployment-origin assertion** so the next misconfiguration is caught
by a test rather than by someone opening the site. Full ruling and the execution order:
[arbitration-2026-10-12.md](arbitration-2026-10-12.md). **Implemented in code on 2026-10-12** — the
correction below is what implementing it measured, and the ruling's second half (email and checkout
flows verified on that origin) is still blocked on owner-side credentials.

## What is actually deployed

|                                      |                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| The product serves at                | `https://nyuz.grgvishal-gurung17.workers.dev` (verified: page renders, brand and hero correct) |
| Its own canonical URL says           | `https://nyuz.app/`                                                                            |
| `nyuz.app` resolves to               | **nothing — `getaddrinfo ENOTFOUND`**                                                          |
| Zones on the Cloudflare account      | `autocasters.xyz`, `launchreadyy.xyz`, `v1.monster` — **no `nyuz.app`**                        |
| Worker custom domains on the account | only `v1.monster` / `www.v1.monster`, and they belong to a different Worker (`portfoliiov1`)   |

Three independent readings agree, so this is not a browser quirk or a stale cache: the account has no
such zone, the tab lands on Chrome's error page, and DNS cannot resolve the name.

## What that costs a reader — corrected on 2026-10-12, while implementing the fix

**The first version of this section was too broad, and the measurement that replaced it is this:**
the paths that read `VITE_SITE_URL` **at runtime** were already right. The Worker's own
`/sitemap.xml` answered with `https://nyuz.grgvishal-gurung17.workers.dev/…`, so the runtime variable
was set correctly, and the same variable builds the email links, the unsubscribe link and the Stripe
returns. What named the dead host was the **build-time** surface, which had the origin written into
it as a literal:

- **the canonical link on every public page** — `src/lib/seo.ts` (`SITE_ORIGIN`), `src/routes/index.tsx`
  and `src/routes/__root.tsx` — so the product told crawlers it lived at `nyuz.app`;
- **the OpenGraph and Twitter images**, from the same literals, so a link pasted into a chat
  previewed with an image fetched from a host that does not resolve;
- **`public/robots.txt`** — a static asset whose `Sitemap:` line pointed crawlers at a sitemap at
  `nyuz.app`, which no setting could correct;
- and, as a landmine rather than a live fault, the GitHub repository variable `VITE_SITE_URL`, which
  held the literal string `https://<the origin production answers on>` — a value that passed the
  deploy job's non-empty check and would have been inlined into any bundle that read it.

That is still a reader-facing defect — a wrong canonical, a broken social card and a crawler sent to
a dead sitemap are all things a reader or a search engine experiences — but it is not the same claim
as "every newsletter link is dead", and the difference mattered for what the fix had to be. The
second check in the deploy checklist is the one this violates — _\"Domain registered; `VITE_SITE_URL`,
DNS and HTTPS point to the production Worker\"_ — and it is unchecked.

**This is a reader-quality defect, not an infrastructure detail** (`AGENTS.md`, **Stage and
priority**): a briefing whose links do not open is not a 10/10 briefing, and an unsubscribe link that
fails is worse than one that is merely ugly. It belongs in front of reader-quality work, because no
amount of prose quality survives a dead link.

## Why it stayed invisible

The suite cannot see it. `src/lib/pipeline/briefing-timing.test.ts` and
`src/lib/pipeline/digest-delivery.test.ts` both hardcode `VITE_SITE_URL: \"https://nyuz.app\"` as the
fixture origin, so every delivery test passes while proving that the app builds `https://nyuz.app/...`
links — which it does, correctly, at an address nobody can reach. **The test asserts the shape of the
link and the deployment asserts the host, and nothing asserted they were the same host.** The route
walk and the PWA check run against `steps.deploy.outputs.deployment-url || vars.VITE_SITE_URL` — the
fresh deployment first — so they probed the host that _did_ resolve and never looked at the host the
pages _named_; a green walk was therefore compatible with pages canonicalising themselves somewhere
else. That gap is what `scripts/origin-check.mjs` closes.

## What was landed

- `src/lib/site-origin.ts` — one origin for every absolute URL the app publishes. A configured value
  must be an absolute https origin with nothing else in it; a placeholder, a `localhost`, a path or a
  bare hostname is refused in favour of the deployed origin, because a canonical pointing at an
  address that cannot be reached is worse than one that is merely not the final name.
- `src/lib/seo.ts`, `src/routes/index.tsx`, `src/routes/__root.tsx` — the literals are gone.
- `src/lib/server/robots-txt.ts` + `src/server.ts` — `robots.txt` is generated from the same runtime
  variable the sitemap uses, and `public/robots.txt` is deleted, so there is no second copy of the
  policy text or of the origin.
- `scripts/origin-check.mjs` — **the deployment-origin assertion the ruling required by name.** It
  reads the deployment's own sitemap as the corpus, then asserts that the pages, `robots.txt` and the
  sitemap name exactly one origin, and that the origin they name answers `/` with a real title. Its
  self-test breaks eight things on purpose and runs inside `npm run ci`; the live run is a deploy-job
  step after the route walk.
- The repository variable `VITE_SITE_URL` is now the workers.dev origin — the placeholder sentence is
  gone.

**Verified.** The assertion fails against the pre-fix deployment and says which surface names which
origin: `…workers.dev (sitemap.xml)  |  https://nyuz.app (robots.txt, canonical, og:image,
twitter:image, og:url)`. Against the built Worker served locally (`wrangler dev --local`, Node 24),
`/robots.txt` reads `Sitemap: https://nyuz.grgvishal-gurung17.workers.dev/sitemap.xml`, `/` carries
`<link rel="canonical" href="https://nyuz.grgvishal-gurung17.workers.dev/"/>` with matching
`og:image` and `twitter:image`, and `/pricing` canonicalises to the same origin through `seo.ts`.

**Not verified, and it is the ruling's own acceptance condition:** the email and checkout flows
end to end on that origin. Both are blocked by owner-side credentials — the email provider key is
refused and the Stripe price names are unset — so this fix is landed in code and unfinished in proof.

## Options, for the owner

**A. Register `nyuz.app` and point it at the Worker.** Recommended if that is the intended name: the
docs, the legal pages, the tests and the `@nyuz.app` mailbox plan all assume it, so it makes the
existing decisions true rather than replacing them. Requires a registrar, DNS, and the Worker custom
domain.

**B. Adopt a domain the account already holds** (`autocasters.xyz`, `launchreadyy.xyz`, `v1.monster`)
and repoint `VITE_SITE_URL` plus the docs, legal pages and test fixtures at it. Cheaper and immediate,
but it renames the product in every legal document, which is a decision of its own.

**C. Ship the workers.dev origin as the interim origin** — set `VITE_SITE_URL` to
`https://nyuz.grgvishal-gurung17.workers.dev` so links resolve today, and treat the branded domain as
launch work. This is the only option that makes a reader's briefing usable now without any external
account, but it puts a `workers.dev` host in emails and in Stripe return URLs, so it is a
visible-to-reader trade rather than a neutral one.

**What I am asking:** which of these to take, and whether C is acceptable as an interim so that
reader links work while the branded domain is arranged. I have not touched `VITE_SITE_URL`, DNS, or
any test fixture.
