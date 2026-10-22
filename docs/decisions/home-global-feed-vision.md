# The home feed becomes the product: global, endless, reader-chosen

Ruled by the owner, 2026-10-22. This is the direction the November build serves. It is written down so
no task in October contradicts it by accident.

## The vision, in the owner's words

> "Make home a global feed so the user can roam around, pick what they want, choose what they want; the
> brief side shifts to be the same as home — right now they can read full too, like home. Make home
> enough for the user to feel they can read infinitely — they can't finish it; once they refresh they
> never see the same thing again, always new. Then sources activate only when the user asks. Until the
> end of November I want to finish this quality side — 10/10, no errors, readable by anyone, like
> Wikipedia."

## What that means concretely

1. **Home is a global feed, not a landing page.** A reader can roam the whole corpus — every region,
   every topic — and choose what they care about. The feed is the front door.
2. **The briefing becomes a second view of the same reading experience**, not a separate, thinner
   product. A card opens into the same full read that home offers.
3. **"Infinite" is a supply guarantee.** A refresh must never say "you're all caught up" while the
   corpus holds more. That makes a deep, warm, worldwide source pool a product requirement — the
   reason source growth is not cosmetic.
4. **Demand-driven fetching is retired for the curated pool.** The corpus is fetched and stored ahead
   of the reader (`coverage_mode='core'`, 6–12h rotation). The demand gate remains only for
   discovered and user-added feeds. Never make a reader wait for a fetch.
5. **Personalisation is choosing, not filtering.** The reader picks topics, regions and sources; the
   product must not hide the world behind an algorithm's guess.

## Sequence

- **Now → 31 Oct:** quality only. Reader clarity audit (Wikipedia test) on home, briefing and story
  page; fixes cut from it; delivery/significance/surfaces/alerts gates stay green. Source growth runs
  in the background as bulk, validated batches, because home's promised depth depends on it.
- **1 Nov → 30 Nov:** build the global home feed and fold the briefing into it. This is where the
  home work starts — it does not start before November.
- **1 Dec → 20 Dec:** source freeze on 20 Dec; measure the frozen pool; no pool changes until launch.
- **31 Dec:** launch.

## What must not be violated while building it

- The reader-facing 10/10 gates (`docs/reader-quality-10-of-10.md`) stay the acceptance bar; a bigger
  feed does not lower it.
- A refresh must serve genuinely new material, not reshuffle the same stories under new timestamps.
  Duplicate delivery is a defect, not filler.
- Ruling #12c's eight experiment sources are untouched until 2026-11-18.
- Per-brief work stays inside Cloudflare's ~710 ms CPU grace; a deeper corpus is a storage and
  scheduling question, not a per-request one.
