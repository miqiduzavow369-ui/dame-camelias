# DAME CAMELIAS — client route parity audit, 2026-10-18

## Observed state (not a claim of runtime parity)
* `anketa/mini-preview.html` renders the same rating/review subview for each selected man **in appearance**, but `selectAccount` rejects every account except `yan_first`.
* `src/owner_anketa.js`: `ACTIVE_ACCOUNT = "yan_first"`. State machine, `chooseAccount`, rating drafts, review moderation, publication locks and actual GitHub workflow dispatch all route to legacy Yan First.
* `src/cabinet_runtime.js` mini_preview: display statuses and activity flow are derived from legacy archive, global credit ledger, and Yan First's state. Read-only client DTO cannot authorize publication for another man.
* `tools/intimcity_profile_lookup.py` and `.github/workflows/intimcity-profile-lookup.yml` are configured from the legacy global proxy/Intimcity secrets. They are **not** per-man browser executors.
* Server capability for each future man must be checked again on every write: stable actor identity, man ID, per-man session & proxy version, verified outgoing IP, website identity, consent, saved profile identity, balance, per-profile and day locks, and state/nonce isolation.

## Implemented here
* Single shared `LEGACY_CLIENT_ROUTE` stage contract for 30 men, documenting expected rating and review steps.
* `mini_preview` returns a signed Telegram-user-bound, read-only 30-man list from the server. 29 are `route:not_connected` and locked; no arbitrary client field can unlock them.
* Client uses server list for identity and status while preserving existing Yan First flow.

## Required before honest 100% runtime parity and unlocking
1. Separate verified egress executor, credentials and session for every new man, with failure without direct fallback.
2. Server-side identity and pinned IP verification recorded against exact config versions, with explicit owner activation and availability status; both encryption keys must be installed first.
3. Extend all *authenticated* client write endpoints with a verified account ID; do not borrow existing legacy `ACTIVE_ACCOUNT`, state, archive/draft keys, callbacks or proof route.
4. Implement identical rating/review UI and publication state transitions, moderated review approvals, duplicate/day locks, credit reservations/settlement, receipts and screenshot retrieval for every account. Enforce max two publications per woman per Moscow day across men.
5. Isolated browser workflow per man, selectors/navigation copied from Yan First, read-only diagnostics and production proof verification. Never automatically repeat an ambiguous submit.
6. Tests for male switching, cross-account session isolation, failed IP, invalid login, rollback, duplicate concurrent operations, and client UI badges. Verify Yan First baseline separately.

No site logins, rating writes or publication dispatches are performed by this audit.
