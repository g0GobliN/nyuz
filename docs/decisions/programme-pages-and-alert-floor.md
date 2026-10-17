# Programme pages and the alert floor's next classes (arbiter ruling #5, 2026-10-17)

**Where it was ruled.** The owner's ChatGPT `nyuz` project, chat "ARBITER REQUEST 2026-10-17 #5",
`/g/g-p-6a8ff11b12008191a6d9d24666e402a0-nyuz/c/6ad353b7-d1b4-83ee-bf37-bea2d414149c`, reached from
this session through the browser panel. The owner, asked directly, said: _"discuss with chatgpt …
dnt ask me until both get conclusion"_ — so both questions went to the arbiter and neither went to
the owner as a decision.

**Why it was asked.** Two reader-facing failures with measurements, not proposals:

1. A **programme's own page** still reaches the reader as a story. Live 200-event corpus, composed
   with the reader's own composer: _"A Nvidia insider-turned-VC on why robotics hasn't hit its ChatGPT
   moment, yet"_ (a TechCrunch Equity episode page) publishes the producer's masthead bio, a promo
   line and a truncated promo as its body; _"Apple's HomeView has an app problem"_ (a Vergecast page)
   publishes the hosts' back-announce (_"Relying on CarPlay, slinking back to X, competing with Muse,
   and much more."_) as its only paragraph. The 2026-10-14 byline ruling bounded its shape to a line
   that ends after the outlet, so these continuations are outside it rather than a gap in it.
2. The **alert floor's next classes.** `npm run audit:alerts`, all 218 alerts ever sent: the path is
   gated (the newest 12 sends read `gate ok`), and two post-gate sends still told a reader nothing to
   act on — _"This could be your last chance to grab an RTX 5090"_ (a deals/shelf post) and _"It won't
   kill you, or humanity, to get off the AI upgrade treadmill"_ (a commentary column).

**The arbiter's ruling, verbatim in the parts that bind:**

> "Ruling: Option 1 — Withhold the story when its published body consists only of publisher-owned
> material."

> "Withhold only when the remaining published body is entirely publisher-owned material. Do not
> withhold an otherwise readable story merely because a biography, promotional sentence, or
> programme introduction appears somewhere in its source. Use a deterministic readiness reason. Do
> not invent replacement reporting, infer missing facts, or silently substitute the deck for the
> body. Preserve eligible reporting. … Respect the existing unbriefable rung. If refusing the
> furniture leaves no readable body, the story must not reach the reader."

> "Release criterion: Zero stories consisting solely of publisher-owned material reach the reader. No
> substantive reporting is withheld solely because publisher-owned material appears alongside it. No
> facts are invented or lost through the repair."

> "This is a readiness defect, not a reason to build a new source-classification system."

> "Ruling: Option 1 — Add both measured classes now, with independent rules and regression tests."

> "Refuse the measured shelf/deal title shape when it represents a product availability or purchasing
> opportunity rather than a meaningful news development. Do not refuse legitimate news merely because
> it mentions a product, deal, or commercial transaction. Keep all three measured news controls
> eligible: Nvidia's proposed acquisition of Hugging Face. The DOJ antitrust probe into Nvidia's Groq
> deal. The New York game-ownership bill."

> "Add a narrow, deterministic commentary marker for the measured class. Do not treat all analysis as
> commentary. Keep the measured analysis control eligible. If the marker cannot distinguish commentary
> from analysis reliably, the implementation must not expand the rule beyond the evidence."

> "Pin tests for both new classes independently. Demonstrate that the two measured unwanted alerts are
> refused. … Run `npm run audit:alerts` against the full corpus of 218 historical sends. Report newly
> refused candidates, retained news controls, and any ambiguous cases. Verify that the existing
> readiness gate remains authoritative: alert pacing or delivery must not bypass it."

> "The existing 218 sends are evidence for this targeted repair, not permission to broaden the alert
> floor into a general opinion or commercial-content filter."

## What this authorises, and what it does not

- **Authorised:** refuse publisher-owned sentences where the product can tell them apart
  deterministically (the measured bio, promo and back-announce shapes), and let the existing
  `unbriefable`/no-body readiness rung withhold a story whose published body is then empty. Nothing
  is invented, the deck is never substituted for the body, and a story with real reporting left keeps
  shipping.
- **Authorised:** two new narrow alert-floor classes with tests and the three named news controls.
- **Not authorised:** a source taxonomy or a programme-page classifier; refusing a story merely
  because furniture appears somewhere in its source; a general opinion/commercial-content filter on
  alerts; widening either rule past the measured cases.

## What landed, and how it was verified (2026-10-17)

**Question 1 — publisher-owned material.** `src/lib/reader-evidence.ts` grew four entries, each one
measured shape and nothing wider: the masthead byline that keeps going after the outlet with a _beat_
(`... is an audio producer at TechCrunch focusing on Equity`, `who also covers`, `covering`), the two
bio continuations that follow it on the same page (`Before joining <Outfit>`, `is based in <Place> and
holds a`), the conference promo fragment (`Disrupt doors open`), and the programme intro (`On this
episode of`, `In today's edition of`). `who broke the story on Friday` stays out of the set on purpose:
the ruling's controls keep a byline that carries a claim, and the unit test now says so -- a _beat_ is
not a control any more.

One trap worth keeping: these regexes are compiled with `i` and **without** `u`, where `\p{Lu}` is the
literal text `p{Lu}` and can never match. The first version of two entries used the property escapes and
was dead code; the house `at [A-Z][\w'’.]*` form is what actually matches a masthead.

Measured after, `npm run audit:reader` (live window, 200 stories, 2026-10-17):

- _A Nvidia insider-turned-VC on why robotics hasn't hit its ChatGPT moment, yet_ —
  `emptied-after-selection (charged to a rule)`, `refused=editorial_noise=6`, selected=4, deck=37w.
- _Apple's HomeView has an app problem_ — `emptied-after-selection (charged to a rule)`,
  `refused=editorial_noise=3,invalid_sentence=3`, selected=3, deck=24w.
- Both then fail the existing `unbriefable` rung (`the composer refused the body (N fact(s))`), so the
  reader never meets them. The release criterion holds: `delivered with no body 0`, `refused then
published 0`.

**Question 2 — the alert floor's next two classes.** `src/lib/pipeline/alert-floor.ts` grew
`shelf-deal` and `commentary`, each from the one measured title, with the ruling's controls pinned in
`alert-floor.test.ts`:

- `shelf-deal` needs _both_ halves — an urgency frame addressed at a buyer and an acquisition verb.
  Measured over **all 21,908 stored event titles**: 1 match, that one deals post.
- `commentary` is the _shape_ — a negated modal about an audience (`it won't <verb> you / us /
humanity`) — not the topic word. Measured the same way: 1 match, that column.
- The candidates a wider rule would have used were measured and left out: `% off`, `save $N`,
  `price drop`, `deal of the day` match **0** titles at importance >= 6, and the `treadmill`-noun,
  `to get off` and `won't kill` variants each match the same single title as the shape does. A clause
  with no measured class can only refuse news it was never shown to refuse.
- Controls, all still eligible and pinned: the Hugging Face acquisition, the DOJ/Groq antitrust probe,
  the New York game-ownership bill, and the Morgan Stanley/SCMP analysis piece.

`npm run audit:alerts` after (all 218 alerts ever sent): the two sends now read `floor shelf-deal` and
`floor commentary`, both after a `gate ok`; no other alert changes class.
