# The daily source floor's scheduler half

Three shell scripts, and the cron entries that run them. They live here so the
schedule is reviewed, versioned and diffed with the code it drives; the copies
the scheduler actually executes are installed in `~/.hermes/scripts/`, and the
entries are in `~/.hermes/cron/jobs.json`. Change the copy here first, then
install it — a drift between the two is how a job quietly stops running the
thing everybody reviewed.

The code these scripts drive is in this repository:

| Script                       | Runs                  | Calls                     | Opens                                                                              |
| ---------------------------- | --------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `nyuz-source-discover.sh`    | 06:10 daily           | `npm run source:discover` | nothing — writes candidates                                                        |
| `nyuz-bulk-sources-card.sh`  | 09:30 and 16:30 daily | board API                 | one "Bulk source wave <day> <slot>" card per slot, floor in the body               |
| `nyuz-source-floor-alarm.sh` | 07:30 daily           | `npm run source:floor`    | one P1 "Source floor short: <day>" card, and nothing at all when the floor was met |

The design, the measured failure it answers and the invariants it leaves behind
are in [docs/decisions/daily-source-floor.md](../../docs/decisions/daily-source-floor.md).

## Installing

```bash
cp scripts/ops/nyuz-source-*.sh scripts/ops/nyuz-bulk-sources-card.sh ~/.hermes/scripts/
chmod +x ~/.hermes/scripts/nyuz-source-*.sh ~/.hermes/scripts/nyuz-bulk-sources-card.sh
hermes cron list          # the three entries should be enabled
```

`nyuz-source-floor-alarm.sh` is silent on a met day by design. If it prints
anything, a day was short and the card it names is the explanation.
