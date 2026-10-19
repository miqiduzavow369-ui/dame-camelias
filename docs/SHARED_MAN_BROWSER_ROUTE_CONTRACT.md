# DAME CAMELIAS — shared browser workflow contract (Yan First parity)

Status: implementation specification, NOT production activation. This document does not authorize publication.

## Non-negotiable parity
The existing Yan First route in `tools/intimcity_profile_lookup.py` and `tools/review_live_workflow.py` is the behavioral baseline:
1. Use the selected man's proxy; verify public egress IP before touching the site.
2. Authenticate only with the selected man's approved Intimcity credentials, bound to that exact proxy version.
3. On Intimcity, search via `input#searchStr[name="phones"]`, trigger the matching search form, verify result identity and open the resulting profile tab. Never silently bypass search by constructing the target URL for publication.
4. Check profile URL/identity, applicable rating/review form, intended values and real HTML form submission contract.
5. For genuine owner-approved review text, use `stage_review_text`: fill the first half, press End, type the second half on the *same* page, verify exact text. Never refresh or navigate between these actions. This means two input phases, NOT two review submissions.
6. Preserve the one-time approval, permanent idempotency claim, final pre-submit audit, single external submit attempt and independent read-only proof verification. Do not retry an ambiguous external POST.
7. Return proof, history and settlement to the exact original `clientId + accountId + profileId + operationId` identity.

## Isolation that must be added before secondary accounts publish
- Current legacy `.github/workflows/intimcity-profile-lookup.yml` consumes common `PROXY_*`, `INTIMCITY_*` secrets, has no account_id and serializes by profile alone: this MUST NOT be used for `yan_second` or other secondary accounts.
- The new-men read-only site login preflight already securely claims data from `/api/man-site-login/payload` by account_id + nonce and checks expected IP. Reuse this security pattern; never put proxy usernames/passwords into workflow_dispatch input, command line, logs or callback payload.
- A publication coordinator must securely bind the specific account, saved site identity, verified proxy version, client, profile, operation nonce, approval and one-time claim. An account ID in a client request is never authorization.
- The legacy worker includes hardcoded `yan_first` state, proof and review archive keys. Do NOT rename, reuse or bulk migrate them. New accounts get individually namespaced keys and proof IDs.
- Guard server-side enablement behind authenticated ADMIN approval **and** verified proxy/site identity **and** complete integration acceptance. If those conditions fail, block publication rather than falling back to Yan First.
- Keep client-facing rating/review UI stages identical, but route to a shared executor only after account-scoped authorization is actually wired through Worker, GitHub Actions and callback.
- No automatic site submission in a test. Mock/sandbox all integration acceptance; run real publishing only after explicit authorized approval.

## Current implementation status
- PR #207 introduces a `yan_second` identity/operation key and callback identity contract. It is fail-closed, not connected to publication.
- `tests/yan_legacy_browser_contract.test.mjs` locks the existing browser stage order, two-step review text entry and existing secure claim distinction.
- Existing unrelated CI failures in main remain; targeted tests must pass independently. Do not treat those failures as permission to bypass account authorization or approval.
