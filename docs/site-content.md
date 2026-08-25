# Site content

How the marketing site is edited from the console without a deploy — and what is
deliberately excluded from that.

> **State: built.**

---

## One schema, three consumers

`src/lib/site-content.ts` holds a zod schema **and a matching default** for every editable
key. Three things share them:

- the **public site**, which renders the value;
- the **admin console**, which edits it;
- the **server functions**, which validate the write.

One schema for all three means **a value that saves is a value that renders**. Validating
in the form and trusting the database on read puts a broken landing page one bad row away,
because a jsonb column will happily store `{"headline": 42}`.

Every default reproduces the copy bundled in the components, so an **empty `site_settings`
table renders exactly what ships today** and the console opens showing real content rather
than blank fields.

---

## Reads never throw

`getPublicSiteContent` runs on the highest-traffic page in the product. It is wrapped so
that a database outage costs the bundled copy, not a 500 on the front door, and
`parseSetting` returns `[fallback, false]` for a malformed row rather than throwing.

A single bad row costs one wrong headline. The `customised` flag reports whether any stored
value was actually used.

---

## Editable keys

| Key                    | Contents                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| `landing.hero`         | Headline (newline splits the line), sub, CTA labels and hrefs, footnote |
| `landing.announcement` | Banner text, link. **Empty text is the off switch**                     |
| `landing.sections`     | Ordered list of sections with visibility                                |
| `landing.media`        | Three image slots                                                       |
| `site.seo`             | Title, description, OG image                                            |
| `site.footer`          | Blurb, tagline                                                          |
| `billing.prices`       | Monthly and annual, per plan                                            |

---

## Section ordering

Stored as an **ordered list**, `[{key, enabled}]`, because order is a real editorial
decision — whether the comparison table comes before or after the noise argument changes
what a first-time visitor is persuaded by, and that is not worth a deploy.

The schema also accepts the older boolean-map form (`{interestDemo: true, …}`) that 0003
seeds, and normalises it. That kept the change a code change rather than a code change plus
a data migration.

`normaliseSections` guarantees three things the schema cannot:

- every key appears **exactly once**, so a component cannot mount twice;
- a key missing from storage still appears, **defaulted on** — shipping a new section does
  not require editing every stored row;
- a key no longer in the bundle is **dropped** rather than left dangling.

### Adding a section

Three edits, and missing one is a type error rather than a blank space on the page:

1. `SECTION_KEYS` in `src/lib/site-content.ts`
2. `SECTION_LABELS` in the same file
3. `SECTION_COMPONENTS` in `src/routes/index.tsx`

The landing page computes the top border rather than baking it in, because whichever
section lands first must not have one and that is no longer known at authoring time.

---

## Media slots

Three fixed slots, each with one defined render site, known aspect ratio and known
fallback:

| Slot      | Where                                                 | Empty behaviour                       |
| --------- | ----------------------------------------------------- | ------------------------------------- |
| `hero`    | Right column of the hero, ~4:3                        | Renders the animated pipeline instead |
| `midpage` | Full-width band after the third visible section, ~3:1 | No band                               |
| `closing` | Above the final CTA, 16:9                             | Nothing                               |

Fixed slots rather than a free image library, for the same reason section keys are fixed. A
general "place any image anywhere" feature is a page builder, and a page builder is how a
careful landing page becomes a careless one.

**URLs are validated** as a root-relative path or `https://`, and nothing else — that rules
out `javascript:` and `data:` in an attribute that reaches every visitor's DOM. The console
is staff-only, which is a reason to check it, not a reason to skip it.

**Alt text is required** once a URL is set, enforced in the console before save so the
operator fixes it while looking at the picture.

---

## Prices

Live in two places on purpose:

- `src/lib/plans.ts` — the shipped defaults and the revenue arithmetic;
- `billing.prices` — the console override.

`resolvePlanPrices` ignores anything malformed rather than throwing, and reports whether an
override was applied, so the overview can distinguish "operator set this" from "we fell
back".

The annual defaults match the Stripe catalogue: Personal $70/year, Pro $150/year
(two months free against monthly $7 and $15). `plans.ts` owns both the monthly and
annual numbers; `billing.prices` is the console override.

---

## Feature flags

`enabled` plus `rollout_percent`, bucketed by user id so a bucket is stable.

**Anonymous visitors resolve a partial rollout to OFF**, not on. Showing a nav link to half
of logged-out traffic at random is worse than not shipping it.

| Flag               | Effect                                        |
| ------------------ | --------------------------------------------- |
| `blog`             | Blog in nav and footer; `/blog` 404s when off |
| `signups_open`     | Close registration. Enforced in Postgres on `auth.users` insert, not only in the UI. |
| `announcement_bar` | Show the configured banner                    |
| `breaking_alerts`  | Out-of-schedule sends                         |
| `deep_explain`     | Premium reasoning tier                        |

---

## What is deliberately not editable

**Legal text.** Policies are a legal commitment with a change history. Editing them from a
console with no versioning, no diff and no approval step is the wrong tool. They live in
`src/routes/legal/$doc.tsx`, so changing them requires a deploy and therefore a code review.

**Footer link columns.** A footer link pointing at a route that does not exist is worse than
a footer nobody can edit. Only the blurb and tagline are editable.

**Plan feature lists.** Product decisions that need a deploy anyway. Shipping "WhatsApp
delivery" as editable text would let someone promise a feature that does not exist.

**The copyright year.** Computed. A stale copyright year is the one footer mistake every
visitor notices.

---

## Related

- [admin-console.md](admin-console.md) — where these are edited
- [database.md](database.md) — `site_settings` and `feature_flags`
