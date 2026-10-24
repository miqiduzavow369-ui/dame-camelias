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

## Checkpoint 5 — black-and-gold calendar prototype (2026-10-24)

- `anketa/city-diary-preview.html`: standalone City-style black-and-gold Telegram Mini App calendar. Date selection is immediately gold, month navigation, selected-day plan cards, profile selector from `mini-preview`, reminder/publication planning modes, edit and cancel, local-date/UTC storage conversion.
- `GET /anketa/diary-preview` serves a no-data Telegram login bootstrap; signed `POST /api/anketa/diary-preview` verifies access to the private Mini App and loads only the pinned feature-branch HTML. This is an isolated preview, **not linked from the existing client navigation**.
- The calendar uses existing `POST /api/anketa/mini-diary` storage APIs. No message scheduling, publishing or credit mutations. Preview banner explicitly states these are not yet active.
- `tests/city_diary_ui.test.mjs` checks syntax of embedded JS, expected City black/gold tokens, DOM-safe text insertion and absence of external publication commands.
- CI result: isolated diary workflow **success** at https://github.com/miqiduzavow369-ui/dame-camelias/actions/runs/40081113880 (job 120834699107).
- The code has NOT been deployed or tested in a real Telegram client; visual device testing, authenticated end-to-end Worker tests, DST scenarios, persistent reminders and full monthly-batch planner remain pending.
- Explicit requirement: before real execution of a scheduled task, resolve IntimCity site/profile freshness and invalidate outdated account/proxy approvals. This calendar deliberately stores stable profile IDs, not pinned site hostnames.

## Checkpoint 6 — reconciliation fixes (2026-10-24)

After comparing the product specification and memory handoff with the branch code:

- Calendar month arrows now update selected day to the first of the displayed month; the selected-day list and the date field stay consistent.
- New events preserve both canonical UTC instant and client-local date plus an IANA timezone. The domain model checks that the provided local date agrees with the instant in that timezone, and supports edits to timezone/localDate. Earlier events lacking these fields still use legacy device-local presentation; migrate or explicitly address them before live scheduling.
- The Mini App reuses operation/event identifiers across repeated submission attempts of the *same unchanged payload*, and reuses cancellation operation IDs for the same event/revision. This improves retry safety but refresh/restart reconciliation requires more engineering; do not regard this as durable end-to-end exactly-once delivery.
- Tests added for timezones, invalid dates and UI retry/month behavior.

**Still out of scope:** alarms, Telegram notifications, credit holds, real website checks, ADMIN orders, batch monthly creation, full list view, confirmed DST fold handling and real-device end-to-end tests.

**Critical**: The signed preview uses browser timezone; timezone preference, DST ambiguity resolution, explicit notice before reminders and stable schedule semantics must be implemented before any notification dispatcher is turned on.

**Critical domain-change rule:** planned events reference confirmed profile ID, not a fixed domain. On eventual execution require verified current profile location and renewed site identity/proxy/permission proofs for changed IntimCity domain. Never retry an uncertain external submission.
