# Reader clarity audit v2 — the first post-fix build, read as a stranger

**Date:** 2026-10-23 (JST). **Captured:** 05:43–06:05Z, on the deployed origin.
**Origin:** `https://nyuz.grgvishal-gurung17.workers.dev` (the product's origin; `nyuz.app` does not resolve — a stage condition, not a defect).
**Wave audited:** `9a68caa` (PR #57, story clarity) + `72f85b7` (PR #59, briefing surface, merged 2026-10-23T04:49:21Z, deployed 04:57:15Z, runner run `39902369664`, job *Deploy to Cloudflare Workers* success).

**Verdict:** `blockers 5 · should-fix 12 · polish 11 · fixed 8 of 25`
`not measurable on this build: 3 of the 25 (I-01, I-13, B-04) — §G`

The first three numbers count the **28 findings** this run files or confirms (25 re-scored rows that are still present, plus 3 re-scored `H` findings, plus 11 new). The fourth counts the **first audit's 25** `I`/`B`/`X` findings: **8 fixed, 14 still present, 3 not measurable** = 25.

No code, copy or content was changed by this task. It is an audit; the fixes are separate.

---

## 0. The gate this audit was told to apply — and what it means for the numbers above

The card says: *"Only after a briefing built after the merged fixes exists. Compare the briefing's `built_at` with the merge commit of the wave you are auditing; if the build predates the merge, stop and say so — never measure the old artifact."*

Measured, in UTC:

| event | timestamp | source |
| --- | --- | --- |
| wave merged to `main` | `2026-10-23T04:49:21Z` (`72f85b7`) | `git show -s` |
| **deployed** | `2026-10-23T04:57:15Z` | `gh run view 39902369664 --json jobs` |
| reader's newest briefing **built** | `2026-10-22T22:55:38.672Z` (`fab11fdf`, scheduled `2026-10-22T22:30Z`, 17 items, `ready`) | `digests` row |
| next briefing scheduled | `2026-10-23T22:30:00Z` (status `scheduled`, `generated_at` null) | `digests` row |

**So the gate is not met: the reader's current edition was built six hours before the deploy.** Rather than stop with no evidence at all, this audit splits the page by where each string comes from, which is measurable and which is not:

- **Frozen in the build (NOT scored).** The briefing and feed print `digest_items.summary` — the composer's own sentence, stored at build time (ruling #11: *"the stored sentence is the one a reader has already met"*, `src/lib/server/briefing.ts:1189`). The story page's **opening sentence** is that same stored artifact (`summariesFor` → `storyOpening`), so a story opening cannot change until the event is re-briefed. Any finding that quotes one of those strings is listed in **§G** as *not measurable*, with the string, and is not counted as fixed or as present.
- **Produced by the deployed renderer (SCORED).** Briefing chrome, chips, eyebrow, sub-line, lede, groups, per-card band and actions; the story **body** (`composeArticle(story)` runs in `story-article.tsx` at request time); the story **rail**; the landing copy. A change merged in this wave shows here immediately, so these are measured live.

That split is why the verdict line has three numbers instead of two: 8 fixed, 14 still present, 3 unmeasurable, over the 25 findings the first audit filed.

**Proof the deploy under audit is what the browser got:** the strings `TODAY'S EDITION`, `Email · on (preference)`, the through-line lede and the four group headings did not exist before this wave and are on the page now (§4). This is the merged code, serving a pre-merge edition.

---

## 1. How these pages were read

**Session.** `/dashboard`, `/dashboard/briefing` and `/dashboard/story/<id>` are behind a reader session; logged out they render only `Checking your session…`. Read as the one account that has a delivered briefing (the owner's own), signed in with a Supabase magic link generated server-side — no password, no email sent, no product content edited. The panel above every dashboard page reads "Registered devices · 10 of 10 used" and offers "Register this device"; recorded as an observation, not a finding (audit 1 excluded it for the same reason).

**Viewports.** 1440×900 and 360×780 (CDP device metrics). At 360 px no element overflows: `document.querySelectorAll('main *')` filtered for `scrollWidth > clientWidth` with a clipping `overflow` returned **0**.

**Capture method.** `document.body.innerText` after the page settled, written to raw text files and machine-checked (appendix B): **every quotation in this file is a substring of the capture it names**, verified by script, so no quote is retyped or reconstructed from the code. Where a page failed to render it is quoted as it failed, with the Ray ID.

**Two artefacts excluded.** The `🐴` prefix in tab titles is injected by the reading browser, not the product. A first capture of two story pages returned only `Back to your nyuz`; on reload one rendered normally and the other returned a Cloudflare error — recorded as a timing artefact for the first and as finding **N-03** for the second, because the error was reproducible.

**What was read, exactly.**

| capture | page | viewport |
| --- | --- | --- |
| `feed-desktop` | `/dashboard` | 1440×900 |
| `feed-360` | `/dashboard` | 360×780 |
| `brief-desktop` | `/dashboard/briefing` (digest `fab11fdf`, 22 Oct 22:30Z build) | 1440×900 |
| `brief-360` | `/dashboard/briefing` | 360×780 |
| `brief-arch` | `/dashboard/briefing?digest=4a6b2ad2…` (19 Oct 22:30Z build) | 1440×900 |
| `land` | `/` (landing) | 1440×900 |
| `st-11ecd424` | `/dashboard/story/11ecd424…` — the first audit's card 01 | 1440×900 |
| `st-a3e60b09` | `/dashboard/story/a3e60b09…` — the first audit's card 06 | 1440×900 |
| `st-f937622f` | `/dashboard/story/f937622f…` — the first audit's card 09 | 1440×900 |
| `st-ed2f6875` | `/dashboard/story/ed2f6875…` — the first audit's card 12 | 1440×900 |
| `st-8766cb0f` | `/dashboard/story/8766cb0f…` — card 09 of the current edition | 1440×900, 360×780 |
| `st-4001e8a2` | `/dashboard/story/4001e8a2…` — card 16 of the current edition | 1440×900 |
| `st-1102` | `/dashboard/story/ed2f6875…`, the failing load | 1440×900 |

**The two story pages the card asks for** are `st-8766cb0f` and `st-4001e8a2` — both from the reader's current edition. The four stories the first audit scored are read as well, because 15 of its 17 `I-` findings name those pages and a re-score that opened different stories would not be a re-score.

---

## 2. The test applied

Identical to the first audit (`docs/reader-clarity-audit-2026-10-22.md` §2). For every quoted block, six questions:

1. Can a smart 15-year-old with no prior context understand it on first read?
2. Is every acronym, product name and piece of jargon explained at first use, or replaced?
3. Does every sentence have a subject the reader can identify — no "this", "it" or "the move" pointing at nothing?
4. Is the structure scannable — a heading, then one idea per paragraph, no wall of text?
5. Does the text say *why this matters* in plain words, or only *what happened*?
6. Is anything repetitive, machine-sounding or padded?

Severity, unchanged: **blocker** — a reader cannot understand the page; **should-fix** — the reader gets through it, but a sentence, label or claim is wrong, unexplained or self-contradicting; **polish** — it reads, but costs the reader something small.

**Status scale.** *fixed* — the audited string is gone from the live page and the replacement reads; *still present* — the reader meets the same defect today; *regressed* — the fix made it worse; *not measurable* — the string sits in the pre-merge build (§G).

---

## 3. Home feed — `/dashboard`

First screen, literally (`feed-desktop`):

```text
Good afternoon, goblin01.

Your nyuz found 17 things worth knowing.

Read as a briefing

01
NVIDIA BLOG
Medium
NVIDIA Unveils Minerva to Bring End-to-End Observability for AI Factories

Launched on 22 October 2026, NVIDIA Minerva is an AIOps platform built to help teams find problems earlier and keep AI factories productive.

Why you're seeing this · You follow AI and NVIDIA.

Today · 00:00
AI
NVIDIA
Hardware
Health
Read →
Save
```

Measured on the rendered feed: **17 cards**, bands `Medium 7 · Notable 10 · High 0`, `Read →` and `Save` on all 17, reason lines 17 with 9 distinct values.

| # | status | quote (verbatim, `feed-desktop`) | what changed / what is still wrong | severity |
| --- | --- | --- | --- | --- |
| H-05 | still present | `Notable` | The scale still reads `Medium 7 · Notable 10 · High 0`: 10 of 17 cards carry the word that is the *lowest* band, no card is High, and the three labels still mix a level, a size and a compliment. The band is code (`importanceBand`), so this is measured, not inferred. Not in this wave's scope; recorded because the reader sees it first. | **should-fix** |
| H-06 | still present | `Why you're seeing this · You follow AI.` | 17 reason lines, 4 of them exactly `You follow AI.`, 16 of 17 naming AI. The line is rendered per card (`reasonFor`), so this is live output: the card that exists to explain why a story is here still says the same sentence on a quarter of the feed. **Fixed later the same morning — re-measured in §8b.** | **polish** |
| H-16 | still present | `AI` `NVIDIA` `Hardware` `Health` | Card 01 is an NVIDIA observability product launch; `Health` is not in the story. Topic chips remain a data-attribution problem, not a copy one (measured on the chip row of card 01). | **should-fix** |
| H-03 | not measurable | `according to NVIDIA Blog.` | 5 of 17 summaries contain `reports that` / `according to` / `says`; 0 open with one. Every one of those strings is stored in `digest_items.summary`, so this run cannot attribute the number to the deploy (§G). | — (§G) |
| H-01, H-04, H-07, H-08, H-13, H-14, H-18 | not measurable | see §G | Source headlines and summaries printed verbatim — frozen at build. | — (§G) |

### Surface verdict

The shape holds: no wall of text, one plain sentence per card, band and actions on every card. Two reader-facing problems survive untouched and both are label problems the product owns, not source problems: **"Notable" is the bottom of the scale and 10 of 17 cards sit in it**, and **4 of 17 reason lines are the identical sentence "You follow AI."** The other eight `H` findings cannot be scored on this build (§G).

---

## 4. Briefing — `/dashboard/briefing`

This is where the wave's work is visible, and it is visible immediately. First screen, literally (`brief-desktop`):

```text
TODAY'S EDITION

Your briefing, as it was assembled.

Built from today's coverage at 07:30. Nothing here was reordered for the web.

Today · 17
Saved · 1
Email · on (preference)
Edition · 07:30

YOUR 7:30 AM BRIEF

17 things worth knowing, goblin01.

The day's through-line is AI — 6 of 17 stories — with NVIDIA (5) behind it.

AI · 6 STORIES
```

and the four groups, in page order: `AI · 6 STORIES` (01, 03, 07, 08, 13, 17) · `NVIDIA · 5 STORIES` (02, 04, 06, 11, 15) · `CYBERSECURITY · 2 STORIES` (09, 10) · `ELSEWHERE · 4 STORIES` (05, 12, 14, 16) — 17 cards, each now carrying its band, `Read →` and `Save`.

| # | status | quote (verbatim, capture) | what changed / what is wrong | severity |
| --- | --- | --- | --- | --- |
| B-01 | **fixed** | `TODAY'S EDITION` (`brief-desktop`) | The eyebrow that claimed a send is gone; it now names the edition, and the archived page names its own day (§B-02). Verified on both the live edition and the archive: `TODAY'S EDITION` / `EDITION · OCTOBER 20`. | — |
| B-02 | **fixed** | `Built from coverage published before 07:30 on October 20. Nothing here was reordered for the web.` (`brief-arch`) | The archive no longer says "today's coverage": it names the day and the cut-off, beside the eyebrow `EDITION · OCTOBER 20`. The live edition keeps the "today" form, where it is true. | — |
| B-03 | **fixed** | `The day's through-line is AI — 6 of 17 stories — with NVIDIA (5) behind it.` + `AI · 6 STORIES` … `ELSEWHERE · 4 STORIES` (`brief-desktop`) | An introduction now says what the edition is about, and four headings break 17 cards into 6 · 5 · 2 · 4. Measured heading tree: h1 ×1, h3 ×17 (every h3 wraps a link), and the in-group order is the edition order. The grouping itself has two new defects of its own — see N-04 and N-07. | — |
| B-06 | **fixed** | `Email · on (preference)` (`brief-desktop`) | The chip no longer reads as delivery state: it labels itself a preference. The delivery row for this edition is unchanged (`email → failed`, push sent), so the reader is no longer told something the system does not claim. | — |
| B-04 | not measurable | `Why it matters · Four publishers reported this.` | The string does not occur anywhere on the current edition, feed or story pages — all 17 `digest_items.why_it_matters` are empty. Whether the composer can now write a significance line cannot be told from a build whose items stored none (§G). | — (§G) |
| B-05 | still present | `PHP blames supply chain security biz Chainguard for putting huge chunks of the web at risk` … `World leaders warn of security flaws found in PHP programming language` (`brief-desktop`, positions 09 and 10) | Two cards, one real-world event: the PHP2shell disclosure. The archive's defect was cards 6 and 9; the edition has a different pair and the same defect — 2 of 17 slots spent twice, and the reader is never told they are the same story. Distinct `events` rows, one publisher each. | **should-fix** |
| N-04 | new | `AI · 6 STORIES` (`brief-desktop`) | The four group labels are `<p role="heading" aria-level="3">` — exposed to assistive tech as headings, but at the **same level as the 17 story headlines**, so the outline is 21 headings at level 3 with nothing to say which are sections and which are items. On the feed the same story is an `<h2>`, so heading level also means different things on the two surfaces. Not a missing structure — a mis-levelled one. | **polish** |
| N-05 | new | `The day's through-line is AI — 6 of 17 stories — with NVIDIA (5) behind it.` (`brief-desktop`) | The lede's numbers cannot be reconciled with the page it introduces: `NVIDIA (5)` but **7 of 17 cards are published by NVIDIA's own blog** (`NVIDIA BLOG` ×7), and `6 of 17` for AI while **16 of 17 reason lines say "You follow AI…"**. A reader who counts gets three different answers on one screen. The lede is new code, so this is measured output, not a data artefact. | **should-fix** |
| N-06 | new | `NVIDIA BLOG` (`brief-desktop`) | Corrected against the briefing text itself: **7 of 17 cards (41%) are NVIDIA's own blog** — Minerva, European retail, DSX, Earth-2, Cosmos, financial services, public sector — plus a Register piece about Nvidia. A reader who signed up for a news briefing gets a vendor's marketing feed with a news frame around it, and the edition's "through-line" is that vendor. This may belong to selection rather than to the composer; it is filed because it is the most visible thing on the page today. | **should-fix** |
| N-07 | new | `Nothing here was reordered for the web.` (`brief-desktop`) | The sentence is now false on the page that prints it. The feed lists the edition as 01…17; this page lists 01, 03, 07, 08, 13, 17 — 02, 04, 06, 11, 15 — 09, 10 — 05, 12, 14, 16. Grouping *is* a reorder, and the sub-line was written when the page printed the edition verbatim. Either the sentence goes or it says what grouping did. | **should-fix** |
| N-10 | new | `Coolfly’s solar-powered Aura Smart Bird Feeder is nearly 50 percent off` (`brief-desktop`, position 14) | A shopping deal sits in a news edition, and its reason line is `Why you're seeing this · You follow AI.` — the same sentence 3 other cards print. Whatever the reader asked to follow, they did not ask for a bird feeder discount, and the card gives no sign that it is advertising rather than news. | **should-fix** |
| N-11 | new | `01` `03` `07` `08` `13` `17` (`brief-desktop`) | The item numbers now jump inside every group, and nothing says what they are. A reader sees a section headed "AI · 6 STORIES" whose items are numbered 01, 03, 07, 08, 13, 17 — the numbers are the edition's positions, but they read as a miscount. | **polish** |

### Surface verdict

Four of the six `B` findings are genuinely closed, and the change is legible without knowing the code: the page now says what edition it is, what the day was about, and how the stories break down, and it carries the band and the two actions the feed always had. What the new structure added is two clarity problems of its own — a lede whose counts do not match the page (N-05) and sections exposed at the same heading level as the items they contain (N-04) — plus a sub-line the grouping made untrue (N-07). The edition's content is a different story: 7 of 17 cards are one vendor's marketing (N-06), a shopping deal is card 14 (N-10), and the PHP story is in it twice (B-05).

---

## 5. Inside — story pages

Six story pages were opened: the two the card asks for from the current edition (`st-8766cb0f`, `st-4001e8a2`) and the four the first audit scored (`st-11ecd424`, `st-a3e60b09`, `st-f937622f`, `st-ed2f6875`). Story bodies are composed at request time, so this surface is post-merge output; the **opening sentence** is not — it is the delivered artifact (ruling #11), which is why I-01 and I-13 are in §G and not in the table below.

### 5.1 The four blockers from the first audit

| # | status | quote (verbatim, capture) | what changed / what is wrong | severity |
| --- | --- | --- | --- | --- |
| I-12 | **fixed** | `Two bugs found with AI are behind major issues on 21 October 2026 for 4chan, DeviantArt and Wikipedia.[1]` (`st-f937622f`) | The clause that named nothing — "…and the blog where the bar around the corner posts pictures of people's dogs" — is gone, the list is rejoined, and the sentence still asserts what the source asserted. The page now closes on a claim a stranger can hold. | — |
| I-09 | still present | `August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.` (`st-a3e60b09`) | Card 06 still opens on a date fragment: no subject of its own, no statement of what the vulnerabilities are, six weeks before the page's own present. A reader still cannot understand the page from its opening. | **blocker** |
| I-10 | still present | `As a result of the leak and pre-announcement around 20:00 UTC, Calif, one of the security firms that had reported the issues mistakenly published a video.` (`st-a3e60b09`) | "the leak" and "Calif" are still introduced by a consequence rather than by their own sentence; the main clause is still the video, while what matters (the flaws went public early) is still a subordinate phrase. | **blocker** |
| I-11 | still present (reduced) | `The video contributed to accelerated development of various PoCs (exploitation proof of concepts), which then increased circulation on October 21st.` (`st-a3e60b09`) | The **out-of-order timeline the finding named is no longer reproducible**: the page now reads 24 August → 21 September → 20 October → `October 21, 2026: Patched PHP releases become available.[1]` in ascending order. What survives is the form — bare date fragments with no subject — and `PoCs` expanded into "exploitation proof of concepts" inside a parenthesis. Downgraded from blocker to should-fix on that measurement, not on the file. | **should-fix** |
| N-02 | new | `Finally, ten years after Cameroon’s deadliest railway disaster, families of the 79 victims are still fighting for justice, saying their pain has yet to be acknowledged.[1]` (`st-4001e8a2`) | **A different story is inside the Sudan story.** Card 16 opens on Sudan's war and Abyei, and its second paragraph is a Cameroon railway disaster from ten years ago — the same France 24 page evidently carried both, and the composer published both under one headline. A reader is told two unrelated things and no frame separates them. This is a hard blocker: the page cannot be read as one story. | **blocker** |
| N-01 | new | `Chainguard CEO: ', the author reported making the call'.` (`st-8766cb0f`) | A template artefact printed as prose, mid-paragraph, followed by the sentence that actually says it (`CEO Dan Lorenc spoke with The Register on Wednesday…`). The quotation marks are mismatched, the fragment has no verb, and it survives into the reading flow of a card the reader has already been given. Blocker: the paragraph cannot be parsed. | **blocker** |
| N-03 | new | `Error 1102` / `Worker exceeded resource limits` (`st-1102`, Ray `a4ee7e05…`) | **Card 12's story page returns a Cloudflare error instead of a page.** Two of five loads in three minutes returned the error page; three rendered. The reader who taps that card gets a wall. The Workers-free CPU ceiling is a known stage condition (`docs/decisions/cpu-killed-invocations.md`) and this is the same ceiling on a reader route rather than on cron — filed as a blocker because the reader's outcome, not the billing tier, is what the card measures. | **blocker** |

### 5.2 The rest of the story surface

| # | status | quote (verbatim, capture) | what changed / what is wrong | severity |
| --- | --- | --- | --- | --- |
| I-03 | **fixed** | `perform operational technology (OT) system reconnaissance` (`st-11ecd424`) | The source's own gloss is back at the first bare use, so the story's key noun is expanded on the page that uses it three times. Measured on the live body; the rule adds nothing that was not already in the evidence. | — |
| I-06 | **fixed** | `BASED ON 8 PUBLISHERS · 9 REPORTS` (`st-ed2f6875`) | The rail now derives its caption from the rows it prints: 8 outlets, 9 reports, and the Al Jazeera duplicate is visible as a second row rather than hidden behind a number that said four. The label can be counted against the list below it, which was the whole finding. | — |
| I-01 | not measurable | `The Register reports that when it comes to cyberattacks that shut down power grids, drinking-water systems, and other critical infrastructure, AI doesn’t – yet – turn script kiddies into sophisticated, nation-state attackers.[1]` (`st-11ecd424`) | This is the stored delivered sentence (ruling #11), so the page's opening cannot change until the event is re-briefed. §G. | — (§G) |
| I-13 | not measurable | `W3Techs, a survey service, says that the PHP programming language is used by “69.3 percent of all the websites whose server-side programming language we know,” including popular sites like Wikipedia and WordPress.` (`st-f937622f`) | Same artifact: the deck *is* the delivered sentence, so the composer's demotion rule cannot be observed on this page. §G. | — (§G) |
| I-02 | still present | `"One thing that we've relied on for years is security by obscurity when it comes to utilities," said Steve Swick, former chief information security officer at American Electric Power.` (`st-11ecd424`) | The second paragraph still opens on a 17-word unattributed quotation with "security by obscurity" unexplained and the speaker's name arriving only after it. Unchanged from the first audit. | **should-fix** |
| I-04 | still present | `“Basic access can recon documentation, and distill through that documentation very quickly to find out critical design features of your plant and facility,”` (`st-11ecd424`) | Still printed as a quotation that is not a grammatical sentence ("can recon documentation", "distill through that documentation"), with no frame telling the reader whether it is verbatim speech or a paraphrase. | **should-fix** |
| I-05 | still present | `Armadin is Kevin Mandia’s new security startup that uses swarms of autonomous AI agents to simulate real-world cyberattacks.` (`st-11ecd424`) | "Kevin Mandia" is still introduced only as a possessor, and the sentence still spends half its length on a name it never places. | **polish** |
| I-07 | still present | `The Verge` `21:30` (`st-ed2f6875`); `The Verge` `20:36` (`st-f937622f`) | Rail times still carry no date and no label: a reader still cannot tell publication time from fetch time, and "21:30" on a two-day-old story is not a time they can use. | **polish** |
| I-08 | still present | `Relevance` `10.0 / 10` `Importance` `2.0 / 10` `Novelty` `7.0 / 10` (`st-f937622f`) | The percentages became tenths (S9 landed), but there is still no line saying what the three numbers mean, and they still contradict the story: a critical vulnerability in "basically any site running PHP" is scored `Importance 2.0 / 10` — the same bottom band the feed prints as "Notable". | **should-fix** |
| I-14 | still present | `According to OpenAI, an AI security group called Calif identified a “critical” PHP flaw using GPT-5.6 Sol` (`st-f937622f`) | Five names in one sentence, still only Wiz placed ("Google-owned"), and `GPT-5.6 Sol` is still a model name the reader cannot rank. | **polish** |
| I-15 | still present | `Dan Sheehan said.` … `said investment analyst Sheehan from Telos Wealth Advisors.` (`st-ed2f6875`) | The same person still appears twice under two identities, role-first only at the second mention. | **polish** |
| I-16 | still present | `Earlier in October 2026, The Verge reports that Barclays published a client note suggesting a potential Tesla-SpaceX combination could be announced ahead of Tesla’s annual shareholder meeting scheduled for December 3, 2026.` (`st-ed2f6875`) | Tense still breaks inside one sentence ("Earlier in October 2026 … reports that Barclays published"), and the reader still gets October, December 3 and "earlier" in a paragraph about what may happen. | **polish** |
| I-17 | still present | `nyuz is not the source. Source descriptions may contain errors. Open the original reporting before acting on it.` (`st-f937622f`) | Unchanged: it still tells the reader the page may be wrong without saying which parts are the source's and which nyuz wrote. | **polish** |
| N-08 | new | `“These things are messy,” Lorenc said.` … `“These things are messy,” CEO Dan Lorenc said.` (`st-8766cb0f`) | The same six-word quotation is printed in two consecutive paragraphs, with the speaker introduced differently each time. To a reader it reads as two separate remarks. | **polish** |
| N-09 | new | `Sudan’s brutal war continues to take a devastating regional toll, as a drone strike in Abyei reportedly kills 153 people.[1]` (`st-4001e8a2`) | The only concrete fact on the opening line hangs on `Abyei`, a disputed area no reader can place, and `continues to take a devastating regional toll` says nothing a reader can check. | **polish** |

### 5.3 What each page does now

- `st-11ecd424` — the body is a real account with real quotes, and the OT gloss is back; the opening is still the old delivered negation (I-01, §G), the second paragraph still opens on an unattributed quote (I-02).
- `st-a3e60b09` — still the two chronology blockers (I-09, I-10); the timeline order is now right, which removes part of I-11 and nothing of its form.
- `st-f937622f` — the closing sentence is fixed (I-12) and the rail is honest (I-06); the deck is still the W3Techs statistic, but that sentence is the stored one (I-13, §G), not this composer's current choice.
- `st-ed2f6875` — the sources rail is now countable (I-06); three of its four minor defects are unchanged (I-07, I-15, I-16); the page itself intermittently fails with `Error 1102` (N-03).
- `st-8766cb0f` (current edition, card 09) — a template artefact in the middle of a paragraph (N-01) and a duplicated quotation (N-08); otherwise the clearest page read in this run.
- `st-4001e8a2` (current edition, card 16) — a second, unrelated story printed inside the Sudan story (N-02).

---

## 6. Cross-surface

| # | status | quote (verbatim, capture) | what changed / what is wrong | severity |
| --- | --- | --- | --- | --- |
| X-01 | **fixed** | `Medium` … `Read →` `Save` on the briefing (`brief-desktop`) | The briefing now prints the same band the feed does (measured `Medium 7 · Notable 10` on both) and gives every card the same two actions (`Read →` ×17, `Save` ×17). The two surfaces no longer disagree about the same 17 stories. | — |
| X-02 | still present | `Most mornings that's five stories or fewer. Some mornings it's one. Occasionally it's none, and we tell you that rather than padding it out.` (`land`) | The landing page still promises five-or-fewer while the reader's editions are 25 (22 Oct), 25 (20 Oct), 16 (9 Oct) and 17 (today, measured on the live feed: `Your nyuz found 17 things worth knowing.`). Untouched by this wave by design — owner positioning — recorded so it is not mistaken for closed. | **should-fix** |

---

## 7. What is already good — do not regress it

- **The briefing now has an introduction and sections.** `The day's through-line is AI — 6 of 17 stories…` followed by four headed groups is the difference between a list and an edition. The counts being wrong (N-05) is a fixable copy problem; the structure is the win.
- **The archive names its own day, twice.** `EDITION · OCTOBER 20` and `Built from coverage published before 07:30 on October 20.` — the reader is never told "today" on a two-day-old page.
- **The sources rail can be counted.** `BASED ON 8 PUBLISHERS · 9 REPORTS` above nine rows is the honest version of the label, and the Al Jazeera duplicate is visible instead of hidden.
- **The acronym rule works and invents nothing.** `operational technology (OT)` is the source's own gloss, restored at first use.
- **The unresolvable clause is gone without inventing a fact.** `…for 4chan, DeviantArt and Wikipedia.` stops at what the source said, and the sentence is not left dangling.
- **A reader always knows where they are.** `9 of 17`, `← and → move between stories`, `PREVIOUS` / `NEXT` with the actual next headline, `Oct 21 · 21:00` (the date now appears where audit 1 found only `Yesterday · 21:00`).
- **Layout holds at 360 px.** No clipped or overflowing element on the briefing, the feed or a story page (measured, §1).
- **The channel footer is honest.** `Source descriptions and generated coverage can contain errors. Every story links to the original reporting.` — it no longer claims to be, or not to be, the source in a way the reader has to decode.

---

## 8. Where the fixes belong

| finding | where it belongs | why not here |
| --- | --- | --- |
| N-01 (template artefact), N-02 (foreign paragraph), N-08 (duplicate quotation) | The article composer's sentence-selection and its quotation handling (`src/lib/editorial.ts`); N-02 in particular is evidence selection publishing two unrelated source paragraphs under one headline. | Three prose defects with three different causes; each needs a rule, not a string patch. |
| N-03 (`Error 1102` on a reader route) | Composition cost on the story route, inside the Workers-free 10 ms budget. Measure which composition step spends it before changing anything. | The ceiling is a stage condition; the reader-visible failure is not. |
| I-09, I-10, I-11 (chronology) | The composer's narrative-order rule landed after this capture (PR #61, merged `2026-10-23T06:00:45Z`, deployed `06:05:38Z`) — and the page still opens on the same date fragment, because the opening is the stored delivered sentence. The remaining work is the one §8b measures: the opening a reader meets cannot be recomposed. | Re-measured after that deploy in §8b; nothing further to file until an opening can be composed live. |
| N-04 (group and item headings share `aria-level="3"`) | `src/components/briefing-preview.tsx`: move the group label to level 2 and the item to level 3 (or use `h2`/`h3` elements), and settle whether a story is `h2` on the feed or `h3` here. | A markup change with a heading-level decision behind it. |
| N-05, N-07 (lede counts, "nothing here was reordered") | The lede's counting rule and the sub-line copy. | Both are copy claims about the edition; they need a ruling on what the lede counts (topics or publishers). |
| N-06 (7 of 17 vendor blog cards), N-10 (a shopping deal in the edition) | Selection / source weighting, not copy. | Both change what a reader is sent. |
| I-02, I-04, I-05, I-14, I-15, I-16, I-17, N-09 | Composer prose rules (attribution before quotation, name placement, tense within a sentence, the caveat's wording). | One rule each; several are already on the composer's list. |
| I-07, I-08 | `story-article.tsx` rail: a date on every row, and a one-line legend for the three scores. | Small, but it changes a claim the reader checks. |
| B-05 (duplicate PHP cards) | Clustering / selection. | A pipeline change. |
| H-05 ("Notable"), H-06 (reason line), H-16 (wrong chips) | `src/lib/story.ts` bands, `reasonFor`, topic attribution — the S9 / `audit:topic-attribution` families, unchanged by this wave. | Already owned elsewhere; re-scored here only so the next audit has a baseline. |
| X-02 (volume promise) | Landing copy — owner positioning. | A product decision, not a fix. |

---

## 8b. What landed during this run — measured again on the next deploy

**The window.** Every measurement in §3–§7 was taken `05:43–06:05Z` against the build deployed at `04:57:15Z` (`72f85b7`, PRs #57 + #59). Two more PRs merged while the audit was running: **#61** (`editorial.ts`, `server/briefing.ts`, merged `06:00:45Z`, **deployed `06:05:38Z`**) and **#62** (a docs file only). Three surfaces were re-captured on the new build at `06:07–06:12Z`, because a reader opening the product now gets that one.

| row | status on the new build | evidence (capture) |
| --- | --- | --- |
| H-06 | **fixed** | Reason lines no longer collapse to one sentence: `You follow NVIDIA.` ×8, `You follow Developer tools.` ×2, `You follow AI.`, `You follow OpenAI.`, `You follow Cybersecurity.`, and five variants of `You follow AI — this card is about Funding.` / `You follow AI — this card is about Energy, Music, Consumer tech, and Hardware.` / `You follow AI — this card is about Education.` / `You follow World — this card is about Transport and Health.` (`feed_desktop_post61.txt`). The repetition that remains (8 identical NVIDIA lines) is caused by 7 of 17 cards coming from NVIDIA's own blog — N-06, not the line. |
| I-09, I-10 | still present | `August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.` and `As a result of the leak and pre-announcement around 20:00 UTC, Calif, one of the security firms that had reported the issues mistakenly published a video.` are both still on the page (`story_a3e60b09_post61.txt`). |
| I-11 | still present (reduced) | Same page, same date fragments and the same `PoCs (exploitation proof of concepts)` parenthesis; the order is still ascending. |
| I-03 | fixed | `perform operational technology (OT) system reconnaissance` unchanged (`story_11ecd424_post61.txt`). |

**The one thing this run would put in front of the owner.** The chronology fix in #61 is in main and deployed, and the reader's page did not change — because a story page's **opening sentence is the delivered `digest_items.summary`**, not this request's composition (ruling #11). That is the same mechanism that makes I-01 and I-13 unmeasurable in §G, and it means **a composer fix to an opening cannot heal a story the reader has already received**: it applies only to stories first briefed after the deploy. Either the opening may be recomposed at read time (a ruling, not a patch), or the already-delivered pages stay as they were delivered — in which case the audit's I-09/I-13 rows can only be closed by a re-brief. Recorded here rather than as a finding, because the choice is a decision, not a defect.

---

## 9. Findings that cannot be measured on this build — §G

The reader's edition was built `2026-10-22T22:55:38Z`; the wave deployed `2026-10-23T04:57:15Z`. These strings are stored in that build (`digest_items.summary`, `events.title`, `events.what_happened`), and the story page's opening is that same stored sentence by design (ruling #11). **They are not scored as fixed or as still present, because this run cannot tell whether the deployed code changes them.** Each is quoted live, with its capture, so the next audit can compare against a page built after the fixes.

| # | quote as the reader meets it today (capture) | why it is not measurable | what to measure it on |
| --- | --- | --- | --- |
| I-01 | `The Register reports that when it comes to cyberattacks that shut down power grids, drinking-water systems, and other critical infrastructure, AI doesn’t – yet – turn script kiddies into sophisticated, nation-state attackers.[1]` (`st-11ecd424`) | The story opening is the delivered `digest_items.summary`, not this request's composition. | The next edition built after the merge, or a re-briefed event. |
| I-13 | `W3Techs, a survey service, says that the PHP programming language is used by “69.3 percent of all the websites whose server-side programming language we know,” including popular sites like Wikipedia and WordPress.` (`st-f937622f`) | Same: the deck *is* the stored sentence. The composer's deck-demotion rule (`I-13` in PR #57) cannot be observed on it. | A story first briefed after the merge. |
| B-04 | *(no "Why it matters" line prints anywhere on the current edition)* | All 17 `why_it_matters` are empty in this build, so the ladder's output is absent rather than fixed. | The next edition, where the ladder writes a line. |
| H-01, H-02, H-03, H-04, H-07, H-08, H-09, H-10, H-11, H-12, H-13, H-14, H-15, H-18 | the card headlines and summaries on `feed-desktop` / `brief-desktop` | Every one is a stored source headline or a stored `digest_items.summary`; a composer change cannot appear until a new build. | The next edition built after the merge. |
| H-17 | `19 signals collected. Topics you skip fade, topics you open rise.` — **not present** on the current feed | The sentence does not occur on this build at all, so it cannot be scored either way. | Wherever it renders next; nothing on this page confirms or removes it. |

**One further caution.** The editions compared here are not the same 25 stories: the first audit read the 21 October build (25 items), this one reads the 22 October build (17 items). Counts in §3 and §4 are for the 17-item edition on purpose, and no percentage in this file is carried over from the first audit.

---

## Appendix A — the measured inventory

All numbers below are measured on the captures named in §1 or on read-only rows from `digests` / `digest_items` / `events`.

- **Edition under audit:** digest `fab11fdf`, scheduled `2026-10-22T22:30Z`, generated `2026-10-22T22:55:38.672Z`, 17 items, status `ready`, `generation_failure_reason` = `17 storys using a derived inclusion line; 17 storys shipped with no story-specific line; 16 withheld (primary-source, unbriefable)`.
- **Deploy under audit:** `72f85b7` → run `39902369664`, job *Deploy to Cloudflare Workers* completed `2026-10-23T04:57:15Z`.
- **Feed:** 17 cards, `Medium 7 · Notable 10 · High 0`, reason lines 17 (9 distinct; `You follow AI.` ×4), `Read →` ×17, `Save` ×17, h2 ×18 (17 cards + the device drawer), h3 ×0.
- **Briefing:** 4 groups (6 · 5 · 2 · 4 = 17), h1 ×1, h2 ×1 (deck header) + 1 (device drawer), h3 ×17 (all wrapping a link), group labels ×4 as `<p role="heading" aria-level="3">` (same level as the 17 item headings — N-04), bands `Medium 7 · Notable 10`, `Read →` ×17, `Save` ×17.
- **Briefing outlets:** `NVIDIA BLOG` ×7, `THE REGISTER` ×3, then one each of `THE HACKER NEWS`, `MICROSOFT RESEARCH`, `PHYS.ORG - LATEST SCIENCE AND TECHNOLOGY NEWS STORIES`, `AL JAZEERA`, `BUSINESS LINE - HOME`, `THE VERGE`, `FRANCE 24`.
- **Attribution in summaries:** 5 of 17 contain `reports that` / `according to` / `says`; 0 open with one (stored strings — §G).
- **Title Case headlines:** 6 of 17 at ≥0.83 capitalised-word share (stored strings — §G).
- **Rail labels:** `BASED ON 8 PUBLISHERS · 9 REPORTS` (card 12, 8 distinct outlets, 9 rows, Al Jazeera twice); `BASED ON 1 SOURCE` (cards 06, 09).
- **Rail scores:** `Relevance 10.0 / 10 · Importance 2.0 / 10 · Novelty 7.0 / 10` on both PHP pages; `6.0 / 10` importance on card 12.
- **Story pager:** `9 of 17` and `9 of 17 in your nyuz`, `PREVIOUS` / `NEXT` naming the actual adjacent headlines.
- **Layout:** 0 clipped or overflowing elements on feed, briefing and story page at 360×780.
- **Story availability:** card 12 (`ed2f6875`) returned Cloudflare `Error 1102` on 2 of 5 loads within three minutes (`a4ee7e05…`, `a4ee7e06…`), and rendered on the other 3.

## Appendix B — provenance and the quote check

Captures are raw `document.body.innerText` files taken during this run and kept out of the repository (the repository has no captures directory in git), in the scratch workspace:

| capture | page | viewport |
| --- | --- | --- |
| `feed_desktop.txt` / `feed_360.txt` | `/dashboard` | 1440×900 / 360×780 |
| `briefing_desktop.txt` / `briefing_360.txt` | `/dashboard/briefing` | 1440×900 / 360×780 |
| `briefing_archive.txt` | `/dashboard/briefing?digest=4a6b2ad2-857a-4680-8fc7-e6f88065f534` | 1440×900 |
| `landing.txt` | `/` | 1440×900 |
| `story_11ecd424_desktop.txt` | `/dashboard/story/11ecd424-ef90-46d6-aea1-2e8a1878bdfd` | 1440×900 |
| `story_a3e60b09_desktop.txt` | `/dashboard/story/a3e60b09-757a-4b32-8c63-8b106d8affeb` | 1440×900 |
| `story_f937622f_desktop.txt` | `/dashboard/story/f937622f-d137-4ac5-b465-37561586abbc` | 1440×900 |
| `story_ed2f6875_desktop.txt` | `/dashboard/story/ed2f6875-4dbf-49aa-83e0-f0ea2025d259` | 1440×900 |
| `story_ed2f6875_error.txt` | same URL, failing load | 1440×900 |
| `story_8766cb0f_desktop.txt` / `_360.txt` | `/dashboard/story/8766cb0f-11ba-4202-9261-510e9988877a` | 1440×900 / 360×780 |
| `story_4001e8a2_desktop.txt` | `/dashboard/story/4001e8a2-10d8-44f3-a637-900e87954ff5` | 1440×900 |
| `feed_desktop_post61.txt` | `/dashboard`, after the `06:05:38Z` deploy | 1440×900 |
| `story_a3e60b09_post61.txt`, `story_11ecd424_post61.txt` | the two story pages, after the same deploy | 1440×900 |

**The quote check.** Every quotation in §3–§8b was extracted from the named capture and compared as a substring by script, which fails if a marker is absent: **49 backticked spans across the tables, 46 of them page text and 3 capture filenames, 0 page strings missing**. One marker, `August 24, 2026: …[1]`, was corrected to the live string — the citation marker sits on the following sentence. Nothing in this file is paraphrased and nothing is reconstructed from the code.

**Not covered:** the alerts surface, the history list, email and push rendering, the admin console, the marketing pages beyond the one promise quoted in X-02, and colour/typography (the design audit owns those).
