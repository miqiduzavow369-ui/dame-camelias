# City premium diary — implementation checkpoint 1

This branch is deliberately **not** ready for deployment. Main/production is unchanged.

## Added
- `src/city_diary_model.js`: pure, side-effect-free, per-event planning model.
- `tests/city_diary_model.test.mjs`: tests for validation, independent month entries, revision conflicts, state transitions, and date filtering.

## Domain decisions
- Event modes: reminder / publication.
- Actions: profile / rating / review / rating_review.
- Event timestamps use canonical UTC ISO 8601; future UI converts to the client's selected timezone, displayed explicitly. Calendar days must be computed in that timezone, not by slicing UTC timestamps.
- Scheduled publication requires an existing profile and the text for a review. This plan alone grants no authorization to publish.
- Status 'awaiting_confirmation' means Telegram has requested user confirmation; 'submitted' means handed to existing City processing; 'completed' requires verified success from that processing.
- Reminders need a separate delivery/acknowledgement life-cycle before integration; no automatic transition is performed by this pure model.
- Cancellation of a scheduled plan is separate from cancelling an already submitted publication.
- Credits are **not** touched at scheduling time by this checkpoint. Integration must avoid locking existing publication claims months in advance, especially if several planned events target the same profile.
- Stored review text and all profile data are private client information; no URL-accessible read APIs without Telegram authentication.

## Required before integration
1. Inspect existing Web App / Mini App views and bot navigation.
2. Design private per-client DO event storage; enforce auth and optimistic revision concurrency.
3. Add dedicated alarms or appropriately shared per-user scheduling, including retry and no duplicate deliveries.
4. Design credit holds and cancellation policy with the existing publication guard, daily profile caps, ADMIN queue and settlement.
5. Add black-and-gold month calendar and Telegram notification messages.
6. Add integration tests (Telegram failures, idempotent callbacks, restart/retry, credit reservation, proof-based completion).
7. Run repository test suite and review all diffs before any production merge.

Local test command: `node --test tests/city_diary_model.test.mjs`.
No live publication, credit adjustment, Telegram send or ADMIN operation is performed by these additions.


## Checkpoint 2 — private event persistence (2026-10-24)

Added `src/city_diary_store.js` and `tests/city_diary_store.test.mjs`.

- Storage adapter is designed to run inside one **already authenticated and serialized per-client** Durable Object coordinator. It is NOT exposed as a public HTTP endpoint.
- Reads, creates, edits and state changes use a separate `city_diary_*` namespace; existing cabinet, credit and publication keys are untouched.
- Mutations require 16–32 character hex operation IDs, with stored replay receipts; changing the payload while reusing an ID is rejected.
- Editing and status changes require expected event revision. Cancellation is currently an event state change only, not a real credit release or Telegram deletion.
- Does not call Telegram, ADMIN, publication runners, credit ledgers, or external websites.
- Historical stage-2 note (superseded by checkpoint 3): writes were initially non-atomic; checkpoint 3 fixes them with a single Durable Object transaction.
- Isolation tests construct distinct per-client mock storages. Authentication and user-to-DO routing remain the responsibility of the existing cabinet runtime, and are NOT yet wired.
- Test files have been committed but were **not executed in this session**: the runtime could not resolve github.com to download the checked-in files for local Node testing.

Do not merge or deploy this PR yet. Next: atomic storage transaction, authenticated RPC adapter, timezone-aware calendar and reminder acknowledgement semantics, then end-to-end tests.

## Checkpoint 3 — atomic storage (2026-10-24)

The private store now **requires** Durable Object `storage.transaction` and writes event state and the operation receipt inside one transaction. A failure of either write aborts the entire change. There is no best-effort receipt commit anymore.

Added fault-injection tests for receipt-write failure and rejection of nontransactional storage adapters. Tests remain unverified until GitHub Actions or a full local checkout runs them. A direct container clone attempt failed because `github.com` could not be DNS-resolved; do not claim CI success from commits alone.

### Required before further integration
- Authenticate every diary HTTP/RPC operation with Telegram-signed identity and route to the corresponding client's isolated coordinator.
- Verify actual persistent object transaction behavior in the Cloudflare runtime and run complete Node/Python suites.
- Check domain changes before **every external publication attempt**. The existing secondary account's site version/proxy/login approval must not be bypassed by saved diary URLs. A changed domain must preserve plan data while disabling unverified submission.
- Never infer publication success merely from diary state.

## Checkpoint 4 — authenticated client planning API (2026-10-24)

Implemented:
- `src/city_diary_rpc.js`: allowlisted list/get/create/edit/cancel planning adapter. A newly planned or re-targeted profile is checked against the signed-in client's confirmed saved profile list. No publish/submit or credit actions.
- `src/cabinet_runtime.js`: `mini_diary` dispatch executes inside the already selected private per-client Durable Object, with client-active and agreement checks.
- `src/index.js`: `POST /api/anketa/mini-diary` validates signed Telegram Web App initData before looking up the private user ID, enforces payload size limits and disables caching.
- `tests/city_diary_rpc.test.mjs`: ownership, edit/cancel, idempotence, no publication transition.
- `.github/workflows/city-diary-checks.yml`: Node 22 syntax checks and isolated diary model/storage/API tests.

**Verified GitHub Actions success** for workflow run `40080685593` (job `120833409206`): both syntax and diary unit test steps concluded success.

### No live integration or rollout yet
- This branch is an open draft PR and is not deployed. The API is not visible to real clients yet.
- No Telegram reminders/alarms, interactive black/gold calendar, credit holds, publication workflow or ADMIN routing have been implemented.
- Ownership and signed-auth tests are not yet full HTTP integration tests; a future test must exercise the Worker endpoint with invalid/valid initData and the per-user cabinet coordinator.
- In particular, a changed IntimCity domain or changed site-account version must be revalidated before any eventual publication. A diary record is never sufficient authority to submit a review.
