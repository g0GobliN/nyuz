# The briefing stops claiming an inbox delivery (2026-10-21)

**Ruling (CEO, 2026-10-21): option 1, channel-neutral framing.** The briefing must not tell a reader
something happened that did not. This records it, what shipped, what was measured, and what was
deliberately left alone.

Source: [design-spec-2026-10-21.md](../design-spec-2026-10-21.md) §S8 (unit **C**). The spec's S8 entry
is a *question*, not an instruction — "the wording is the arbiter's" — and this is the answer.

## The defect, in the reader's words

Email is deliberately dark until launch (`AGENTS.md`: the Resend key is disabled to preserve the free
monthly quota; nothing has been accepted since **2026-08-26**). The briefing page still framed itself
as the email edition. Four claims on one page, none of them true for any reader today:

| On screen | Where | Why it was false |
| --- | --- | --- |
| "Exactly what landed in your inbox." | `briefing.tsx` title | No email has ever landed for this reader |
| "This is the briefing as your channels received it" | `briefing.tsx` sub | The same claim, restated |
| `brief@nyuz.app` + "Your 7:30 AM brief" | `briefing-preview.tsx` header | A sender address for a send that did not happen |
| "Delivered at 7:30 AM" | `briefing-preview.tsx` footer | A delivery stamp with no delivery behind it |

Plus the channel chip: an **Email** chip that appeared because the reader's *preference* was on. The
chip was honest about the preference and dishonest by implication — it sat under a title claiming a
delivery, so it read as a receipt. That is the same defect wearing a different hat, which is why it
moved with the rest.

## The ruling, as implemented

Nine strings and one prop. The page now says three true things instead of four false ones:

| Before | After |
| --- | --- |
| "Exactly what landed in your inbox." | **"Your briefing, as it was assembled."** |
| "This is the briefing as your channels received it. Nothing here was reordered for the web." | **"Built from today's coverage at 07:30. Nothing here was reordered for the web."** |
| `brief@nyuz.app` (sender) · `7:30 AM` (send time) | **"Edition · 07:30"** |
| "Delivered at 7:30 AM" | *(removed — not reworded)* |
| Email · Telegram | **Email on · Telegram on** |

The second half of each string is preserved on purpose. "Nothing here was reordered for the web" was
already true and still is; only the claim about *how it arrived* was false. **The artifact framing is
the identity and stays** — float shadow, full-width rule, the 25-row rhythm, the card's reading cap.

### The time is the reader's own, not a literal

The header reads `07:30` because `DEFAULT_PREFS.time` is `"07:30"` (`src/lib/prefs.ts`), and the sub
interpolates `prefs.time` directly. A reader whose preference is `18:00` sees **"Edition · 18:00"**
and **"Built from today's coverage at 18:00"** — not a copy-pasted `07:30` that is a second lie. The
spec quotes the strings with `07:30` because that is the default; a string that is only true for
readers who never touched the setting is not a fix, it is the same defect with a new sentence.

### Two axes, two props

The card already had `variant: "marketing" | "reader"` (B1/B2: fixtures vs. links, plus the reading
cap). This ruling needed a *second*, orthogonal axis — whose stories these are, versus what the card
says happened to them — so it is `chrome: "email" | "edition"`, defaulting to `"email"`.

Defaulting to `email` is what keeps `/` and `/how-it-works` byte-identical. Marketing is **selling**
email and is entitled to name an inbox; the reader's own page is not. One switch rather than a fork,
so the two surfaces cannot drift: what the landing page shows is the claim, and the dashboard is where
the claim is kept.

## What did not move

- **The marketing page's copy.** Both landing-page usages pass no `chrome`, so they render exactly
  what they rendered before — verified byte-for-byte, not by inspection (below).
- **Today/Saved chips and their tallies.** Untouched; they count lists, which is a claim with an
  answer behind it.
- **Card geometry and float shadow.** The header row, the footer's border, padding and channel list
  are the same elements with the same classes. Only text inside them moved.
- **Delivery-page preference toggles.** `/dashboard/delivery` still reads and writes the same prefs.

## Measured, not asserted

`BriefingPreview` rendered to static markup under both chromes (Node 22, `renderToStaticMarkup`):

- **edition chrome** — text contains **no** match for `/inbox/iu`, `/brief@nyuz\.app/iu`, or
  `/Delivered at/iu`; contains `Edition · 07:30`; the 24-hour stamp occurs **exactly once**; the
  card's own `7:30 AM` line occurs **exactly once**; `max-w-[32rem]` and the story links are present.
- **default chrome** — markup is **byte-identical** to `chrome="email"` explicitly passed
  (`expect(bare).toBe(render({ chrome: "email" }))`), and contains `brief@nyuz.app` and
  `Delivered at 7:30 AM`.
- **fallback** — a caller that passes `chrome="edition"` with no `editionTime` gets
  `Edition · 7:30 AM` rather than an empty stamp.

**The assertions were proven able to fail.** Reverting the header to `brief@nyuz.app` and the footer
to print `Delivered at` under `edition` turned **6 of the 8** harness cases red — including all three
banned-string checks and both chrome-identity checks. The two that stayed green are the ones that
genuinely do not concern chrome (reading cap and story links). A green harness against the old code
would have proved nothing; this one does not.

> **Recorded gap.** The ruling's acceptance pins `git diff --stat` to `briefing-preview.tsx` and
> `routes/dashboard/briefing.tsx` only, so **no test file is committed** — the harness above ran and
> was deleted rather than shipped. That is a real weakness: nothing in the suite now fails if a later
> change re-introduces `Delivered at`. The next slice that touches this card should add the case to
> `src/components/briefing-preview.test.ts`, and the spec's own diff restriction is the only reason it
> is not already there.

## Deferred, on purpose

The briefing page's footer says **"Every story links to the original reporting"**
(`briefing.tsx`). B1 makes each story link to its _story page_, which then lists the sources, so the
sentence is arguable in both directions. §S8 puts it in the same arbiter question as option 1 rather
than a separate edit; it is **not** changed here, and it belongs to whoever rules next.

### A second adjacent claim, found by reading the rendered page

Reading `/dashboard/briefing` as a stranger after the change turned up a word the spec did not name:
the `PageHeader` **eyebrow still reads "Delivered"** (`briefing.tsx:140`, or `Delivered · <date>`
when an older digest is open). It is **not** changed here, for three reasons:

1. The ruling named three page-level strings — title, sub, preview chrome — and this is a fourth.
   Copy the arbiter did not rule on is copy the arbiter owns.
2. It does not trip the acceptance measure, which bans `Delivered at`, not `Delivered`.
3. It is a weaker claim than the ones that moved: it says an edition exists on a date, not that a
   message reached an inbox at a time.

It is nonetheless **in the same defect class** and is recorded here so the next arbiter question has
it. If the ruling is that the eyebrow should also be channel-neutral, it is one string on line 140
and needs no structural change.

## What this makes true at launch

When email comes back, the copy can be conditioned on a real send without touching this page again:
`chrome="edition"` stays the reader's default and a genuine delivery row earns a genuine delivery
stamp. Until then there is nothing behind one to print.