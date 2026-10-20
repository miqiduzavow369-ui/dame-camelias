# Secondary-man Chromium callback: staging contract and unconnected components

## Implemented on PR #207
- `POST /api/secondary-man/result` authenticates `Authorization: Bearer <ANKETA_CALLBACK_TOKEN>` in `cabinetEndpoint`.
- `cabinet_event` dispatches to the client-specific Durable Object using the `user_id` field; the handler also verifies `body.identity.userId === user_id`.
- `SECONDARY_CALLBACK_HMAC_KEY` must be a separate 64-character hex secret in Cloudflare and a controlled runner. It is **not** configured by this PR; missing secret returns HTTP 503.
- The callback body has `user_id`, `identity`, `input`, `token`, `signature`.
- The `input` includes the same identity, version-pinned `proxyVersion` and `siteVersion`, timestamp `issuedAt`, `status: verified_published`, and verifiable `sitePublicationId`, `proofFileId`. A signed response must match the one-use ticket and the stored attempted publication.
- Server reads `independentAuthorConfirmed` and `moderatorApproved` from the **stored publication claim**, not the callback body; absent values fail closed.
- On valid receipt, the one-use ticket becomes consumed and proof is recorded using the existing per-client/per-man module; credit completion is deliberately **not** automatically invoked from the public callback.
- Existing Yan First endpoint `/api/anketa/result` stays unchanged.

## Still missing (do not claim ready/deploy the whole branch)
1. A trusted server-only path creating a publication claim with author consent and moderation approved and verified, plus a reserved credit and current approval/version check. No callback can run successfully unless these stored fields are present.
2. Issuance of an individual ticket to the authenticated Chromium job via a narrowly scoped runner payload. The plain ticket and HMAC secret must never appear in browser DOM, client Mini App, logs, or screenshots.
3. Chromium runner flow that obtains personal credentials/proxy and performs a real, author-consented operation; must upload the actual immutable original screenshot to Telegram and obtain its real file_id before issuing a signed callback.
4. Reconciliation worker for partial proof records and uncertain ledger outcomes. Never automatically retry the site POST.
5. Verified credit settlement in private server-owned code, reading receipt + prior reservation. No client-supplied flags.
6. Remove the 8 existing failing regression tests (or document verified justified changes) before enabling production.
7. Run a supervised live read-only identity check with Mikhail prior to any live publication. Check site terms and independent authorship.
8. After testing, deploy a reviewed, compatible set of changes with rollback and no changes to Yan First.

## Test acceptance
- `tests/secondary_man_signed_receiver_wiring.test.mjs` verifies transport authentication and server-owned moderation/consent.
- `tests/secondary_man_callback_ticket.test.mjs` covers one-use claim, identity/version constraints, expiry and replay.
- `tests/secondary_man_callback_attestation.test.mjs` verifies account-bound HMAC.
- `tests/secondary_man_result_settlement.test.mjs` verifies proof/ledger linkage and manual reconciliation requirement.

**No automatic ratings/reviews for secondary men are enabled by this receiver.**
