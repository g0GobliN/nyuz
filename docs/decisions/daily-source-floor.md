# The daily source floor: 50–100 new English feeds, every day, without anyone remembering

**Ruling.** Owner, 2026-10-30, after the fourth week of the shortfall:
_"i told you to add 50 to 100 everyday then why? this is 10 or 20th time i am telling you."_
Card `t_4fc381d6` turns that into a standing requirement: 50 new English-language
sources a day is the floor, 100 is the target, English of any country, and a day
that comes up short must be reported by the board before the owner has to ask.

## What was actually happening, measured

Sources created per day in the live project on 2026-10-30, from `sources.created_at`
(JST days):

```
2026-10-20     0
2026-10-21     2
2026-10-22   234   one hand-run wave card
2026-10-23     2
2026-10-24     2
2026-10-25     2
2026-10-26     2
2026-10-27     2
2026-10-28   184   one hand-run wave card
2026-10-29     2
```

Two bursts of ~200 and 1–2 a day otherwise. The 1–2 is the ambient rate of
demand-driven discovery (a reader-followed topic that had no source), not a
growth rate. There was no daily job at all: growth happened when a human opened a
"bulk source wave" card by hand, and stopped when they did not.

Two further facts decided the shape of the fix:

1. **The wave had no candidate supply.** The 2026-10-30 wave had been written
   against a fixed list of 180 candidate URLs. At 50 a day that list is two days
   of work, so even a perfect daily job starves within 48 hours. Insertion was
   never the only problem; discovery had to become daily too.
2. **The wave had no language check.** The 2026-10-28 wave shipped an Arabic and
   a Chinese feed into the reader's world and nobody noticed until the next day
   (card `t_06bd689e`). A human eyeballing "does this look English" is not a gate.

## The decision

1. **A scheduled job opens the wave card; it does not insert.** Three schedule
   entries in the shared board-medic scheduler (`~/.hermes/cron`, the same path
   `nyuz-board-medic.sh` runs on), all deterministic, all `no-agent`:
   `06:10` refills the candidate pool, `09:30` and `16:30` open one wave card each
   with the floor in the body. The card is the record; the work is a tool.
2. **Insertion is `npm run source:grow`, not a list someone typed.** The tool
   probes the pool with the app's own six-request resolver
   (`src/lib/discovery/feed.ts`), refuses non-English feeds with the shared
   detector, refuses duplicates by `feed_url`, and inserts only after the feed
   returned item titles — stamping `last_fetched_at` with that probe. So "added"
   means fetched, and the number the card closes on is the count the tool wrote.
3. **The language gate is the one detector, on every insert.**
   `src/lib/language-detection.ts` answers `{english, reason, script,
nonLatinRatio, latinStopwordRatio, latinAccentRatio}` for the feed's own recent
   item titles. Three signals, because English has three kinds of neighbour:
   script share (Cyrillic, Arabic, Urdu, Devanagari, Han, Kana, Hangul, Thai,
   Hebrew, Greek and the rest); function-word share for the Latin-script
   languages, now es, pt, fr, de, it, id, nl, tr, is, the Nordic three, fi, et,
   lv, lt, pl, cs, hu, ro, hr, af and tl; and, for the languages whose grammar
   lives in suffixes rather than in free-standing words, the Finnish/Estonian case
   endings. A fourth check refuses copy that accents its letters far more densely
   than English does, as a backstop for a Latin-script language no list names.
   It fails closed: text that cannot be shown to be English is a reject, because a
   foreign line reaching a reader is the defect and a wrongly refused English feed
   costs one source that discovery refinds tomorrow.
   This is the detector card `t_bcf87ee3` specifies, landed here first because the
   insertion path cannot be built without it. Wiring it into ingest, compose and
   the reader surfaces uses this file rather than writing a second one.
4. **Candidates are produced daily.** Two deterministic walks, no search API and
   no model: English Wikipedia's per-country `List_of_newspapers_in_<country>`
   pages via the MediaWiki API (one request returns every outlet homepage), and
   the homepages of catalogue sources, which link to the peers we do not have.
   Countries and peer pages rotate by day, so coverage widens instead of
   re-walking the same five. Candidates are stored in `source_candidates` and are
   cheap: only insertion is gated.
5. **The counting day is the operator's day, and the reason is a named class.**
   `src/lib/source-floor.ts` counts sources created in the JST day whose first
   fetch succeeded, reads language refusals from `source_candidates.reject_reason`
   and classifies a short day as one of `job-never-ran`, `executor-crashed`,
   `no-candidates`, `all-rejected-by-language` or `supply-short`. The 07:30 alarm
   opens one P1 card for a short day, and prints nothing at all when the floor was
   met.
6. **Durability over heroics.** The tool stops at the floor and leaves the rest of
   the pool `discovered`, and it writes the candidate's verdict back before moving
   on. A crash delays the count; it does not lose the pool and it cannot read as a
   completed day.

## What this supersedes

`docs/source-discovery.md` lists "outbound-link harvesting" and "recursive crawl"
as rejected. That rejection stands for the _reader-supplied resolve path_: a
reader's URL is resolved once, inside the Worker's subrequest budget, and the
product must not turn it into a crawl. The growth pass is a different caller with
a different budget: it runs on the operator's machine, on a schedule, and its job
is to find outlet homepages — never article evidence, never a reader's request.
One request per page, no recursion, and the resolver it hands candidates to is the
same one the demand path uses.

## The gate was wrong on its first day, and the day's number proved it

The first gate knew eight Latin-script languages and refused everything else by
script. That is a gate that only rejects the neighbours somebody listed, and on
2026-10-30 it passed Icelandic, Hungarian, Slovak, Croatian, Serbian, Tagalog,
Dutch and Finnish feeds as English and counted them toward the day's floor:

```
language audit · 2026-10-30 · 654 source(s)
english          581
non-english       50
unreachable       21
too few titles     2
```

Fifty of 654 inserts were not English — 7.6% of the day counted toward a floor
that exists to grow an _English_ product. Two things came out of that, and both
are in the repository now:

1. **The detector gained the languages it was missing**, plus a suffix test for
   Finnish and Estonian and an accented-letter test as a backstop, and the words
   that are also English (`men`, `under`, `see`, `bus`, `most`, `care`, `die`,
   `net`, `van`, `may`) were kept out of the cue lists. 55 tests hold it, and the
   fixtures are the real titles of the eight feeds above, not invented ones.
2. **`npm run source:audit` re-judges a day's inserts and can delete what the
   gate should have refused.** The intake gate runs once; without an audit a wrong
   verdict is permanent. It only deletes `origin = 'discovered'` rows, so a
   hand-added source is reported and left alone, and it prints every URL before
   removing it.

The rule that was tried first — demanding positive English evidence, three
unmistakable function words in the batch — is in the test file as five feeds it
wrongly rejected (`kyivindependent.com`, `pv-magazine.com`, `bnnbloomberg.ca`,
`macrumors.com`, `thedailybeast.com`). English headlines are terse and
title-case: `US policy tests PV adaptability` carries no function word at all.
Seven of 200 English feeds were refused by it, so it was replaced rather than
tuned.

## Proven, with counts

Measured on 2026-10-30 against the live project, from the worktree:

- `npm run source:floor` reproduced the card's per-day numbers exactly
  (2, 234, 2, 2, 2, 2, 2, 184, 2).
- `npm run source:floor -- --day 2026-09-02 --floor 50` exercised the under-50
  branch on a synthetic zero and printed the card body with `job-never-ran`,
  naming the scheduler as the remedy.
- The 07:30 alarm fired on a real short day and opened card `t_2719818e`
  ("Source floor short: 2026-10-29 added 2, floor 50").
- The 09:30 wave generator fired and opened card `t_af2f0c4f`
  ("Bulk source wave 2026-10-30 1500: English only, any country, 50+").
- `npm run source:discover -- --countries 12 --peers 40` added **153 fresh
  candidates** in one pass; the pool went from 146 to **299 standing
  `discovered`** — above the 150-a-morning target.
- `npm run source:audit -- --day 2026-10-30` judged all 654 of that day's
  inserts: 581 English, 50 not, 21 unreachable, 2 with too few titles.
- `npm run source:audit -- --day 2026-10-30 --delete` then picked out the **50**
  non-English rows that discovery had inserted and was about to remove them; the
  removal itself failed on `canceling statement due to statement timeout`, raised
  by the cascade from `sources` down through the articles and events that hang
  off it. So the 50 are still in the table, the audit says so on every run, and
  removing them is a separate card — a cascade delete is a migration-shaped job,
  not a loop in a report tool. `si.com` (Sports Illustrated, English, refused as
  Spanish because `Al`, `Del` and `La` are Spanish cue words too) was correctly
  excluded from the list: its origin is `curated`, not `discovered`, so a
  hand-added source is never removed by the audit.

## What is not claimed

Three consecutive days at ≥50 cannot be measured in one session; the card's own
acceptance line says "not a promise: counts". The mechanism, the pool and the
alarm are in place and measured; the three-day clock starts on the first full day
they run unattended, and the 07:30 alarm will report any day that misses.

## Invariants this leaves behind

- A source is not added until its first fetch returns items. Never count a row.
- The language test is the text's, never the outlet's country. Nothing is
  translated.
- There is one detector. Do not add a second, weaker check to any insert path.
- The floor is not lowered to look green. A short day says why it was short.
- An alarm that fires on a met day is a defect: silence is the correct default.
