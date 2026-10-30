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
# executor-crashed, no-candidates, all-rejected-by-language, or supply-short.
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
HERMES="$HOME/.local/bin/hermes"
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
WAVES=$("$HERMES" kanban --board "$BOARD" list --json 2>/dev/null | python3 -c '
import json, sys
day = sys.argv[1]
try:
    payload = json.load(sys.stdin)
except Exception:
    print("0 0")
    raise SystemExit
tasks = payload if isinstance(payload, list) else payload.get("tasks", [])
prefix = "Bulk source wave %s" % day
cards = [t for t in tasks if (t.get("title") or "").startswith(prefix)]
alive = [t for t in cards if t.get("status") != "archived"]
failed = [t for t in alive if t.get("status") in ("failed", "blocked", "expired", "stuck", "triage")]
print("%d %d" % (len(alive), len(failed)))
' "$DAY" 2>/dev/null)
CREATED=${WAVES% *}
FAILED=${WAVES#* }
CREATED=${CREATED:-0}
FAILED=${FAILED:-0}

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

ID=$(python3 "$HOME/.hermes/scripts/nyuz-kanban-card.py" --board "$BOARD" \
  --title "$TITLE" --body-file "$BODY" --assignee forge --priority 1 \
  --key "source-floor-short-$DAY" --created-by ceo 2>/dev/null)

echo "source floor short on $DAY (floor $FLOOR) -> card ${ID:-FAILED}"
