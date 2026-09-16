# AI providers

Nyuz uses a provider only for explicit reader-requested shared long stories, plus explicit administrator connection tests. Background processing never calls a provider, regardless of legacy feature flags or routing settings.

## Routing

The existing `reason` capability supplies the shared story model. `cluster` and `digest` routes are retained as backward-compatible configuration, not production news-processing callers. Background event analysis is deterministic. Changing a retired route does not enable AI clustering, briefings or analysis.

Provider rows store base URLs and the names of environment secrets, never the secrets themselves. Route changes and tests remain behind the audited administrator boundary. A provider/model without a supported rate card cannot receive a reservation.

The on-demand story supplies its own small article prompt explicitly; it does not depend on the legacy `analyse`/`analysis` prompt-name distinction. The output ceiling is 4,096 tokens, including reasoning. Evidence is bounded and weak evidence skips generation. The transport checks truncation and disables SDK retries; malformed JSON does not trigger a repair purchase.

## Safety

- Hard launch ceilings: $0.50 per UTC day and $10 per UTC month, including outstanding reservations.
- Two active shared generations globally by default; one database owner per event/version.
- Three lifetime paid attempts per version, with shared cooldown and conservative uncertain-outcome reconciliation.
- Cached reads remain unrestricted by generation budgets.
- Existing kill switch, model daily caps, token cap and optional provider-credit gate remain in force.
- The request reserves worst-case peak-rate cost before transport; actual usage is assigned to typed ledger columns afterward. Unknown outcomes remain reserved, not silently counted as zero.
- `NODE_ENV=test` or `CI=true` rejects real provider transport before sending. Normal validation uses fake transport and test-only keys. No live provider experiment is required or authorized.

See [Code-first financial policy](code-first-news.md) for settings, SQL reporting, failure handling and migration rollout. Provider prices must be kept current through the normal reviewed configuration/code process; application caps cannot control unrelated use of an API key or external billing changes.
