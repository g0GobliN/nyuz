#!/usr/bin/env bash
# Morning source-floor alarm: did yesterday add 50 new English sources?
#
# Owner's standing requirement (2026-10-30, restated many times): 50-100 NEW
# English-language sources every day, any country. This is the check that makes
# the owner stop having to ask "why only 2".
#
# Silence is the correct output. When the floor was met this script prints
# nothing and exits 0. When it was not, it opens ONE P1 card naming the gap and
# the reason class, and prints one line. The reason class comes from
# `assessDay` in the repository (src/lib/source-floor.ts): job-never-ran,
# executor-crashed, unmeasured, no-candidates, all-rejected-by-language, or
# supply-short. This alarm always passes the wave counts it read from the board,
# so its own day is measured and never comes back `unmeasured`.
#
# Yesterday, not today: the day being judged is the one the owner lived through,
# in JST. A count of "today so far" is guaranteed to look short at 07:30 and
# would train everyone to ignore the alarm.
#
# The counts are the repository's, not this script's. `npm run source:floor`
# counts sources created in the operator's day whose first fetch succeeded, and
# reads language refusals from `source_candidates.reject_reason`.
set -u

BOARD="nyuz"
# The board database is this alarm's only evidence that a wave card was opened for
# the day. It is read directly, never through `hermes kanban list`: that command
# refuses to answer inside a delegate-agent context (exit 1, empty stdout), and an
# empty answer is not a zero -- on 2026-10-29 it turned a crashed executor into
# `job-never-ran`, which sends the repair to the scheduler instead of the wave.
BOARD_DB=""
for candidate in "${HERMES_HOME:-$HOME/.hermes}/kanban/boards/$BOARD/kanban.db" \
                 "$HOME/.hermes/kanban/boards/$BOARD/kanban.db"; do
  if [ -r "$candidate" ]; then BOARD_DB=$candidate; break; fi
done
FLOOR=${FLOOR:-50}
DAY=${SOURCE_FLOOR_DAY:-$(TZ=Asia/Tokyo date -d yesterday +%F)}

# The repo that carries the tooling. Normally the main checkout; a worktree that
# is mid-review also has it, so prefer any checkout that actually holds the
# script rather than failing for a day because a branch has not merged yet.
ROOT=${NYUZ_ROOT:-$HOME/github_projects/nyuz}
if [ ! -f "$ROOT/scripts/source-floor.ts" ]; then
  for candidate in "$HOME"/github_projects/nyuz/.worktrees/*/scripts/source-floor.ts; do
    [ -f "$candidate" ] || continue
    ROOT=$(dirname "$(dirname "$candidate")")
    break
  done
fi
if [ ! -f "$ROOT/scripts/source-floor.ts" ]; then
  echo "source floor: cannot find scripts/source-floor.ts under $HOME/github_projects/nyuz"
  exit 1
fi

# The board's own evidence: how many wave cards were opened for the day, and how
# many of those ended failed. The product database cannot see the board, so this
# is the half of the reason class that is passed in.
#
# Two rules this read must never break:
#   - it reads the board database itself, never `hermes kanban list`: that command
#     refuses to answer inside a delegate-agent context, and its empty answer is
#     not a zero;
#   - a failed read is not a zero either. Say why and stop, because a card that
#     sends the operator to the scheduler when the board could not be read is a
#     worse outcome than no card at all.
bail() { echo "source floor alarm: $1" >&2; exit 2; }
[ -n "$BOARD_DB" ] || bail "cannot find $BOARD/kanban.db under ${HERMES_HOME:-$HOME/.hermes}/kanban/boards or $HOME/.hermes/kanban/boards"
command -v sqlite3 >/dev/null 2>&1 || bail "sqlite3 is not on PATH"
WAVES=$(sqlite3 -cmd ".timeout 5000" "$BOARD_DB" "
  select count(*)
      || ' '
      || coalesce(sum(case when status in ('failed','blocked','expired','stuck','triage')
                           then 1 else 0 end), 0)
  from tasks
  where title like 'Bulk source wave $DAY%'
    and status <> 'archived';") || bail "board query failed on $BOARD_DB"
CREATED=${WAVES% *}
FAILED=${WAVES#* }
case "$CREATED$FAILED" in
  '' | *[!0-9]*) bail "unreadable wave count '$WAVES' from $BOARD_DB" ;;
esac

OUT=$(cd "$ROOT" && npm run --silent source:floor -- --day "$DAY" --floor "$FLOOR" \
  --waves-created "$CREATED" --waves-failed "$FAILED" 2>&1)
STATUS=$?

# Exit 0 means the day met the floor: say nothing at all.
if [ "$STATUS" -eq 0 ]; then
  exit 0
fi

# Short. The report already reads as a card: a title line, the gap, the reason
# class with its remedy, and the day table.
BODY=$(mktemp "${TMPDIR:-/tmp}/source-floor-XXXXXX.md")
printf '%s\n' "$OUT" > "$BODY"

HEAD=$(printf '%s\n' "$OUT" | grep -m1 '^# Source floor short' || true)
[ -z "$HEAD" ] && HEAD="# Source floor short: $DAY"
TITLE=${HEAD#\# }

# The card is this alarm's only output, so a failure to open it has to be visible
# and non-zero: a log line reading "-> card FAILED" in a cron mail is how a short
# day goes unnoticed for a week.
if ! ID=$(python3 "$HOME/.hermes/scripts/nyuz-kanban-card.py" --board "$BOARD" \
      --title "$TITLE" --body-file "$BODY" --assignee forge --priority 1 \
      --key "source-floor-short-$DAY" --created-by ceo); then
  rm -f "$BODY"
  echo "source floor alarm: could not open a card for $DAY on $BOARD" >&2
  exit 2
fi
if [ -z "$ID" ]; then
  rm -f "$BODY"
  echo "source floor alarm: card helper returned no id for $DAY on $BOARD" >&2
  exit 2
fi
rm -f "$BODY"

echo "source floor short on $DAY (floor $FLOOR) -> card $ID"
