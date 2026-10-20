# Automatic client activation — accounts 02–30

**Target behavior:** each of the 29 secondary men becomes usable in the client cabinet after authenticated ADMIN approval, with no per-man code changes. The approved man must have a verified, proxy-bound Intimcity identity and a fully tested account-scoped publication executor. Approval alone must not open an unfinished executor.

## Shared workflow (no duplication)
- Use Yan First's verified search-result navigation, rating form mapping, review typing in two parts **on the same page without reload**, one-time submission claim, publication result verification and screenshot proof.
- Select only the approved man's saved proxy and Intimcity credentials by exact account_id. Enforce matching egress IP and proxy/site version. Do not fall back to Yan First.
- Keep each client's operations scoped by client ID + man ID + profile ID + operation ID; histories, moderation, credits, receipts and callbacks must not cross men or clients.
- Preserve yan_first unchanged. Keep yan_second and yan_03..yan_30 IDs stable.

## Server-side activation requirements
1. Authenticated owner ADMIN action records an approved specific account ID with expected configuration version.
2. Verify latest proxy IP, bound website credentials and site identity for precisely that man.
3. Verify shared publisher deployment and account-bound callback/ledger/proof handling are operational.
4. Expose `enabled=true` in server-driven client catalogue **only** when all prior checks pass.
5. Cancel availability immediately on failed verification, credentials/proxy rotation or manual ADMIN suspension. Fail closed for in-flight operations.
6. Retain per-account immutable idempotency keys and once-only external submissions. No cross-account fallback on failure.

## Current blockers
- The existing `clientMenAvailability()` still enables only Yan First.
- `owner_anketa.js` still hardcodes Yan First state, archive, owner moderation and publication routing.
- The legacy GitHub Actions publisher still uses single shared secrets rather than per-man, per-operation secure claims.
- The new `secondary_man_client_route.js` is an identity and callback foundation, not a deployed publisher.
- No production owner approval endpoint connected to client activation, no audited per-man ledger/proof settlement yet.

Do NOT flip `enabled` for secondary accounts merely because this document or the isolated route contract exists. All 29 will share one executor once the above components are wired and tested.
