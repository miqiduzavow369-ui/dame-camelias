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

## Checkpoint 7 — monthly planning and all-plans screen (2026-10-24)

Implemented on the isolated draft branch:
- Private `CityDiaryStore.createBatch`: up to 31 independent events per operation, written atomically with one operation receipt. If any event is invalid or an ID duplicates another, none of the events are committed. Repeating the same operation ID and exact payload returns the prior outcome.
- `cityDiaryRequest` validates ownership of **every** profile in the batch before calling the store. Public signed `/api/anketa/mini-diary` forwards the `batch` action and items, routed into the existing per-client coordinator.
- Standalone preview now supports toggling multiple gold-highlighted calendar days, count/summary, bulk save, and switching between selected-day and all-plans lists.
- Crucial safety boundary: bulk creation is currently **reminder-only**. Publishing 5–15 identical reviews through a shared template is disallowed until per-event authoring, ratings and financial reservations exist. Single future publication records are still planning-only, never live submissions.
- New store/RPC/UI tests cover rollback, idempotency, ownership and UI controls. The isolated City diary workflow succeeded in GitHub Actions run `40082962989`.

Pending before a real launch:
1. Design per-date publication drafts, individual rating choices and separate credit reservation/release.
2. Implement reliable reminder alarms, delivery, acknowledgments, retry/reconciliation and explicit IANA timezone semantics.
3. Address suspended/deleted profiles, changed IntimCity domains and current site version/preflight before any external operation.
4. Implement end-to-end authenticated Cloudflare/Telegram testing, client preview, regressions and final owner approval.
5. Keep PR #284 as draft; do not merge, touch ADMIN, ASHOO, Yan First or production.

## Checkpoint 8 — isolated reminder-delivery state machine (2026-10-24)

Inspected `src/reminders.js`: the existing `OrderReminder` Durable Object contains order follow-up alarms, moderation outbox and financial settlement retry alarms. A naive new `setAlarm` in the same object would risk overwriting another workflow's next alarm. **No existing alarm, ADMIN, or credit workflow was modified.**

Added:
- `src/city_diary_delivery.js`: pure sorted next-due/due-list selectors; at-most-once delivery attempt claiming by event and nonce; delivery states `claimed`, `sent`, `delivery_unknown`, `delivery_failed`, `acknowledged`, and plain-text reminder message formatting. Uncertain Telegram results are NOT blindly resubmitted.
- `tests/city_diary_delivery.test.mjs`: ordering, claimed suppression, repeated claims, unknown outcomes, message-bound acknowledgements, no publication-mode impersonation.
- CI now runs the delivery tests; **passed**: https://github.com/miqiduzavow369-ui/dame-camelias/actions/runs/40083538965 (job `120841763420`).

Implementation boundary:
- This is a pure, tested planning/notification **state machine**, NOT a live scheduler: no Durable Object alarm registration, Telegram network sends, callback handler or «Спасибо» message removal is connected yet.
- Prior to live scheduling choose and test dedicated per-client scheduler DO instances or a centralised multi-purpose alarm arbiter; never override existing DO alarms.
- On actual claim persist the record transactionally **before** invoking Telegram. If its result is unknown, retain `delivery_unknown` and reconcile or inform operators instead of blind retry. Only acknowledge a message using its stored Telegram message ID and verified owner callback. Preserve event/audit record after dismiss.
- Differentiate free reminders from publication confirmation notices. Publication timing must not submit anything without client action, current verified site/domain/profile, permissions, ADMIN moderation and credit safeguards.

## Critical invariant — manual City publication history wins (owner requirement, 2026-10-24)

A diary event is **never** permission to repeat an action already performed manually in City.

- The authoritative key for conflict detection is **male account + profile ID + publication kind** (rating or review), not merely profile ID. Treat both `published` and in-flight/reserved/moderated/verifying states as blocking, subject to the existing City semantics.
- Check against existing manual publication history and current claim/moderation states **at plan creation, before scheduled confirmation, and at the final submit boundary**. The final check must use the existing atomic guard. The diary must never maintain a parallel authority that overwrites City.
- If a review is already published or in progress, only a still-eligible rating may be planned; vice versa. A combined rating+review request is invalid unless both are available. Other men do not inherit this particular man's per-profile publication claim, but applicable shared profile limits remain enforced.
- If manual City completes an action after a diary plan was saved, mark the conflicting planned action unavailable and explain it to the client. Do not silently repeat it, consume a credit, or delete unrelated events.
- This is a **required future integration**. Current diary model uses profileId and kind but does NOT yet persist an explicit male account identifier. The preview's planning UI is therefore insufficient for final per-man eligibility checks. Do NOT enable scheduled publication/credit holds until this is implemented and tested. Manual City must remain unmodified.

## Checkpoint 9 — manual City invariants and isolated scheduler prototype (2026-10-24)

**Owner's non-negotiable requirement:** The existing manual City must run exactly as before. Do NOT modify its order/review/rating flows, moderation, 29 men's accounts, Yan First, or credit accounting to add the diary. The diary is a scheduling layer, not a second platform.

**Shared men/history invariant:** Diary selects male account IDs from the same `MAN_ACCOUNTS` registry and names visible to current clients. The planning preview reads `men` / `secondaryStatuses` / saved profiles from existing `mini-preview`, displays the selected man's existing rating/review status per profile, and visually flags already-published or in-progress actions. New plans may contain validated `accountId` (e.g. `yan_first`, `yan_second`); `city_diary_rpc.js` rejects IDs outside the actual City registry. No credentials, proxies or raw site origins enter diary records.

**NOT YET authoritative:** The client-side status display can be stale. The diary API does not yet enforce a strong manual-history/claim check for each (accountId,profileId,kind) at creation and at execution. Therefore, do not activate publication confirmations, credit reservations or automatic submission until this is implemented against existing authoritative City locks and rechecked after domain/site version changes. Legacy plans without accountId require migration or fail-closed final execution.

**Isolated scheduler:** `src/city_diary_scheduler.js` is an independent Durable Object *prototype*, explicitly not registered in `wrangler.toml`, not exported from Worker entry point and not routed from existing cabinet. It contains an internal-secret gate, per-user storage guard, replacement snapshot, isolated alarm, Telegram at-most-once attempt recording and internal acknowledgement state. No production notification will be sent from this branch without deliberate registration/routing/deployment, and no existing `OrderReminder` alarm is altered. The `citydiary:thanks` callback is NOT wired to a real Telegram dispatcher, so pressing it cannot yet acknowledge/delete a live message.

**CI verified:** https://github.com/miqiduzavow369-ui/dame-camelias/actions/runs/40085996640 — syntax and isolated diary unit tests concluded success (job 120848941991).

**Critical scheduler hardening remaining:** authoritative identity enforcement at the coordinator-to-scheduler boundary (internal secret alone does not prove that a caller-supplied userId matches its DO ID), revision-safe delivery snapshots, stale/cancelled-event races, storage alarm and transaction crash testing, Telegram callback identity verification, deleteMessage fallback, transparent reconciliation of uncertain sends, scheduler registration/migration and feature gating. Do not connect until these are tested. Code review must confirm all of this before first real dispatch.

**Next:** enforce shared male+profile+kind eligibility through *read-only* authoritative City status and existing atomic publication guard without changing any manual system code; prepare individually authored per-event publication drafts, domain-change preflight, credit holds; finish reminders in isolated safe staging and test all City regressions before deployment.

## Checkpoint 10 — read-only manual City publication eligibility (2026-10-24)

- New `src/city_diary_eligibility.js` checks the combination **male City account + saved profile ID + action kind (review/rating)** against the existing manual City publication archive, current states, and other non-cancelled future diary publication plans.
- Existing `src/cabinet_runtime.js` `mini_diary` handler now supplies an authenticated, read-only adapter to `readPublicationArchive`, the canonical `owner_anketa_publication_v1` records for Yan First, and per-male secondary rating/review progress. It does not edit the manual publication code.
- `src/city_diary_rpc.js` checks conflicts for publication plan **create/edit**, before the private DO stores the event. Rejections are `already_published`, `action_in_progress`, `already_planned`, or `eligibility_unavailable`. Ratings remain independently plannable when only review was published.
- New tests: `tests/city_diary_eligibility.test.mjs` and API regression coverage in `tests/city_diary_rpc.test.mjs`. Confirmed passing GitHub Actions: https://github.com/miqiduzavow369-ui/dame-camelias/actions/runs/40086707212 (job 120851019871).

**Safety boundary:** Read-only state at creation is **not** an atomic execution permission. Before any future live publication, verify manual City state AGAIN immediately before scheduled confirmation and the final existing atomic submit/credit guard. Unknown or outdated review/rating status, secondary runner claims, external site/domain/config versions, profile disablement, and concurrent manual actions require fail-closed final execution. No scheduler-triggered submissions, credits, or ADMIN paths enabled.

**No changes to production:** Manual City rating/review routes, Yan First and 29 other men, ADMIN, credit modules, ASHOO, `wrangler.toml`, main, and live Cloudflare deployment remain untouched. PR #284 is an isolated feature branch.

## Checkpoint 11 — manual City recheck before publication confirmation (2026-10-24)

This stage introduces a **read-only recheck**, not a publication executor.

- Signed Telegram `POST /api/anketa/mini-diary` now accepts `action:"recheck"`. The existing private per-client Durable Object routes it to `cityDiaryRequest`.
- For a saved future publication, it checks an optional expected revision, current ownership of the same saved profile, and the latest manual City archive/progress for the selected male account and each relevant action kind; it excludes the current diary event from duplicate-plan checks. A manual review published after planning is detected here.
- The response always returns `publicationAuthorized:false`, `siteCheckRequired:true`, `requiresClientConfirmation:true` and `requiresExistingCityGuard:true`. It cannot initiate payment, moderation, login or publication. No automatic status transition or cancellation is performed by this read-only action.
- The preview calendar now shows a separate `Проверить готовность` control on future publication cards; it explains that no actual publication occurred.
- Added API/UI regression tests for changed manual publication history, stale revision and read-only semantics.

**Important remaining gaps**: Read-only statuses such as `unknown` do NOT authorize execution. Existing manual City atomic publication claim, current domain/profile/credentials version and applicable per-man runner readiness MUST be rechecked when implementing the final approval route. Conflict-free planning is not publication permission. No live scheduling is enabled.

**Manual City guarantee:** No modifications to manual rating/review flows, order/moderation, credit accounting, existing alarms, ASHOO, or deployed Worker. Feature branch PR #284 only.

## Checkpoint 12 — fail-closed website/version diagnostics (2026-10-24)

- Added `src/city_diary_preflight.js`: pure connection-diagnostic evaluator, with negative checks for changed domain, unconfirmed profile, unverified current version, male identity and owner approval. A positive diagnostic explicitly returns `publicationAuthorized:false`.
- The signed, read-only diary `recheck` now reports `siteReady:false` and `siteReason:"connection_unavailable"` until the trusted owner-side read-only site/proxy/identity status source is wired. The interface distinguishes manual publication history from unverified live website readiness; absence of a conflict is NOT a green light.
- Added `tests/city_diary_preflight.test.mjs` and included it in isolated CI. GitHub Actions **passed**: https://github.com/miqiduzavow369-ui/dame-camelias/actions/runs/40087305181.
- No website requests, login, publication, Telegram sending, credit reservation or manual City modification are performed.
- Before any actual scheduling of publication confirmations, wire authenticated owner-DO readiness snapshots with version binding and strict origin rules; re-check at the final atomic City publication guard. For Yan First, do not infer a site grant from secondary accounts or change the legacy route.

**Remain on draft PR #284; do not merge/deploy.**

## Checkpoint 13 — audit corrections (2026-10-24)

An end-to-end specification-to-branch audit identified and repaired three concrete issues, without editing manual City paths:

1. **Male IDs 03–30:** `src/city_diary_model.js` mistakenly used a double-escaped `\\d` inside a JavaScript regex literal. Replaced with a bounded identifier pattern accepting the original existing City IDs `yan_first`, `yan_second` and `yan_03` through `yan_30`. Added model coverage for all 30 accounts and invalid IDs.
2. **Write success followed by refresh failure:** In `anketa/city-diary-preview.html`, successful create/edit/batch writes are now definitively acknowledged *before* the next list refresh. If refreshing fails, UI tells the user the write succeeded and **not** to save it again. Failed/unknown write responses retain stable retry operation tokens. Cancellation similarly distinguishes a successful cancel from refresh failure.
3. **Cross-timezone editing:** cards display the saved IANA timezone's clock time rather than the new device timezone. Editing an event whose original IANA timezone differs from the current device timezone is blocked with an explicit warning, preventing silent rescheduling. This is a safety stop, not a full cross-timezone editor.

GitHub Actions: https://github.com/miqiduzavow369-ui/dame-camelias/actions/runs/40089456182 — diary unit/syntax checks passed. Existing cabinet, Mini App, isolation, review and secondary runner checks also passed for the same branch commit. Do not claim device-level E2E or full time/DST correctness.

**Still required:** durable client-side idempotency after Web App reload, authoritative recheck of every manual City claim at actual execution, DST-fold/gap UX tests, a sustainable archive/active-plan quota model, runtime scheduler wiring with owner-safe callback handling, credit holds/returns and existing ADMIN integration. Manual City, ADMIN, Yan First, all other men, ASHOO, wrangler.toml, main and Cloudflare deployment remain unchanged.

## Checkpoint 14 — DST safety and identical-event replay guard (2026-10-24)

- Added `localTime` to newly created diary plans, stored alongside UTC `at`, original `localDate`, and IANA `timezone`.
- Server checks that the intended wall-clock time matches its UTC instant. Ambiguous fall-back DST minutes (e.g. 02:30 in Stockholm on 2026-10-25) are refused with `ambiguous_local_time`, not silently rounded to one of two instants. Spring-forward missing minutes fail the wall-clock check; UI offers a clear error. Legacy saved events without `localTime` remain supported.
- `addDiaryEvent` now rejects an **indistinguishable active event** with the same mode, action, UTC timestamp, profile, male account, review text and note, even if a restarted Mini App generates a new ID or operation token. Different times/actions/men/notes and multiple events on the same date remain allowed. Cancelled events can be rescheduled deliberately.
- The authenticated planning adapter returns `duplicate_schedule` as 409 Conflict, and the calendar explains that the existing entry can be found in «Все планы».
- Added tests for 2026/2027 Stockholm DST fold/gap, legacy time compatibility, restart duplicates and independent plans.
- GitHub isolated diary CI: https://github.com/miqiduzavow369-ui/dame-camelias/actions/runs/40090211980 — **success**.

**Boundary:** This is server-side duplicate prevention, not complete client-side restoration of an interrupted edit form or pending operation nonce. Full archive/retention of terminal events is still pending. The active storage limit remains 120 events including historical ones. Do not purge completed/failed/cancelled records without a separate transactional archive and audit policy.

No live publication, credit, moderator, site login, Telegram alarm registration, main merge or production deployment. Manual City/Yan First/29 other men/ADMIN/ASHOO are unmodified.

## Checkpoint 15 — transactional cancelled-reminder archive (2026-10-24)

- Added separate `city_diary_archive_v1` storage within the same signed per-client Durable Object. `CityDiaryStore.archiveTerminal` transactionally transfers eligible terminal records, keeps their original event contents, revision and status, adds `archivedAt`, removes them from the **active** 120-entry collection, and commits an operation replay receipt together. Archive records remain retrievable by `get` and `listArchive`.
- The only **publicly exposed archive mutation** is `archive_cancelled_reminders`. It explicitly checks that every selected event is a cancelled **reminder**, not a publication. Active/in-flight orders and completed publication records are never archived by this API. Publications require separate proven outcome/credit-reconciliation rules before a future archive.
- The preview adds an Archive tab and a deliberate «Перенести в архив» button on cancelled reminders in «Все планы». The history is preserved. No automatic pruning or deletions were added.
- Tests cover transactional rollback when a receipt write fails, idempotent replay, stale revisions, safe retrieval, denial of active events/publications, and reuse of archived IDs. GitHub Actions isolated diary checks: https://github.com/miqiduzavow369-ui/dame-camelias/actions/runs/40090937869 — success.

**Remaining caveats:** the archival collection is append-only with no retention limit/pagination yet. It is not an off-platform backup. Full client restart/edit recovery and reconciliation of uncertain Telegram delivery remain future work. No real Telegram messages are sent. No manual City publication/admin/credit code, legacy Yan First, other men, ASHOO, main or deployed Worker changed.

## Checkpoint 16 — private form recovery and archive pagination (2026-10-24)

- The client's incomplete diary form now saves into its **existing authenticated private per-client Durable Object** as `city_diary_form_draft_v1`. Only allowlisted fields are accepted (mode, local date/time, profileId, City male accountId, action, review text, personal note, optional editingId). Raw proxies, passwords, site URLs and authorization proofs are rejected. Draft is a preparation aid only: it never authorizes an action, reserves credits or enters ADMIN.
- Mini App form inputs trigger debounced private draft save (plus an explicit Save Draft button), and the next Telegram Mini App launch retrieves/restores that draft. Saving an event successfully or explicitly cancelling form editing attempts to clear the draft. The draft's server-side TTL is 30 days; no browser localStorage was introduced.
- Private archive retrieval now offers bounded `archive_page` requests with offset, max 50 per page, total and hasMore. The preview displays 30 results per page with previous/next. **Pagination is bounded over the wire, not a scalable physical database index**: current DO still reads the complete archive array to compose pages. A large future archive may require sharded or SQL-backed storage, integrity snapshots and formal retention policy.
- Tests: private restore across store recreation, cross-client isolation, expiry, field allowlist, archived pagination, and signed planning RPC recovery without turning any draft into a publication.
- No Telegram live alarms, real posting, credit manipulation, ADMIN edit, or change to manual City orders/ratings/reviews. Feature remains draft PR #284; no production merge/deploy.

**Known limitations:** There is no durable operation nonce rehydration across restart; double-post protection is presently the server's exact active schedule conflict guard. Draft-save request races across multiple open devices still need server-side revision control. Old editingId drafts may be invalid if the original event was completed/cancelled meanwhile. Archive paging is not full off-site backup. DST and final-site preflight remain guarded, not launched.
