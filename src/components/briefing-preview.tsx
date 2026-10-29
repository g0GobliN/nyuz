import { Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/landing/nav";
import { BRIEFING_READING } from "@/lib/briefing-measure";
import type { Story } from "@/lib/story";
import { sourceCount } from "@/lib/story";
import type { QueueSource } from "@/lib/use-reading-queue";
import { cn } from "@/lib/utils";

/**
 * The briefing as it was delivered, on two surfaces that need different things
 * from it.
 *
 * `marketing` (the default) is the landing page's facsimile: fixtures rendered
 * as a picture of the product, where a story link would jump a visitor into a
 * dashboard they have no account for.
 *
 * `reader` is the reader's own briefing at `/dashboard/briefing`. It is the same
 * card — same header, same rule between items, same 25-row rhythm — with the two
 * things the audit found missing on the real surface
 * (`docs/design-audit-2026-10-21.md`, B1/B2):
 *
 *  - **each headline is the way into its story.** Measured on the deployed
 *    product: 25 stories, 0 anchors, 0 tabbable elements. The headline is the
 *    target rather than the whole row, so text selection and the row rhythm are
 *    unchanged, and it carries the feed card's hover treatment and the kit's
 *    focus ring.
 *  - **the card is a reading column.** The marketing card was sized for a
 *    548 px column; mounted unchanged in the product's 969 px content area it
 *    set 144 characters on a line. `BRIEFING_READING` holds the cap and the
 *    measurement behind it. The cap is the dashboard's own content column and
 *    the list is a single column at every width — the shape the owner asked
 *    for after seeing both a narrow card and two columns.
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
}) {
  const reader = variant === "reader";
  const edition = chrome === "edition";
  // What the edition header says the briefing is, and when. Falls back to the
  // card's own `time` so a caller that passes only one of the two still gets a
  // true time rather than an empty stamp.
  const stamp = editionTime ?? time;

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
        <h2 className="mt-2 font-serif text-2xl leading-tight sm:text-[28px]">
          {stories.length} things worth knowing{name ? `, ${name}` : ""}.
        </h2>
      </div>

      <ol className="divide-y divide-[var(--hairline)] px-5 sm:px-7">
        {stories.map((s, i) => (
          <li key={s.id} className="py-5">
            <div className="flex items-baseline gap-3">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-signal">
                {s.org}
              </span>
            </div>
            {reader ? (
              <h3 className="mt-1.5 text-[16px] font-medium leading-snug">
                <Link
                  // The pager on the story page reads `from`. Today's briefing
                  // passes `briefing` so the reader pages through the 25 they
                  // just saw; omitting it (the marketing variant, or the Saved
                  // tab where the count would lie in a different way) leaves the
                  // page with no position line — that is the honest answer when
                  // we cannot name the list the reader came from.
                  to="/dashboard/story/$id"
                  params={{ id: s.id }}
                  {...(fromQueue ? { search: { from: fromQueue } } : {})}
                  className="block cursor-pointer rounded-sm transition-colors hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {s.title}
                </Link>
              </h3>
            ) : (
              <h3 className="mt-1.5 text-[16px] font-medium leading-snug">{s.title}</h3>
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
          </li>
        ))}
      </ol>

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
