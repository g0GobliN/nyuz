import { Link } from "@tanstack/react-router";
import { Bookmark } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { LogoMark } from "@/components/landing/nav";
import { BRIEFING_READING } from "@/lib/briefing-measure";
import type { Story } from "@/lib/story";
import { sourceCount } from "@/lib/story";
import type { QueueSource } from "@/lib/use-reading-queue";
import { cn } from "@/lib/utils";

/**
 * The tone the importance band prints in, shared with the feed's card.
 *
 * X-01 measured the split this closes: the feed gave every one of the 25 cards
 * an importance band, the briefing gave none, so the surface that calls itself
 * "as it was assembled" was the one that hid the fact the reader opens the feed
 * for. One card, one set of facts — the same three bands, in the same tones,
 * here as well as in `story-card.tsx`.
 */
export const IMPORTANCE_TONE: Record<Story["importance"], string> = {
  High: "text-signal border-signal/40",
  Medium: "text-foreground border-border",
  Notable: "text-muted-foreground border-hairline",
};

/**
 * B-03 — a briefing of the day's stories, grouped by the stories' own topics.
 *
 * A group's name is never written here: it is always `topics[0]` of the stories
 * inside it, the same string every card already prints. What this module adds
 * is only the decision about which groups a page shows.
 */

/** Below this many stories an edition stays one list; a page of three items needs no sections. */
const MIN_GROUPED = 8;
/** The page holds two to four groups; anything past that is the reader's scroll, not structure. */
const MAX_GROUPS = 4;
/** The bucket that collated stories nobody's topic reached. Named so, because it means exactly that. */
const ELSEWHERE = "Elsewhere";

export type BriefGroup = {
  /** The stories' own primary topic — never an invented name, except for Elsewhere. */
  topic: string;
  /**
   * The group's stories, in the order the edition already chose. Grouping is a
   * stable partition: a story never overtakes the ones published around it.
   */
  stories: Story[];
};

/**
 * The groups one edition renders as, or `[]` when it should stay one list.
 *
 * Groups sort by size, so a reader with two minutes meets the dominant thread
 * first; ties break by first appearance, the edition's own order. When the
 * stories carry more topics than fit, the groups that didn't make the cut —
 * and the lone story with no topic at all — share one trailing group, in the
 * order they appeared, so an archive page can never say anything the day's
 * events did not themselves say.
 */
export function briefGroups(stories: Story[]): BriefGroup[] {
  if (stories.length < MIN_GROUPED) return [];

  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  for (const [i, story] of stories.entries()) {
    const topic = story.topics[0];
    if (!topic) continue; // A story with no topic belongs to Elsewhere.
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
    if (!firstSeen.has(topic)) firstSeen.set(topic, i);
  }
  // One topic the whole day down is typography, not structure: the groups would
  // rename the list a heading per row without telling the reader anything new.
  if (counts.size < 2) return [];

  const named = [...counts.entries()].sort(
    ([a, na], [b, nb]) => nb - na || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0),
  );
  const kept = counts.size <= MAX_GROUPS ? named : named.slice(0, MAX_GROUPS - 1);
  const out: BriefGroup[] = kept.map(([topic]) => ({ topic, stories: [] }));
  const byTopic = new Map(out.map((g) => [g.topic, g]));
  const elsewhere: Story[] = [];
  for (const story of stories) {
    const group = story.topics[0] ? byTopic.get(story.topics[0] as string) : undefined;
    (group ? group.stories : elsewhere).push(story);
  }
  if (elsewhere.length > 0) out.push({ topic: ELSEWHERE, stories: elsewhere });
  return out;
}

/** A group's on-page heading: what fits inside it, in words. */
export function briefGroupLabel(group: BriefGroup): string {
  const n = group.stories.length;
  return `${group.topic} · ${n} ${n === 1 ? "story" : "stories"}`;
}

/**
 * The half of the edition's sub-line that claims something about order, taken
 * from the same call the page groups with.
 *
 * "Nothing here was reordered for the web." was written when the page printed
 * the edition verbatim. Grouping made it false — grouping *is* a reorder, and
 * N-07 measured the sentence printed on a page whose order ran 01, 03, 07, 08,
 * 13, 17 — so the note is now a function of the rendered rows rather than a
 * constant: a grouped page says what grouping did (the partition is stable, so
 * the stories inside each group keep the edition's order), and a page that
 * renders the edition verbatim keeps the sentence that is then true.
 */
export function briefOrderNote(stories: Story[]): string {
  return briefGroups(stories).length > 0
    ? "Grouped by topic; the stories inside each group keep the edition's order."
    : "Nothing here was reordered for the web.";
}

/**
 * The one sentence that replaces the audit's "the entire introduction": what
 * the day's thread is, measured from the same groups the page renders. Empty
 * when no groups render — a quiet morning gets neither a lede nor a claim.
 */
export function briefLede(stories: Story[], groups: BriefGroup[]): string {
  const first = groups[0];
  if (!first) return "";
  const n0 = first.stories.length;
  const second = groups[1];
  if (!second) {
    return `The day's through-line is ${first.topic}: ${n0} of ${stories.length} stories.`;
  }
  return `The day's through-line is ${first.topic} — ${n0} of ${stories.length} stories — with ${second.topic} (${second.stories.length}) behind it.`;
}

/**
 * The briefing as it was delivered, on two surfaces that need different things
 * from it.
 *
 * `marketing` (the default) is the landing page's facsimile: fixtures rendered
 * as a picture of the product, where a story link would jump a visitor into a
 * dashboard they have no account for.
 *
 * `reader` is the reader's own briefing at `/dashboard/briefing`. It is the same
 * card — same header, same rule between items, same 25-row rhythm — with the
 * things the audits found missing on the real surface
 * (`docs/design-audit-2026-10-21.md` B1/B2, `docs/reader-clarity-2026-10-22` S2/B-03):
 *
 *  - **each headline is a heading, and the way into its story.** Measured on the
 *    deployed product: 25 stories, 0 anchors, then 0 anchors as headings. The
 *    headline is an `h3` whose link is its first child, so the page steps
 *    `h1 → h2 → h3 × 25` with no skipped level, and it carries the feed card's
 *    hover treatment and the kit's focus ring.
 *  - **the card is a reading column.** The marketing card was sized for a 548 px
 *    column; mounted unchanged in the product's 969 px content area it set 144
 *    characters on a line. `BRIEFING_READING` holds the cap and the measurement
 *    behind it.
 *
 * Both are one switch rather than a fork, because the two surfaces must not
 * drift: what the landing page shows is the claim, and the dashboard is where
 * the claim is kept.
 *
 * ## `chrome` — the card's claim about delivery
 *
 * The chrome around the stories is a claim about how the reader got them, and
 * it is the only part of this card that can be false independently of the
 * stories. `email` (the default) is the delivery framing: a sender address, a
 * send time beside it, and a "Delivered at" stamp. `edition` is the neutral
 * framing the reader's own page uses — an edition header carrying the time it
 * was assembled, and no delivery stamp at all.
 *
 * The default is `email` so the two landing-page usages keep rendering exactly
 * what they rendered before, byte for byte. Marketing is *selling* email, and a
 * page whose subject is "your briefing arrives at 07:30" is entitled to name an
 * inbox; the reader's own briefing is not, because the product does not
 * deliver by email today — the Resend key is deliberately disabled until launch
 * (`AGENTS.md`), and nothing has been accepted since 2026-08-26. A page that
 * says "Delivered at" to a reader who has never received a message is the same
 * defect as a page that says "inbox", so the two move together.
 *
 * The switch is named `chrome` rather than `variant` because `variant` is
 * already the orthogonal axis above (marketing facsimile vs the reader's own
 * briefing, which decides links and the reading cap). Two axes, two props: a
 * reader's card can be the reader's card *and* stop claiming a delivery, which
 * is exactly the combination this ruling asks for.
 *
 * `name` defaults to empty, and the headline drops the address when it is.
 * The two landing-page usages pass no name at all — a marketing demo greeting
 * every visitor by one particular person's first name (which is what the old
 * default did) reads as a leaked fixture, because that is exactly what it was.
 */
export function BriefingPreview({
  stories,
  time = "7:30 AM",
  name = "",
  className,
  compact,
  variant = "marketing",
  fromQueue,
  chrome = "email",
  editionTime,
  savedIds,
  onToggleSave,
}: {
  stories: Story[];
  time?: string;
  name?: string;
  className?: string;
  compact?: boolean;
  variant?: "marketing" | "reader";
  /**
   * Which reader list the link should land the reader back into. `briefing`
   * ties the story page's pager to the briefing itself — without it the pager
   * walks the feed, which on the deployed origin is 24 of the briefing's 25
   * (`docs/design-signoff-2026-10-21.md`, B1/B2 follow-up). Omitting the prop
   * keeps the link landing on the bare story page, the same shape as before.
   */
  fromQueue?: QueueSource;
  chrome?: "email" | "edition";
  /**
   * The 24-hour form of `time`, for the edition header only. The card's other
   * time line is 12-hour ("Your 7:30 AM brief") and predates this switch, so
   * the two formats are passed rather than one being reformatted into the
   * other. Both come from the reader's own `prefs.time`.
   */
  editionTime?: string;
  /**
   * X-01 parity — the reader's *own* save state, the ids the reader has saved.
   * Only read; the write goes through `onToggleSave`.
   */
  savedIds?: string[];
  /**
   * X-01 parity — the feed card's two actions on the briefing card: Read (the
   * explicit affordance, where the headline is also a link) and Save. Both the
   * actions row and every Save button are gated on this prop being passed, so
   * the marketing facsimile can never grow a form by accident and the Saved
   * shelf can share the same card, where tapping Save removes the story it is
   * saving.
   */
  onToggleSave?: (story: Story) => void;
}) {
  const reader = variant === "reader";
  const edition = chrome === "edition";
  // What the edition header says the briefing is, and when. Falls back to the
  // card's own `time` so a caller that passes only one of the two still gets a
  // true time rather than an empty stamp.
  const stamp = editionTime ?? time;
  // Grouping is a reader-surface feature only: the landing page shows the
  // briefing "as it was assembled" in one art-directed list, and a group label
  // there would be a structure the marketing page never promised.
  const groups = useMemo(() => (reader ? briefGroups(stories) : []), [reader, stories]);
  // One numbering across the whole edition, groups included — the numbers are
  // the "1 of 25" the reader already knows, so a section break must not reset
  // them.
  const orderOf = useMemo(() => new Map(stories.map((s, i) => [s.id, i])), [stories]);

  const row = (story: Story): ReactNode => (
    <BriefingRow
      key={story.id}
      story={story}
      n={orderOf.get(story.id) ?? 0}
      reader={reader}
      compact={compact}
      fromQueue={fromQueue}
      saved={savedIds?.includes(story.id) ?? false}
      onToggleSave={onToggleSave}
    />
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl border border-hairline bg-surface shadow-[var(--shadow-float)]",
        reader && BRIEFING_READING.cardClassName,
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        {/*
          The header is the card's delivery claim, so it has two readings. In
          `email` chrome it is a sender address on the left and a send time on
          the right. In `edition` chrome the whole label moves left and becomes
          "Edition · <time>" — one string, because a label split across the row
          is not the label the ruling names. The right slot is then empty: the
          time is already in the label, and printing it twice in two formats
          ("07:30" and "7:30 AM") is a second thing for the reader to reconcile.
          The row's padding, border and type size are untouched, so the card's
          geometry does not move.
        */}
        {edition ? (
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <LogoMark className="h-3.5 w-3.5" />
            <span>Edition · {stamp}</span>
          </span>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <LogoMark className="h-3.5 w-3.5" />
              <span>brief@nyuz.app</span>
            </div>
            <span className="text-[12px] tabular-nums text-muted-foreground">{time}</span>
          </>
        )}
      </div>

      <div className="px-5 pb-2 pt-6 sm:px-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Your {time} brief
        </p>
        {/*
          S2 — on the reader's surface this is the page's one section heading, so
          it is an h2 (the page header holds the h1; the marketing card keeps its
          h3, which its larger page structure owns). What it says is unchanged.
        */}
        {reader ? (
          <h2 className="mt-2 font-serif text-2xl leading-tight sm:text-[28px]">
            {stories.length} things worth knowing{name ? `, ${name}` : ""}.
          </h2>
        ) : (
          <h3 className="mt-2 font-serif text-2xl leading-tight sm:text-[28px]">
            {stories.length} things worth knowing{name ? `, ${name}` : ""}.
          </h3>
        )}
        {/*
          B-03 — the introduction the audit found missing, written from the same
          grouping the page renders below. One sentence, derived from stored
          events; it can say the day's thread only when one exists.
        */}
        {groups.length > 0 ? (
          <p className="mt-3 max-w-[52ch] text-[14px] leading-relaxed text-muted-foreground">
            {briefLede(stories, groups)}
          </p>
        ) : null}
      </div>

      {groups.length > 0 ? (
        <div className="pb-3">
          {groups.map((group) => (
            <section key={group.topic}>
              {/*
                A group's heading. It is a `p` with a heading role rather than a
                third `h3` because the S2 contract fixes the tree at
                `h2 × 1, h3 × 25` — one section head, one heading per story —
                and a group heading would return the very skip the audit
                measured if stories were pushed to h4. The role keeps the
                structure legible to a screen reader without inventing a level.
              */}
              <p
                role="heading"
                aria-level={3}
                className="px-5 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:px-7"
              >
                {briefGroupLabel(group)}
              </p>
              <ol className="divide-y divide-[var(--hairline)] px-5 sm:px-7">
                {group.stories.map(row)}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <ol className="divide-y divide-[var(--hairline)] px-5 sm:px-7">{stories.map(row)}</ol>
      )}

      <div className="flex items-center justify-between border-t border-hairline px-5 py-4 text-[12px] text-muted-foreground sm:px-7">
        {/*
          "Delivered at <time>" is the footer half of the delivery claim, and it
          is the half with nothing behind it: the product has not delivered an
          email since 2026-08-26 and the Resend key is disabled until launch
          (`AGENTS.md`). In `edition` chrome the stamp is gone rather than
          reworded, because any stamp here is a claim about a send that did not
          happen. The channel list stays — it names what the briefing is, not
          where it went. The footer keeps its border, padding and the channel
          list, so the row is the same row.
        */}
        {edition ? null : <span>Delivered at {time}</span>}
        <span className={edition ? "ml-auto" : undefined}>Email · Telegram · Notifications</span>
      </div>
    </div>
  );
}

/**
 * One story as the briefing card prints it. Local to this file on purpose: it
 * is the same row on both surfaces, and the decisions that differ (`reader`
 * headline-as-heading, band and actions) live in the props, not in a fork.
 */
function BriefingRow({
  story: s,
  n,
  reader,
  compact,
  fromQueue,
  saved,
  onToggleSave,
}: {
  story: Story;
  /** The story's position in the whole edition — numbering never resets at a group. */
  n: number;
  reader: boolean;
  compact?: boolean | undefined;
  fromQueue?: QueueSource | undefined;
  saved: boolean;
  onToggleSave?: ((story: Story) => void) | undefined;
}) {
  return (
    <li className="py-5">
      <div className="flex items-baseline gap-3">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {String(n + 1).padStart(2, "0")}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-signal">
          {s.org}
        </span>
        {/*
          X-01 — the band the feed prints on every card, in the same three
          tones. Reader surface only: the marketing card shows the briefing as
          assembled, where the band's absence is not a discrepancy the reader
          can catch.
        */}
        <span
          className={cn(
            "ml-auto rounded-full border px-2.5 py-0.5 text-[11px]",
            IMPORTANCE_TONE[s.importance],
          )}
        >
          {s.importance}
        </span>
      </div>
      {reader ? (
        <h3 className="mt-1.5 text-[16px] font-medium leading-snug">
          <Link
            // The pager on the story page reads `from`. Today's briefing
            // passes `briefing` so the reader pages through the 25 they
            // just saw; omitting it (the marketing variant, or the Saved
            // tab where the count would lie in a different way) leaves the
            // page with no position line — that is the honest shape when the
            // list cannot be named.
            to="/dashboard/story/$id"
            params={{ id: s.id }}
            {...(fromQueue ? { search: { from: fromQueue } } : {})}
            className="block cursor-pointer rounded-sm transition-colors hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {s.title}
          </Link>
        </h3>
      ) : (
        <p className="mt-1.5 text-[16px] font-medium leading-snug">{s.title}</p>
      )}
      {!compact && (
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{s.what}</p>
      )}
      {/*
        Significance and provenance are different claims and print under
        different headings (arbiter, 2026-10-09): `why` is the briefing's
        fact about the story, `personalization` is the reader's own
        follow graph. Either renders alone or both together, and neither
        prints an empty heading — the heading is the container, the
        sentence is the content.
      */}
      {(s.why ?? "").trim().length > 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed">
          <span className="font-medium">Why it matters · </span>
          <span className="text-muted-foreground">{s.why}</span>
        </p>
      ) : null}
      {s.personalization ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          <span className="font-medium">{s.personalization.heading} · </span>
          {s.personalization.explanation}
        </p>
      ) : null}
      {/*
        "Based on N sources" is a corroboration claim, and one outlet is
        the absence of one. A single-source story states its outlet in the
        card header already; printing "Based on 1 source" under every card
        turned a fact into filler. It returns the moment a second outlet
        picks the story up.
      */}
      {s.sources > 1 ? (
        <p className="mt-2.5 text-[11.5px] text-muted-foreground">
          Based on {sourceCount(s.sources)}
        </p>
      ) : null}
      {/*
        X-01 — the feed card's two actions, on the briefing card. The Save
        button carries the same optimistic state the shelf and the feed both
        use, and on the Saved tab it is how the story gets removed again.
      */}
      {reader && onToggleSave ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
          <Link
            to="/dashboard/story/$id"
            params={{ id: s.id }}
            {...(fromQueue ? { search: { from: fromQueue } } : {})}
            className="rounded-full border border-border px-3.5 py-1.5 text-[12.5px] transition-colors hover:bg-muted"
          >
            Read <span aria-hidden>→</span>
          </Link>
          <button
            type="button"
            onClick={() => onToggleSave(s)}
            aria-pressed={saved}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors",
              saved ? "border-signal/50 text-signal" : "border-border hover:bg-muted",
            )}
          >
            <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      ) : null}
    </li>
  );
}
