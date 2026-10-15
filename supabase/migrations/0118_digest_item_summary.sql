-- ---------------------------------------------------------------------------
-- The validated summary artifact: a stored, composed line for an item whose own
-- stored description no reader-content boundary will print.
--
-- The defect this closes (ruled 2026-10-15, decisions/reader-delivery.md):
-- `digest_items` stores no summary at all, so every reader surface printed
-- `events.what_happened` -- the feed's own description -- read through a
-- read-time join, while the story page composed and validated its prose. Two
-- standards on one product, so a story could be withheld on one surface and
-- delivered on another. Measured on the delivered surface before this slice:
-- 20 briefings delivered, 297 items handed to a reader, 289 carrying a line,
-- 10 of those lines refused by the delivery boundary.
--
-- `summary` is that line, composed at briefing build time through the product's
-- existing composition path (`recoverCardSummary` / `recoveredSummaryFromSources`
-- in `src/lib/editorial.ts`, asked from `digest.ts`), validated against the same
-- boundaries the delivery guard asks (`deliveredSummary` in
-- `src/lib/reader-summary.ts`), and written in the same statement as the item.
--
-- Provenance is the same row's `delivered_revision` (0099): the artifact is
-- composed from the event material as it stood when the item was written, and
-- the two values are written together, so the pair answers "which revision of
-- the material does this line describe" without a second column or a join.
--
-- Semantics, deliberately narrow:
--   NULL          no artifact. Either the item's own line was admissible (so it
--                 needs none) or the composition published nothing acceptable
--                 (so the item ships with no line at all).
--   non-null      a validated line, printed in preference to `what_happened`.
--
-- Nullable and add-only: every existing row keeps NULL, which resolves to
-- exactly the behaviour it had before this migration -- its own stored line,
-- still refused at the join if a boundary refuses it. No row is rewritten.
-- Nothing here composes the artifact for an already-delivered row; that is a
-- separate decision, and the withhold half already covers those rows.

alter table public.digest_items
  add column summary text;

comment on column public.digest_items.summary is
  'Validated composed summary line delivered with this item (0118), written at briefing build time in the same statement as delivered_revision -- which is the event material revision it was composed from. NULL means "no artifact": the item''s own line was admissible, or the composition published nothing acceptable and the item ships with no line. The raw feed description is never substituted for it (reader-summary.ts).';
