# Publication guard and proof: implementation contract

Related: #57 (proof), #59 (account isolation). Status: **design only, not deployed**.

## Verified main baseline (2026-10-13)

- `src/owner_anketa.js` uses `owner_anketa_publication_v1:<kind>:<profile_id>` in Cloudflare KV, with a hard-coded historical `yan_first/rating/652282` published result. **Never retry that submission**.
- `recordPublication()` performs KV get then KV put; this sequence is **not atomic**. Concurrent callbacks may both pass the initial read.
- `ownerDryfillPayload()` also consumes a publish grant by reading/writing expiring KV state. This is not an atomic consume.
- GitHub Actions concurrency serializes runs for the same profile but does not replace an atomic pre-dispatch grant. Never assume it prevents duplicate dispatches.
- Account picker from PR #60 permits `yan_first` only. `yan_second` has no live credentials.
- Worker deployment has not been verified by this document.

## Required atomic publication protocol

Use a **Durable Object with SQLite storage** (or another datastore with a demonstrated atomic unique insert / compare-and-set), explicitly bound to the *existing* Worker. Do not use a new Worker or Telegram bot. Name the singleton/coordinator deterministically for each pair `(site_account_id, profile_id, kind)`; authorize only `yan_first` until a separate explicit rollout.

1. Validate owner identity, selected account, exact profile, kind, state nonce, approval freshness, and preserved legacy lock before mutation.
2. Execute an **atomic claim** with unique key `(site_account_id, profile_id, kind)`; only one contender receives a random one-time grant. If a claim already exists in ANY terminal/uncertain status, reject. No expiry or automatic unlock.
3. Before external dispatch, persist `claimed` and grant. Dispatch failure or unknown response must **not** revoke the claim automatically.
4. Runner redeems grant **atomically, once**, before any HTML form submission; reject replay or different account, profile, kind, run ID, or nonce.
5. Persist `submission_maybe_sent` **before** clicking submit. On timeout, cancellation, proxy failure, missing acknowledgement, or callback failure keep the permanent lock, with status `needs_verification`.
6. Only mark `published` after proof matching the exact publication has been verified and delivered to owner's Telegram. Positive site alert alone is insufficient.
7. Never automatically resubmit while investigating missing proof. A read-only check has a distinct job mode, no submission credentials/grant, and cannot call submission functions.
8. Model `yan_first` legacy `v1` KV entries as permanently claimed, including the hard-coded verified `rating/652282` entry. Migrate/read legacy before any dual-account cutover; absence of KV or coordinator binding must fail **closed**.

Suggested immutable state transitions:
`unclaimed -> claimed -> submission_maybe_sent -> needs_verification -> published`.
An evidence delivery failure leaves `needs_verification`; it does not reset eligibility.

## Proof collector (#57)

- Remain in the authenticated Playwright browser context and same assigned proxy after submission, but restrict navigation to the allowlisted Intimcity host. Verify that no redirect crosses to an untrusted domain.
- Once owner supplies a redacted screenshot of the **«Проверенные»** section, inspect the actual page DOM in **read-only** mode. Do not guess selectors.
- Match the exact profile ID, posting account, timestamp and publication identity. If multiple candidates match or the view is ambiguous, do not report proof.
- Screenshot the matching visible record alone, excluding account metadata, cookies, credentials, unrelated entries and third-party personal data. Enforce size limits.
- Return proof through authenticated Worker callback with bounded request size, nonce/replay checking and no public artifact/log upload. Deliver to owner via Telegram `sendPhoto`.
- Confirm **only when both the evidence match and Telegram delivery succeed**. Report `needs_verification` otherwise.
- Lady Fox 652282: read-only verification **only**. Never run `publish` mode for this pair.

## Account isolation (#59)

- Introduce explicit account allowlist and account-specific secrets/proxy/login selection in Actions; never fall back from `yan_second` to `yan_first`.
- Never allow the state or grant for one account to authorize actions for another.
- Keep ratings and reviews as distinct permanent lock kinds, with shared identity protection against duplicate-account circumvention where site policy disallows it.
- Keep `yan_second` disabled until site rules and independent access settings are verified.

## Acceptance tests before enabling mutation

1. Two parallel `publish_confirm` invocations for the same tuple: exactly one claim; exactly zero/one dispatch; the loser is denied.
2. Two parallel grant redemptions: exactly one redemption; retry of same grant is denied.
3. Restart, chat deletion, profile deletion, KV eviction and new sign-in: claimed tuple stays blocked.
4. Legacy `rating/652282/yan_first` never offers publication even if legacy KV is missing.
5. Callback timeout / site timeout / missing entry / Telegram photo failure: no second submission, status `needs_verification`.
6. Simultaneous `yan_first` / `yan_second` requests cannot share credentials, proxy, grant or evidence.
7. No public GitHub logs or artifacts contain rating selections, evidence images, login or proxy credentials.
8. Distinct read-only verification run proves it cannot reach submission code.
9. Cloudflare environment binding and migration verified **after deployment**, separately from merged GitHub PR.

**Release gate:** do not enable additional live publication while atomic guard is absent. Changes to this document alone cannot fix the live race.
