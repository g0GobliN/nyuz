# The daily source floor's scheduler half

Three shell scripts, and the cron entries that run them. They live here so the
schedule is reviewed, versioned and diffed with the code it drives; the copies
the scheduler actually executes are installed in `~/.hermes/scripts/`, and the
entries are in `~/.hermes/cron/jobs.json`. Change the copy here first, then
install it — a drift between the two is how a job quietly stops running the
thing everybody reviewed.

The code these scripts drive is in this repository:

| Script                       | Runs                  | Uses                                                   | Opens                                                                              |
| ---------------------------- | --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `nyuz-source-discover.sh`    | 06:10 daily           | `npm run source:discover`                              | nothing — writes candidates                                                        |
| `nyuz-bulk-sources-card.sh`  | 09:30 and 16:30 daily | `kanban.db` via `sqlite3`; `hermes kanban archive`     | one "Bulk source wave <day> <slot>" card per slot, floor in the body               |
| `nyuz-source-floor-alarm.sh` | 07:30 daily           | `kanban.db` via `sqlite3`; then `npm run source:floor` | one P1 "Source floor short: <day>" card, and nothing at all when the floor was met |

## Reading the board

Both scripts that have to know whether a wave card ran for a day or a slot read
`~/.hermes/kanban/boards/nyuz/kanban.db` with `sqlite3`, never
`hermes kanban list --json`. That command refuses to answer inside a
delegate-agent context — the context a gateway-fired cron job runs in — and
exits 1 with empty stdout. Read as "no card", that empty answer is consumed as a
zero: on 2026-10-29 it scored a day whose wave card had run and died as
`job-never-ran` (`t_2719818e`), and in the card factory it stopped the stale
card from ever being archived, so a blocked card could swallow a slot.

A board that cannot be read — no database, no `sqlite3` on `PATH`, a failed
query — is a failure, not a zero. Both scripts say why on stderr and exit 2
rather than reporting a day that never ran or opening a card on top of a dead
one.

Opening the card is the other half of that rule. When `nyuz-kanban-card.py`
fails or returns no id, `nyuz-bulk-sources-card.sh` names the slot on stderr and
exits 2. It never prints `-> card FAILED` and exits 0: that shape made a slot
with no card at all look like a quiet success in cron, and the next morning's
alarm then scored the slot `job-never-ran`, blaming the scheduler for the card
factory's failure.

The design, the measured failure it answers and the invariants it leaves behind
are in [docs/decisions/daily-source-floor.md](../../docs/decisions/daily-source-floor.md).

## Installing

```bash
cp scripts/ops/nyuz-source-*.sh scripts/ops/nyuz-bulk-sources-card.sh ~/.hermes/scripts/
chmod +x ~/.hermes/scripts/nyuz-source-*.sh ~/.hermes/scripts/nyuz-bulk-sources-card.sh
hermes cron list          # the three entries should be enabled
```

`nyuz-source-floor-alarm.sh` is silent on a met day by design. If it prints
anything, a day was short and the card it names is the explanation. An exit 2 is
not a met day: the alarm could not read the board or could not open its card,
and the line it wrote to stderr says which.
