import { Eyebrow } from "@/components/kit";
import { cn } from "@/lib/utils";

/**
 * What nyuz covers — the scope of the information, stated once, high on the page.
 *
 * This section exists because the landing page's other sections all explain the
 * same three things — merge duplicates, match your topics, deliver a short
 * briefing — and a first-time visitor reading them in order could reasonably
 * conclude that nyuz is a personalized news digest. It is not: the topic
 * taxonomy is 35 labels wide, the seeded sources include arXiv, GitHub release
 * feeds, vendor blogs and product changelogs, and a reader may add their own
 * feeds. The hero's own source strip already names non-newsrooms (OpenAI,
 * Hacker News), and the topic demo further down shows the same spread.
 *
 * So the claim was already true on the page; it was just never said in words.
 * This says it, in the position where a stranger decides whether to keep
 * reading.
 *
 * ---------------------------------------------------------------------------
 * The copy is load-bearing, and every clause of it is checkable
 * ---------------------------------------------------------------------------
 *
 * "Research" is backed by the five seeded arXiv feeds (cs.AI, cs.CL, cs.CR,
 * cs.LG, cs.RO) and Berkeley AI Research. "Open source" and "releases" are
 * backed by the seeded GitHub release feeds (Bun, Deno, Next.js, Node.js,
 * React, Supabase, Tailwind, TypeScript, Vite, llama.cpp, vLLM). "Company
 * updates" are backed by the 19 seeded `company_blog` sources (OpenAI, NVIDIA,
 * Stripe, Cloudflare, Google Research, Meta Engineering, Mozilla Hacks, and so
 * on). "Music, film and culture" are backed by the seeded entertainment
 * sources. Nothing here is a promise the source list cannot keep.
 *
 * What is deliberately NOT claimed: a number of sources, a number of topics
 * read as "how much", and anything about coverage being comprehensive. A
 * numeral on a landing page is the one thing a stranger can check and find
 * wanting, and the source count moves every week.
 *
 * ---------------------------------------------------------------------------
 * The grid is the WhyDifferent grid, not a new pattern
 * ---------------------------------------------------------------------------
 *
 * Four cells, hairline-divided, one rounded-3xl container — the same
 * construction as `WhyDifferent` in this file, so the page has one card-grid
 * language rather than two. It is not a photo grid: this page has no
 * photography in `<main>` at all, and four licensed images would be the first
 * on the page and would read as a different product.
 */

/**
 * The four areas, in the order a reader meets them.
 *
 * `body` is one sentence per cell, on the same principle the `DIFFS` grid in
 * this file follows: a cell is one beat of the argument, not a paragraph.
 *
 * The four bodies are written to the same length on purpose. The grid's rows
 * are equal height, so a cell whose body runs one line shorter than its
 * neighbours leaves a visible hole in the bottom-right of the panel, and the
 * panel's weight tips towards the top-left. Padding it out with filler would
 * be worse than the hole, so the sentences are written to fill the same two
 * lines each — the way a designer would set them, not as four separate
 * afterthoughts.
 */
const AREAS = [
  {
    title: "News and world events",
    body: "The developments shaping the world around you — politics, economy, climate, and health.",
  },
  {
    title: "Technology and projects",
    body: "Tools, releases, company updates and open-source work — the changelogs and research blogs that matter to you.",
  },
  {
    title: "Research and ideas",
    body: "Discoveries, findings and ideas worth exploring, from the labs and the papers themselves.",
  },
  {
    title: "Music, film and culture",
    body: "Releases, announcements and developments from the artists, films and games you actually follow.",
  },
] as const;

export function Coverage() {
  return (
    <div>
      <Eyebrow>What nyuz covers</Eyebrow>
      <h2 className="display mt-3 max-w-2xl text-4xl sm:text-5xl">
        Not just what&apos;s in the news.
        <br />
        What matters in your world.
      </h2>
      <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        The internet is full of things worth knowing that never make the front page. Nyuz keeps you
        on the developments, ideas and updates connected to your interests — from world events and
        technology to research, music, gaming and the projects you follow. Instead of checking
        dozens of websites and feeds, you get a more focused view of what is happening across the
        sources that matter to you.
      </p>

      {/*
        The same hairline grid as `WhyDifferent`: a 1px gap over a hairline
        background, so the dividers are the container's own borders rather than
        drawn on each cell. Two columns on a phone, four across from `sm`.

        `WhyDifferent` gives its last card a full-width row because it has an
        odd number of cards and an empty cell in a hairline grid is a bare
        block of line colour. Four is even, so no cell has to span, and the
        grid is a clean rectangle.
      */}
      <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-hairline bg-[var(--hairline)] sm:grid-cols-2">
        {AREAS.map((a, i) => (
          <div
            key={a.title}
            className={cn("reveal bg-surface p-8")}
            style={{ transitionDelay: `${i * 80}ms` }}
          >
            <p className="text-[19px] font-medium tracking-tight">{a.title}</p>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">{a.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
