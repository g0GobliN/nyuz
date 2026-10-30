#!/usr/bin/env bash
# Refills the candidate pool before the day's first wave.
#
# Owner's standing requirement (2026-10-30): 50-100 new English sources every
# day. A 50-a-day floor burns through a hand-written candidate list in two days,
# so the pool has to be refilled daily by a machine. This is that machine's
# schedule: it runs at 06:10, before the 09:30 wave, and it only writes
# candidates -- it never inserts a source.
#
# Output policy: one line saying how many fresh candidates were added, and
# nothing else. The alarm for "the day was short" is a different job; this one
# complaining twice about the same shortage would be noise.
set -u

ROOT=${NYUZ_ROOT:-$HOME/github_projects/nyuz}
if [ ! -f "$ROOT/scripts/source-discover.ts" ]; then
  for candidate in "$HOME"/github_projects/nyuz/.worktrees/*/scripts/source-discover.ts; do
    [ -f "$candidate" ] || continue
    ROOT=$(dirname "$(dirname "$candidate")")
    break
  done
fi
if [ ! -f "$ROOT/scripts/source-discover.ts" ]; then
  echo "source discover: cannot find scripts/source-discover.ts under $HOME/github_projects/nyuz"
  exit 1
fi

OUT=$(cd "$ROOT" && npm run --silent source:discover -- \
  --countries "${DISCOVER_COUNTRIES:-12}" \
  --peers "${DISCOVER_PEERS:-40}" \
  --concurrency "${DISCOVER_CONCURRENCY:-6}" 2>&1)
STATUS=$?

FRESH=$(printf '%s\n' "$OUT" | grep -m1 '^fresh candidates' || true)
POOL=$(printf '%s\n' "$OUT" | grep -m1 '^standing' || true)

if [ "$STATUS" -ne 0 ]; then
  echo "source discover failed (exit $STATUS): $(printf '%s\n' "$OUT" | tail -3 | tr '\n' ' ')"
  exit 1
fi

# Zero fresh candidates is the failure the card is written against: the pool
# starves in two days and every later stage reports the symptom.
FRESH_N=$(printf '%s' "$FRESH" | grep -o '[0-9]\+' | head -1)
if [ "${FRESH_N:-0}" -eq 0 ]; then
  echo "source discover added 0 candidates — the walk found nothing new. Pool: ${POOL:-unknown}."
  exit 1
fi

echo "source discover: ${FRESH:-fresh candidates unknown}; ${POOL:-pool unknown}."
