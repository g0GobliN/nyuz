# Reader clarity audit — the Wikipedia test on the live product

**Date:** 2026-10-22 (JST). **Captured:** 08:31–08:55Z, on the deployed origin.
**Origin:** `https://nyuz.grgvishal-gurung17.workers.dev` (the product's origin; `nyuz.app` does not resolve — a stage condition, not a defect).
**Scope:** the prose a reader actually receives on three surfaces — the home feed, the briefing, and a story page opened from it.
**Verdict:** **43 findings — 4 blockers, 26 should-fix, 13 polish.** The blockers are all on one surface (a composed story page); the feed and the briefing are understandable but carry machine voice, unexplained jargon and one duplicated story.

No code, copy or content was changed by this task. It is an audit; the fixes are separate.

| surface | blocker | should-fix | polish | total |
| --- | --- | --- | --- | --- |
| Home feed `/dashboard` | 0 | 12 | 6 | 18 |
| Briefing `/dashboard/briefing` | 0 | 5 | 1 | 6 |
| Inside (story page) `/dashboard/story/<id>` | 4 | 7 | 6 | 17 |
| Cross-surface (two surfaces at once) | 0 | 2 | 0 | 2 |
| **total** | **4** | **26** | **13** | **43** |

---

## 1. How these pages were read

**Session.** `/dashboard`, `/dashboard/briefing` and `/dashboard/story/<id>` are behind a reader session: logged out, the server returns 200 with the single line `Checking your session…` and no content. The pages were read as the one account that has a delivered briefing (the owner's own), signed in with a Supabase magic link generated server-side — no password, no email sent, no product content edited. The panel above the page still reads "10 of 10 used" and offers "Register this device", i.e. this browser was not added to the account's device list.

**Viewports.** 639×906 (the browser's default headless size), 1440×900 and 360×780, set through CDP device metrics. Content is identical at all three; the only layout difference at 360 is that card headlines wrap to three lines.

**Capture method.** `document.body.innerText` after the page had settled (the briefing's 25 cards present, the story's body rendered). **Every quotation in this file was extracted literally from those captures and machine-checked as a substring of the capture it names** (appendix B). Nothing is paraphrased, and nothing is reconstructed from the code.

**Two artefacts excluded, deliberately.** The `🐴` prefix in browser tab titles is injected by the reading browser, not the product — the server's own `<title>` is `nyuz — Stop searching. Start knowing.` The "Registered devices · 10 of 10 used" panel above every dashboard page is this account's device cap, recorded as an observation rather than a finding; the "Nyuz works better from your Home Screen" install card appears for the same reason (first visit in this browser) and was not audited.

**What was read, exactly.** Home feed and briefing: the 25 items of digest `7268ba11` (scheduled `2026-10-21T22:30Z`, i.e. 07:30 JST on 22 October, status `ready`). Story pages: card 01 (`11ecd424`, one source, 7 paragraphs), card 12 (`ed2f6875`, the only multi-publisher card), and cards 06 and 09 (`a3e60b09`, `f937622f`, the two PHP-security cards). The archive: the 20 October briefing `4a6b2ad2`, opened the way a reader opens it, from History.

**The same 25 stories, in the same order, on the feed and the briefing** — verified by locating all 25 headlines in both captures in order.

---

## 2. The test applied

For every quoted block, six questions, from the owner's bar ("take Wikipedia as the example: it should be clean and understandable to read"):

1. Can a smart 15-year-old with no prior context understand it on first read?
2. Is every acronym, product name and piece of jargon explained at first use, or replaced?
3. Does every sentence have a subject the reader can identify — no "this", "it" or "the move" pointing at nothing?
4. Is the structure scannable — a heading, then one idea per paragraph, no wall of text?
5. Does the text say *why this matters* in plain words, or only *what happened*?
6. Is anything repetitive, machine-sounding or padded?

Severity, as the card defines it:

- **blocker** — a reader cannot understand the page.
- **should-fix** — the reader can get through it, but the sentence, label or claim is wrong, unexplained or self-contradicting.
- **polish** — it reads, but it costs the reader something small.

---

## 3. Home feed — `/dashboard`

The card list a signed-in reader lands on: a greeting, the count ("Your nyuz found 25 things worth knowing."), "Read as a briefing", then 25 numbered cards. Each card is source, importance band, headline, one-sentence summary, reason line, time, topic chips, `Read →`, `Save`.

Quotes below are from `https://nyuz.grgvishal-gurung17.workers.dev/dashboard` at 639×906. The same text was captured at 1440×900 and 360×780; only line wrapping changes (a 270 px card wraps a headline to three lines).

### What the reader sees (literal, first screen)

```text
Good afternoon, goblin01.

Your nyuz found 25 things worth knowing.

Read as a briefing

Nyuz works better from your Home Screen

Faster launch, offline reading, cleaner navigation and the full reader experience. No App Store required.

Install Nyuz
Not now
01
THE REGISTER
Medium
AI has 'potential' to turn script kiddies into sophisticated infrastructure attackers

The Register reports that when it comes to cyberattacks that shut down power grids, drinking-water systems, and other critical infrastructure, AI doesn’t – yet – turn script kiddies into sophisticated, nation-state attackers.

Why you're seeing this · You follow World, AI, and Cybersecurity.

Yesterday · 21:00
AI
Energy
Cybersecurity
Startups
World
Read →
```

### Findings

| # | quote (verbatim) | what is wrong | suggested rewrite | severity |
| --- | --- | --- | --- | --- |
| H-01 | AI has 'potential' to turn script kiddies into sophisticated infrastructure attackers | "Script kiddies" is the subject of the card and is never explained; the scare quotes around 'potential' are the outlet's hedge, not a fact the reader can use. A reader who does not already follow security news cannot tell whether this is a warning, a study result or a vendor pitch. | "AI is helping amateur hackers plan attacks on power grids and water systems" (the body says the test measured how well AI models choose attack steps, so the headline can say that). | **should-fix** |
| H-02 | The Register reports that when it comes to cyberattacks that shut down power grids, drinking-water systems, and other critical infrastructure, AI doesn’t – yet – turn script kiddies into sophisticated, nation-state attackers. | The sentence’s subject does not arrive until word 21: the first 20 words are "The Register reports that when it comes to cyberattacks that shut down power grids, drinking-water systems, and other critical infrastructure", a clause carrying no news. The outlet is printed directly above the headline, so the attribution spends the most valuable sentence repeating it. The finding is also buried inside a negation and two en dashes ("doesn’t – yet – turn"). | "AI is not yet turning amateur hackers into nation-state-grade attackers, a security firm’s tests found — but it does make power-grid and water-system attacks easier to plan." | **should-fix** |
| H-03 | The Register reports that while open models provide enterprises and governments a path toward sovereign AI, Nvidia's models are somewhat unique in how they're released.<br>Peter Steinberger, member of technical staff at OpenAI and the creator of OpenClaw, estimates that he spent around $10 million in tokens running AI workloads in September 2026, according to The Register. | 9 of the 25 summaries carry an attribution phrase ("reports that", "according to", "says") and 3 open with one, while the outlet is already on the card header. In the second example the fact a reader wants ($10 million in tokens) arrives after a job title and before a trailing attribution, and "tokens" is never explained. | "Nvidia argues open-weight models are the route to sovereign AI — and releases its own differently." / "One engineer says he spent $10 million running AI agents in September. Tokens are the units AI models bill by." | **should-fix** |
| H-04 | Nvidia picks OpenShell to tame AI gents | "gents" is not a word a reader can resolve; the card’s own body says "keep corporate AI agents in line". Checked against the stored row: both the article title nyuz ingested and its URL slug carry "gents", so the typo is The Register’s own and nyuz reproduced it faithfully. The defect is that a source headline is printed as if it were nyuz’s own sentence, with no copy pass over it. | "Nvidia picks OpenShell to keep corporate AI agents in line" | **should-fix** |
| H-05 | Notable | 14 of the 25 cards carry "Notable" (measured on the rendered feed: Medium 9, High 2, Notable 14), and it is the *lowest* band, not one of the better ones: `importanceBand` returns Notable below 3, Medium at 3, High at 6 (`src/lib/story.ts:66-69`). The scale also mixes registers — a level ("High"), a size ("Medium") and a compliment ("Notable") — so the three cannot be put in order by reading them. | "Low / Medium / High", or drop the badge entirely: 14 of 25 cards are in the bottom band, so the word is doing no work. | **should-fix** |
| H-06 | Why you're seeing this · You follow AI. | All 25 reason lines on both surfaces name AI and 8 are exactly this one (measured on the rendered feed and briefing), so the line that exists to explain why a story is here distinguishes nothing. On this feed "You follow AI" is the same sentence 25 times. | Name the narrowest matching interest ("You follow OpenAI", "You follow Anthropic"), or omit the line when the match is the reader’s whole feed. | **polish** |
| H-07 | Today's PHP Security Release, and How We're Strengthening PHP Security | "We" has no speaker: the header says SIMON WILLISON, but the headline’s "we" is the PHP project’s voice quoted from a personal blog. "Today’s" is the source’s publication day; a reader opening the briefing the next morning is told about "today" on a day-old card. | "PHP shipped an emergency security release; here is how the project handled the disclosure" | **should-fix** |
| H-08 | The spec is the new code, so brush up on your prose, says Kaseya CTO | Three unexplained things in one line — "spec", the metaphor "is the new code", and "Kaseya" — and the summary under it describes the CTO’s tenure rather than the claim in the headline. A reader who does not know what a spec is in software cannot decode the card at all. | "A software CEO says clear specifications now matter more than code — and writers should practise them" | **should-fix** |
| H-09 | MPs urge UK government to play venture capitalist with taxpayer-funded tech | "MPs" is never expanded (members of Parliament) and "play venture capitalist" is figurative; the summary then tells the story in plain words, so the headline is the only barrier left. | "British lawmakers want taxpayers to own a stake in the tech companies they fund" | **polish** |
| H-10 | AFP warns Australia of ‘tsunami of youth crime’ and radicalisation accelerated by AI | AFP is a news agency (Agence France-Presse), not an authority that warns, and it is unexpanded. The body says "a parliamentary inquiry has heard", so the headline attributes a warning to a wire service that was reporting somebody else’s evidence. | "Australia’s parliament hears AI is speeding up radicalisation, as inquiry witnesses warn of a ‘tsunami’ of youth crime" | **should-fix** |
| H-11 | AMD and Intel will work together to create a single PyTorch code path for AI inference on CPUs<br>The oneDNN backend is used for CPU inference, and it's built to accelerate that workload for the latest Intel (and now AMD) chips in frameworks like PyTorch. | PyTorch, "code path", "inference", "CPUs" and then "oneDNN backend" in the summary: five technical names and no sentence saying why two rivals cooperating matters to a reader. The summary explains the mechanism to someone who already knows the mechanism. | "AMD and Intel are teaming up so the same AI software runs on either company’s chips without changes" / "Today a program written for one of their chips has to be rebuilt for the other; the two companies want that to stop." | **should-fix** |
| H-12 | Google Cloud and NVIDIA Announce General Availability of NVIDIA Vera Rubin Infrastructure | A press-release headline: Title Case, "General Availability" (vendor jargon for "you can now buy it"), NVIDIA named twice, "Vera Rubin" unexplained. The summary underneath is plain, which makes the headline the only obstacle. | "Google Cloud will offer Nvidia’s new Vera Rubin chips, up to 960,000 of them across its sites" | **polish** |
| H-13 | NVIDIA Kumo Relational Outperforms Supervised Machine Learning on Relational Data, No Training Required | Five pieces of jargon in one line ("Kumo Relational", "supervised machine learning", "relational data", "few-shot", "benchmarks"), Title Case, and no statement of what changes for a reader. The summary repeats the same terms rather than translating them. | "Nvidia’s Kumo model can predict entries in a company database without being trained on that data first" | **should-fix** |
| H-14 | ASML and other critical semiconductor equipment suppliers expedite shipments to Musk's Terafab | ASML and Terafab are both load-bearing names and both unexplained; "critical semiconductor equipment suppliers" is a noun pile. The summary defines Terafab but never says what ASML is, so the reader has to infer that it is a company. | "Chip-tool maker ASML is rushing equipment to Musk’s new Terafab factory" | **should-fix** |
| H-15 | AI will eat a fifth of tech budgets in 2027, but don't expect it to pay for itself<br>More than half of CIOs are likely to miss their AI-related ROI targets in 2027, according to Forrester. | The one sentence that has to land, the summary, carries two unexpanded acronyms (CIOs, ROI). "Eat a fifth" also asks the reader to convert a metaphor into 20%. | "AI will take a fifth of tech budgets in 2027, and more than half of IT chiefs expect no return on it" | **polish** |
| H-16 | Economy<br>Music<br>Politics<br>Robotics | These are the topic chips on card 04, "GTC Berlin 2026: Live Updates From NVIDIA CEO Jensen Huang’s Keynote". "Music" and "Politics" are not in that story, and the chips are what a reader uses to check the reason line ("You follow AI and NVIDIA"). A wrong chip makes a right reason look wrong. | Chips only for topics the event actually carries (AI · NVIDIA · Hardware), and fix the topic assignment that produced Music. | **should-fix** |
| H-17 | 19 signals collected. Topics you skip fade, topics you open rise. | "Signals" is the product’s internal word for what it counted. The reader is not told what a signal is, what was counted, or where to see them, so the sentence describes a mechanism instead of telling them anything they can act on. | "We learned from the 19 stories you opened or skipped this week. Open a topic to see more of it; skip one to see less." | **polish** |
| H-18 | Generative AI Is Erasing Behavioral Tells, Weakening Behavior-Only Detection, Proofpoint Reports | 5 of the 25 headlines are Title Case vendor/PR voice while 20 are sentence case, so the feed reads as though two publications were pasted together. This one also stacks "behavioral tells" and "behavior-only detection" with no explanation. | "AI is erasing the behavioural clues security tools rely on, Proofpoint says" | **polish** |

### Surface verdict

The shape is good and the volume is not the problem: 25 cards, median 25-word summaries, one idea per card. The problem is that **the card speaks in its sources' voices** — press-release Title Case, wire-service attribution, and jargon the reader is assumed to own ("script kiddies", "spec", "OT", "PyTorch", "oneDNN", "General Availability"). The two labels the product adds itself both misfire: the importance scale puts "Notable" at the bottom, and the reason line says "You follow AI" on all 25 cards.

---

## 4. Briefing — `/dashboard/briefing`

The same 25 stories as one edition: eyebrow `DELIVERED`, title "Your briefing, as it was assembled.", sub-line "Built from today's coverage at 07:30. Nothing here was reordered for the web.", chips (`Today · 25`, `Saved · 1`, `Email on`, `Edition · 07:30`), the deck header "YOUR 7:30 AM BRIEF" / "25 things worth knowing, goblin01.", then 25 plain cards and a channel footer.

Quotes below are from `https://nyuz.grgvishal-gurung17.workers.dev/dashboard/briefing` at 639×906, identical at 1440×900; the archive quote (B-02) is from `/dashboard/briefing?digest=4a6b2ad2-857a-4680-8fc7-e6f88065f534` at 1440×900.

### What the reader sees (literal, first screen)

```text
Your briefing, as it was assembled.

Built from today's coverage at 07:30. Nothing here was reordered for the web.

Today · 25
Saved · 1
Email on
Edition · 07:30

YOUR 7:30 AM BRIEF

25 things worth knowing, goblin01.
01
THE REGISTER
AI has 'potential' to turn script kiddies into sophisticated infrastructure attackers

The Register reports that when it comes to cyberattacks that shut down power grids, drinking-water systems, and other critical infrastructure, AI doesn’t – yet – turn script kiddies into sophisticated, nation-state attackers.

Why you're seeing this · You follow World, AI, and Cybersecurity.
```

### The archive check

Opened from History, the 20 October briefing renders `DELIVERED · OCTOBER 20` and the chip `Tuesday · 25` — the date labelling works. But its sub-line still reads "Built from **today's** coverage at 07:30." on a page that is two days old (finding B-02). An unknown digest id in the URL falls back to `Today · 25` with no date at all; that path is not reachable from History and is recorded here only so it is not mistaken for the archive working.

### Findings

| # | quote (verbatim) | what is wrong | suggested rewrite | severity |
| --- | --- | --- | --- | --- |
| B-01 | DELIVERED | Delivered where? This briefing’s email delivery failed (deliveries row: email → failed, "Resend 401: API key is invalid"; push → sent), and the chip beside it says "Email on". "DELIVERED" is the one word on the page that claims a send, and the sentence under it says the briefing was assembled, not sent. | "Today’s edition · 22 October", or "Ready at 07:30" — a word about state, not delivery. | **should-fix** |
| B-02 | Built from today's coverage at 07:30. Nothing here was reordered for the web. | On the 20 October briefing, reached from History, this sentence still says "today’s coverage". The page correctly names the day in its eyebrow ("DELIVERED · OCTOBER 20") and then contradicts it one line later — the worst place for a "today" with no anchor, because the reader is deciding whether they are looking at old news. | "Built from coverage published before 07:30 on 20 October. Nothing here was reordered for the web." | **should-fix** |
| B-03 | 25 things worth knowing, goblin01. | That is the entire introduction. There is no sentence saying what today’s briefing is about, no grouping and no heading between items — 25 cards in one list, and the only structure is the item number (measured: 25 list items, one h1, one h3, no h2 inside the list). A reader with two minutes cannot tell which three of the 25 matter. | A one-sentence lede naming the day’s through-line, then two to four groups with headings ("AI and chips · 11 stories", "Security · 4"), each keeping the current order inside the group. | **should-fix** |
| B-04 | Why it matters · Four publishers reported this. | The label promises significance and the sentence delivers a source count — the same fact the line "Based on 4 sources" prints directly underneath. It is also the only "Why it matters" line in the whole briefing (24 of 25 cards print none), so it is the only model the reader gets for what the phrase means. | Either drop the heading for coverage facts (the "Based on" line already says it), or write the significance: "Both companies are Musk’s, so one board would control his rockets, satellites and cars." | **should-fix** |
| B-05 | Today's PHP Security Release, and How We're Strengthening PHP Security<br>PHP: The three letters that shut down sites all over the internet today | The same real-world story twice, at #6 and #9 (Simon Willison’s write-up and The Verge’s). The GTC Berlin keynote is also carried twice, at #4 (NVIDIA’s live blog) and #7 (The Register’s robot ducks). Two of the 25 slots are repeats and the reader is never told they are the same event. | Cluster them the way #12 already merges four publishers into one card, or say so on the first card: "Also covered by The Verge". | **should-fix** |
| B-06 | Email on | Read as a status, "Email on" says the email channel is working; the delivery row for this briefing says otherwise. The code comment is explicit that the chip claims the preference and nothing else, but a chip beside "Today · 25", under a page headed DELIVERED, reads as delivery state. This is the S8 residual and it is a copy decision for the arbiter, not a forge fix. | "Email · turned on (sending resumes at launch)", or move the preference to Delivery settings where it is a setting rather than a status. | **polish** |

### Surface verdict

The briefing is calmer than the feed and its chrome is mostly honest (the channel list is a channel list, not a receipt). What it lacks is an introduction and any structure: 25 cards in one list, with the only "Why it matters" in the whole edition printing a source count. Two of the 25 slots are the same story the reader already read three cards earlier.

---

## 5. Inside — a story page from the briefing

Read: card 01 (`/dashboard/story/11ecd424-ef90-46d6-aea1-2e8a1878bdfd`, one source), card 12 (`ed2f6875`, four publishers), and the two PHP-security cards (`a3e60b09`, `f937622f`). Page furniture: "Back to your nyuz", "1 of 25", topic · time · "2 min read", the body with `[n]` citations, a rail (`SCORING`, `BASED ON N SOURCES` + outlet/time rows, `WAS THIS USEFUL?`, `Save for later`), and `PREVIOUS`/`NEXT` with the next headline.

Quotes below are from `https://nyuz.grgvishal-gurung17.workers.dev/dashboard/story/<id>`: story 01 at 639×906, stories 12, 06 and 09 at 1440×900. Which story each row quotes: I-01–I-05 card 01; I-06, I-07, I-08, I-15, I-16 card 12; I-09–I-11 card 06; I-12–I-14 card 09; I-17 is the caveat printed on every story page.

### What the reader sees (literal, story 01, first three paragraphs)

```text
1 of 25
AI has 'potential' to turn script kiddies into sophisticated infrastructure attackers

AI
·
Yesterday · 21:00
·
2 min read

The Register reports that when it comes to cyberattacks that shut down power grids, drinking-water systems, and other critical infrastructure, AI doesn’t – yet – turn script kiddies into sophisticated, nation-state attackers.[1]

"One thing that we've relied on for years is security by obscurity when it comes to utilities," said Steve Swick, former chief information security officer at American Electric Power. AI makes it easier and faster for human attackers to target critical infrastructure, gain access to utilities and manufacturing plants, and perform OT system reconnaissance.[1]

“Basic access can recon documentation, and distill through that documentation very quickly to find out critical design features of your plant and facility,” said Paul Shaver, head of OT at Armadin, during the panel. Armadin is Kevin Mandia’s new security startup that uses swarms of autonomous AI agents to simulate real-world cyberattacks.[1]
```

### Findings

| # | quote (verbatim) | what is wrong | suggested rewrite | severity |
| --- | --- | --- | --- | --- |
| I-01 | AI doesn’t – yet – turn script kiddies into sophisticated, nation-state attackers.[1] | The story page opens on a negation with two parenthetical dashes and ends the sentence on a citation marker. A reader has to parse "doesn’t – yet – turn X into Y" to find the claim, and the claim is what AI does *not* do. | Open on what the tests found: "AI models can already plan attacks on power grids and water systems, a security firm’s tests found — though they are not yet at nation-state level." | **should-fix** |
| I-02 | "One thing that we've relied on for years is security by obscurity when it comes to utilities," said Steve Swick | A 17-word quoted sentence that opens the second paragraph, with "security by obscurity" unexplained and the speaker’s name arriving only after it. The reader meets an unattributed quotation before they know who is talking. | "Utilities have long counted on attackers not knowing how their systems are built, said Steve Swick, a former chief information security officer at American Electric Power." | **should-fix** |
| I-03 | OT system reconnaissance<br>OT hackers<br>OT environments | "OT" is never expanded — not in the paragraph, not in the source rail, not on the page. It is the story’s key noun (the systems that run power plants and water works), and it appears three times; a reader who does not already know the acronym is reading around a hole. | Expand at first use: "operational technology (OT) — the computers that run power plants, water works and factories". | **should-fix** |
| I-04 | Basic access can recon documentation, and distill through that documentation very quickly to find out critical design features of your plant and facility | A direct quotation that is not a grammatical sentence ("can recon documentation", "distill through that documentation") and has no editorial frame. Whether it is verbatim speech or a paraphrase, the reader cannot tell, and as printed it reads as broken English rather than as a person talking. | Quote it as speech and repair only what a transcriber may repair: "“With basic access you can read the documentation and pull out the critical design features of your plant very quickly,” Shaver said." | **should-fix** |
| I-05 | Armadin is Kevin Mandia’s new security startup that uses swarms of autonomous AI agents to simulate real-world cyberattacks. | "Kevin Mandia" is introduced only as a possessor, so the reader is expected to know who he is; the sentence’s job is to explain Armadin and it spends half its length on a name that is never placed. | "Armadin, a startup founded by the security executive Kevin Mandia, uses swarms of autonomous AI agents to simulate real-world cyberattacks." | **polish** |
| I-06 | BASED ON 4 SOURCES | The label says four and the list under it has nine rows across eight outlets — The Verge, Ars Technica, BBC Science, Al Jazeera, Al Jazeera, BBC World, Engadget, France 24, The Guardian World. The number comes from `events.publisher_count` and the list from the event’s articles (`story-article.tsx:92`, `briefing.ts:1434`), so two different measures are both labelled "sources"; Al Jazeera appears twice, which reads as a bug on its own. | One measure, one label: "Based on 4 publishers · 9 reports", with duplicate outlets collapsed in the list or marked ("Al Jazeera × 2"). | **should-fix** |
| I-07 | The Verge<br>21:30 | A time with no date and no label. The rail is the reader’s only way to check the reporting, and "The Verge 21:30" does not say whether that is publication time, fetch time, or yesterday’s. | "The Verge · published 20 Oct, 21:30" (and the same for each row). | **polish** |
| I-08 | Relevance<br>100%<br>Importance<br>60%<br>Novelty<br>50% | Three percentages with no legend, on a page whose prose uses none. S9 already logged the two-scale problem (0–100% here, 0–10 in the alerts copy); the new evidence is that the numbers contradict the story: story #09, a critical vulnerability affecting "basically any site running PHP", scores Importance 20% (bottom band, "Notable"), and this one scores Relevance 100% for a card the reader may not care about. | Name the scale and the meaning in one line ("Importance 6/10 — how much this changes for people who follow it"), or express the rail in words as S9’s option A rules. | **should-fix** |
| I-09 | August 24, 2026: Wiz Research reports the vulnerabilities to the PHP security team.[1] | The opening sentence of the story is a date fragment with no subject, no verb of its own and no event: it names a date six weeks before the rest of the page, and the reader is told that somebody "reports the vulnerabilities" before being told there are vulnerabilities, what they do, or that a release happened. A reader cannot understand the page from its opening. | "Researchers at Wiz found two critical flaws in PHP, the language that runs much of the web. The PHP project patched them on 21 October." | **blocker** |
| I-10 | As a result of the leak and pre-announcement around 20:00 UTC, Calif, one of the security firms that had reported the issues mistakenly published a video. | "the leak" and "Calif" have not been introduced: the sentence opens with a consequence of something the reader has not been told, then names a company with no description, then delivers a video. The main clause is about the video; the thing that matters (the flaw went public early) is a subordinate phrase. | "The flaws leaked earlier than planned. One of the firms that had reported them, Calif, accidentally published a video about the issue, so the PHP project moved its announcement forward to 19:30 UTC." | **blocker** |
| I-11 | The video contributed to accelerated development of various PoCs (exploitation proof of concepts), which then increased circulation on October 21st. August 20, 2026: Unauthenticated RCE is confirmed against Drupal. | One paragraph holds a narrative ("The video contributed... October 21st") and then three bare date fragments in the wrong order: August 20 after October 21, September 21, October 21 again. "RCE" and "Drupal" are unexplained, and the reader is expected to rebuild the timeline themselves. This is the paragraph that is supposed to explain what happened. | One ordered timeline in plain sentences: "20 August: researchers confirm the flaw can be exploited against Drupal. 21 September: the PHP project acknowledges the reports and starts a coordinated fix. 20 October: the two CVE identifiers leak. 21 October: patched releases ship." | **blocker** |
| I-12 | Two bugs found with AI are behind major issues on 21 October 2026 for 4chan, DeviantArt, Wikipedia, and the blog where the bar around the corner posts pictures of people's dogs. | The sentence lists four victims and its last item is "the blog where the bar around the corner posts pictures of people’s dogs" — a clause with no referent that reads as a template artefact or an inside joke. A reader cannot tell whether it is a real site, a metaphor or a mistake, and it is the closing sentence of the story. | Name the site or drop the example: "Two AI-found bugs disrupted 4chan, DeviantArt and Wikipedia on 21 October." | **blocker** |
| I-13 | W3Techs, a survey service, says that the PHP programming language is used by “69.3 percent of all the websites whose server-side programming language we know,” including popular sites like Wikipedia and WordPress.[1] | The story opens on a market-share statistic, so the reader learns what happened only in the third paragraph ("two critical vulnerabilities"). The statistic is good supporting evidence in the wrong slot: it answers "how big is PHP" before the page has said why anyone should care. | Open with the event and keep the statistic for the second paragraph: "Two critical flaws in PHP, the language behind 69% of the websites whose server software is known, let attackers run code on servers without a password." | **should-fix** |
| I-14 | According to OpenAI, an AI security group called Calif identified a “critical” PHP flaw using GPT-5.6 Sol | Five names in one sentence (OpenAI, Calif, GPT-5.6 Sol, Wiz, Google) and only Wiz is placed ("Google-owned"). "GPT-5.6 Sol" is a model name the reader has no way to rank, and the sentence’s point — that AI found the flaw — is buried under them. | "An AI security group called Calif found the flaw using an AI model, OpenAI says; Google’s Wiz found it independently, also with AI." | **polish** |
| I-15 | Dan Sheehan said.<br>said investment analyst Sheehan from Telos Wealth Advisors | The same person appears twice under two identities: "Dan Sheehan said" with no role, then "investment analyst Sheehan from Telos Wealth Advisors". At first mention the reader does not know whether he is a participant, an analyst or a spokesperson; at second mention they have to work out he is the same man. | Introduce him once, with the role: "Dan Sheehan, an analyst at Telos Wealth Advisors, said...", and use "Sheehan" after that. | **polish** |
| I-16 | Earlier in October 2026, The Verge reports that Barclays published a client note suggesting a potential Tesla-SpaceX combination could be announced ahead of Tesla’s annual shareholder meeting scheduled for December 3, 2026. | Tense breaks inside one sentence: "Earlier in October 2026 ... reports that Barclays published". The reader is also given four dates (October 2026, December 3 2026, "earlier") in a paragraph about what may happen. | "In early October, Barclays told clients a Tesla-SpaceX combination could be announced before Tesla’s annual shareholder meeting on 3 December 2026, The Verge reported." | **polish** |
| I-17 | nyuz is not the source. Source descriptions may contain errors. Open the original reporting before acting on it. | Read the caveat as a reader would: it tells them the story they just read may be wrong, but not which parts came from the source and which were composed by nyuz. It is honest and it is also the page’s weakest sentence, because it shifts the whole verification burden onto the reader at the end. | Say where the text came from: "This summary is written by nyuz from 1 source. The quotations are the source’s own; open the original before acting on it." | **polish** |

### Surface verdict

Two of the four story pages read well: card 01's body is a real account with real quotes, and card 12's is organised around who said what. The two PHP pages do not — card 06 opens on a date fragment and its second paragraph refers to "the leak" and "Calif" before either exists, and its third paragraph is a timeline out of order; card 09 ends on a clause no reader can parse. Those four sentences are the audit's blockers. Everything else on this surface is the rail telling the reader numbers it never defines.

---

## 6. Cross-surface

| # | quote (verbatim) | what is wrong | suggested rewrite | severity |
| --- | --- | --- | --- | --- |
| X-01 | Medium | The same 25 stories carry an importance band on the feed (every one of the 25 has one; "Medium" is this card’s) and none at all on the briefing — whose card header prints "01", the outlet and then the headline, so the surface that calls itself "as it was assembled" is not the surface that shows the band. The feed also gives every card "Read →" and "Save"; the briefing gives a headline link and nothing else. | One card, one set of facts: show the band on both, or on neither, and give the briefing the same two actions the feed has. | **should-fix** |
| X-02 | Most mornings that's five stories or fewer. Some mornings it's one. Occasionally it's none, and we tell you that rather than padding it out.<br>25 things worth knowing, goblin01. | The landing page promises "Most mornings that’s five stories or fewer. Some mornings it’s one. Occasionally it’s none", and the reader’s live briefing has 25 items on 22 October, 25 on 20 October and 16 on 9 October (History, measured). A reader who signed up on that sentence meets four to five times the promised volume on their first morning. | Either make the promise true (a shorter default briefing, with 25 available behind "read the full edition") or change the sentence to what the product actually does. | **should-fix** |

The feed and the briefing disagree about the same 25 stories (band, actions), and the marketing page promises a volume the product does not deliver. Both are clarity failures a reader experiences as "which page is telling me the truth?".

---

## 7. What is already good — do not regress it

- **The card shape works.** Headline, one plain sentence, then a reason line. Median summary 25 words, longest 40 — nothing on these pages is a wall of text, and no headline is truncated at 360 px (measured: no element with `text-overflow: ellipsis` overflows; a 270 px card wraps its headline to three lines).
- **The opening sentence is the card's sentence.** Story 01's page opens on exactly the line its card printed (`+ [1]`), which is ruling #11 working. A reader who taps a card never meets a different story.
- **Provenance is visible and honest.** Every card names its outlet in the header; every story page carries `[n]` citations that jump to the rail, and the rail names the outlet. "nyuz is not the source" is on the page rather than in a footer.
- **Single sources are not padded.** "Based on N sources" prints only when N > 1 (cards 12 and 21), so the corroboration claim is not turned into filler.
- **The reader always knows where they are.** "1 of 25", "12 of 25 in your nyuz", PREVIOUS/NEXT with the actual next headline, and a dated eyebrow on an archived briefing ("DELIVERED · OCTOBER 20").
- **Time is localised where it matters.** "Tomorrow · 07:30 · Asia/Tokyo" names the zone; card times are consistent within a day ("Yesterday · 21:00", "Today · 00:30").
- **One explanation is exactly right, and it is the model to copy.** Story 09 explains "unauthenticated remote code execution" in the same sentence: "(like running their own code, changing content, and accessing a site’s stored data without needing an administrator login or password)". That is what the rest of the jargon on these pages should look like.
- **The clustering is stated in plain words.** "4 sources → 1 event" on card 12 tells the reader what the product did, in five words.

---

## 8. Where the fixes belong

Nothing in this file changes code, copy or content. The findings route as follows, smallest first:

| finding class | where the fix belongs | why not here |
| --- | --- | --- |
| Source headlines and summaries printed verbatim with their errors (H-01, H-04, H-07, H-08, H-13, H-14, H-18, I-13, I-14) | A copy pass over the composer: either a headline policy (rewrite source headlines into nyuz’s own sentence) or a visible "as published by <outlet>" frame. Both are copy decisions for the arbiter. | It changes what every card says. |
| Jargon never expanded (H-11, H-14, I-03, I-14) | Same composer, with a first-use expansion rule. The story page’s body is composed from stored evidence, so the expansion has to happen where sentences are assembled, not in a glossary. | It is a rule about prose, not one string. |
| The "Notable" band (H-05) and the missing band on the briefing (X-01) | `src/lib/story.ts` + the two card components; S9’s ruling already covers the scale. | Copy and scale decision already ruled; implementation is a separate slice. |
| Reason lines that name only "AI" (H-06) | Topic assignment / the reason-line rule (`audit:topic-attribution` owns the family). | Needs a measured rule, not a one-word edit. |
| Wrong topic chips (H-16) | Topic assignment (`assignTopics` / `event_topics`). | Same. |
| Duplicate stories in one briefing (B-05) | Clustering / selection. | A pipeline change. |
| "DELIVERED", "Email on", "today’s coverage" on an archive (B-01, B-02, B-06) | Copy, and the arbiter: S8 is still open on the inbox framing. | Ruled to go to the arbiter, not to be patched locally. |
| No intro and no sections (B-03) | `BriefingPreview` / the composer. | A structure decision with a copy ruling behind it. |
| "Why it matters" printing a source count (B-04) | The significance ladder (gate 2, Leg A). Already measured: 1 of 25. | The known Leg A failure, not a new one. |
| "BASED ON 4 SOURCES" vs 9 rows (I-06) | `story.sources` vs `story.sourceList`: one measure or one label. | Small, but it changes a claim; needs a ruling on which number is the truth. |
| Broken chronology and unreadable sentences in a composed article (I-09, I-10, I-11, I-12) | The article composer (`composeArticle`) and its evidence ordering. These are the four blockers. | The composer needs a narrative-order rule, not sentence patches. |
| Story document title (observed live: `document.title` is `nyuz` on every story page — no headline, no site suffix; logged as P1 in the 2026-10-21 design audit, not re-scored here) | `src/routes/dashboard/story/$id.tsx` head. | Already logged as P1. |

---

## Appendix A — the measured inventory

- **25 items** in the briefing (`digests.item_count = 25`, digest `7268ba11`, scheduled 2026-10-21T22:30Z = 07:30 JST on 22 October, status `ready`).
- **Importance bands:** High 2, Medium 9, Notable 14 (`importanceBand`: >=6 High, >=3 Medium, <3 Notable, `src/lib/story.ts:66-69`).
- **Summaries:** 13–40 words, median 25. No card is a wall of text.
- **`why_it_matters`:** non-empty on **1 of 25** cards (card 12, the text "Four publishers reported this.").
- **Attribution habit:** 9 of 25 summaries contain "reports that" / "according to" / "says"; 3 open with one.
- **Headline voice:** 5 of 25 headlines are Title Case vendor/PR voice (capitalised-word share >= 0.83); 20 are sentence case.
- **Reason lines:** 25 of 25 name AI; 8 are exactly "You follow AI."; the longest is "You follow Developer tools, Claude, AI, and NVIDIA."
- **Duplicates:** #6 and #9 are the same PHP security release; #4 and #7 are the same GTC Berlin keynote. Each pair is two distinct `events` rows, one stored article each (verified in `articles`), so the pipeline saw four separate events where the reader sees two stories.
- **Story 12's source rail:** label "BASED ON 4 SOURCES", 9 report rows, 8 distinct outlet names, Al Jazeera twice (`events.publisher_count = 4`; `story-article.tsx:92`, `briefing.ts:1434`).
- **Structure:** briefing page has 1 `h1`, 1 `h3`, 0 `h2` inside the list, 25 `li`. The feed gives every card its own `h2` and an importance band; the briefing gives neither.

## Appendix B — provenance and the quote check

Captures, as raw text files taken during this run (kept out of the repository, which has no screenshots directory in git):

| capture | page | viewport |
| --- | --- | --- |
| `homefeed_mobile.txt` | `/dashboard` | 639×906 |
| `homefeed_360.txt` | `/dashboard` | 360×780 |
| `homefeed_desktop.txt` | `/dashboard` | 1440×900 |
| `briefing_mobile.txt` | `/dashboard/briefing` | 639×906 |
| `briefing_desktop.txt` | `/dashboard/briefing` | 1440×900 |
| `briefing_archive.txt` | `/dashboard/briefing?digest=4a6b2ad2…` | 1440×900 |
| `story01_mobile.txt` | `/dashboard/story/11ecd424…` | 639×906 |
| `story12_desktop.txt` | `/dashboard/story/ed2f6875…` | 1440×900 |
| `story06_desktop.txt` | `/dashboard/story/a3e60b09…` | 1440×900 |
| `story09_desktop.txt` | `/dashboard/story/f937622f…` | 1440×900 |
| `landing.txt` | `/` (logged out, `curl`) | n/a |

Each finding's quote is a slice of the named capture, extracted by its own start and end markers rather than retyped: the build fails if a marker is absent, so a quote cannot drift from the page. The 25-headline order check compares the briefing's and the feed's captures against the same list. Measured numbers in appendix A come from the stored rows (`digests`, `digest_items`, `events`, `articles`, `deliveries` — read-only) and from the rendered captures; each is attributed above.

**Not covered by this audit:** the marketing pages beyond the one promise quoted in X-02, the alerts surface, the archive list, email and push rendering, and colour/typography (the design audit owns those). The briefing was read in light theme only.
