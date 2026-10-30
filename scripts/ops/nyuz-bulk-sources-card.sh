#!/usr/bin/env bash
# Opens one bulk source wave card per slot. Deterministic: no LLM, no judgement.
#
# OWNER STANDING ORDER (2026-10-30, restated many times, last time):
#   Every day at 09:30 and at 16:30, add 50+ (target 100) ENGLISH-language
#   sources of ANY country. English only — no other language may be added.
#   A day that adds fewer than 50 per slot is a failure, not a variance.
#
# One card per slot: cards are keyed by date AND slot, so the 16:30 run does not
# silently no-op behind the 09:30 run (that bug cost whole days).
#
# The card does not ask an agent to invent candidate URLs. Insertion is
# `npm run source:grow` in the repository, which probes the pool with the app's
# own resolver, refuses non-English feeds with the shared detector, refuses
# duplicates, and inserts only after the feed returned items. The card's job is
# to run it and report the number it produced.
set -u
BOARD="nyuz"
HERMES="$HOME/.local/bin/hermes"
DATE=${BULK_DATE:-$(date +%F)}
SLOT=${BULK_SLOT:-$(date +%H%M)}
TARGET=${BULK_TARGET:-100}
FLOOR=${BULK_FLOOR:-50}
POOL=${BULK_POOL:-150}
KEY="bulk-sources-$DATE-$SLOT"
BODY="$HOME/.hermes/cache/scratch/bulk_sources_${DATE}_${SLOT}.md"
mkdir -p "$(dirname "$BODY")"

# Idempotency, with self-healing: a card carrying this slot's key that is already
# finished or blocked must not block today's wave forever (a card created early,
# or left behind by a failed run, would silently skip a whole slot). Archive the
# stale ones and create a fresh card. A card that is still running wins the slot.
#
# The answer comes from the board database, not from `hermes kanban list`: the CLI
# refuses to answer inside a delegate-agent context (exit 1, empty stdout), which is
# exactly the context a gateway-fired cron job runs in. Read as "no card for this
# slot", that empty answer disables every line below -- the stale card is never
# archived and the slot silently reopens onto a dead card. A read that fails is a
# failure: say so and stop, never a quiet zero.
BOARD_DB=""
for candidate in "${HERMES_HOME:-$HOME/.hermes}/kanban/boards/$BOARD/kanban.db" \
                 "$HOME/.hermes/kanban/boards/$BOARD/kanban.db"; do
  if [ -r "$candidate" ]; then BOARD_DB=$candidate; break; fi
done
if [ -z "$BOARD_DB" ]; then
  echo "bulk source wave: cannot read the $BOARD board database; refusing to guess whether $KEY ran" >&2
  exit 2
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "bulk source wave: sqlite3 is not on PATH; cannot read $BOARD_DB" >&2
  exit 2
fi
slot_like="Bulk source wave $DATE $SLOT:%"
runids=$(sqlite3 -cmd ".timeout 5000" "$BOARD_DB" "
  select coalesce(group_concat(id, ' '), '') from tasks
  where title like '$slot_like' and status in ('running','claimed','in_progress');") || {
  echo "bulk source wave: board query failed on $BOARD_DB" >&2; exit 2; }
staleids=$(sqlite3 -cmd ".timeout 5000" "$BOARD_DB" "
  select coalesce(group_concat(id, ' '), '') from tasks
  where title like '$slot_like'
    and status not in ('running','claimed','in_progress')
    and status <> 'archived';") || {
  echo "bulk source wave: board query failed on $BOARD_DB" >&2; exit 2; }
if [ -n "${runids// /}" ]; then echo "bulk source wave $DATE $SLOT already running ($runids)"; exit 0; fi
for sid in $staleids; do
  if "$HERMES" kanban --board "$BOARD" archive "$sid" >/dev/null 2>&1; then
    echo "archived stale card $sid for $KEY"
  else
    echo "bulk source wave: could not archive stale card $sid for $KEY; a new card would reopen it" >&2
    exit 2
  fi
done

cat > "$BODY" <<EOF
Owner standing order: **every day at 09:30 and 16:30, add $FLOOR+ new sources (target $TARGET), English only, any country.** This card is the $SLOT run for $DATE. Floor for this run: **$FLOOR inserted and fetching**. Target: $TARGET.

Insertion is a tool, not a judgement call. Do not hand-write feed URLs, and do not insert anything the tool refused.

## Phase 0 — the pool (two minutes)
1. \`npm run source:floor\` — read its \`pool now\` line. \`discovered\` is how many candidates are waiting.
2. If \`discovered\` is under $POOL, run \`npm run source:discover -- --countries 12 --peers 40\` before the wave. Candidates are cheap and safe to over-collect; only insertion is gated.

## Phase 1 — prune (before inserting anything)
1. \`active=false\` on every source with \`failure_count >= 8\`.
2. \`active=false\` on every source created more than 72h ago whose \`last_new_content_at\` is null.
3. Never delete rows — retire only.
Report: retired count, the 10 worst names, catalogue total after pruning.

## Phase 2 — the wave: run the tool
\`\`\`
npm run source:grow -- --floor $FLOOR --max-probe 260 --json
\`\`\`

What it does, so nobody re-does it by hand and nobody adds a second, weaker check:
- probes the pool with the app's own six-request resolver (\`src/lib/discovery/feed.ts\`);
- **English gate on every insert** — \`src/lib/language-detection.ts\` reads the feed's own item titles. English of any country passes; a feed that cannot be shown to be English is refused and the reason is written to \`source_candidates.reject_reason\` as \`non-english: <why>\`;
- refuses a feed URL the catalogue already holds (\`duplicate-feed\`);
- inserts only after the feed returned at least three item titles, and stamps \`last_fetched_at\` with that probe — the probe IS the first fetch, which is what makes "added" true;
- **stops at the floor and leaves the rest of the pool discovered** for the afternoon slot or tomorrow. A crash delays the count; it does not lose the work and it does not drain the pool.

The tool exits 1 when it could not reach the floor. That is a result to report, not a failure to hide.

## Phase 3 — report, from the tool and the database
- The tool's counts: probed, inserted, refused-language, refused-other, duplicates.
- \`npm run source:floor\` for the day's line — it counts sources created today in JST whose first fetch succeeded.
- If the floor was not met: state the number, the reason class the floor report names, and what the pool looked like. **Never pad to reach a number, never lower the floor, and never count a row that has not fetched.**

## Not in scope
No product code, no polling-tier experiments, no deletes, no docs.
EOF

ID=$(python3 "$HOME/.hermes/scripts/nyuz-kanban-card.py" --board "$BOARD" \
  --title "Bulk source wave $DATE $SLOT: English only, any country, $FLOOR+ (target $TARGET)" \
  --body-file "$BODY" --assignee scout --priority 10 --key "$KEY" --created-by ceo 2>/dev/null)
echo "bulk source wave $DATE $SLOT -> card ${ID:-FAILED}"
