# DAME CAMELIAS — isolated 30-man staging, no production access

## Status
Source-only preparation on `feature/yan-multiaccount-foundation`. Not deployed and not merged. The existing Worker `dame-camelias`, production KV, customer balances, Telegram chat flows, and `yan_first` must remain untouched.

## Boundary
- Isolated Wrangler configuration: `wrangler.man-staging.toml`
- Independent Worker name: `dame-camelias-man-staging`
- Independent Durable Object class / binding: `ManStagingAccounts` / `MAN_STAGING_ACCOUNTS`
- No existing KV ID, production Durable Object binding, routes, proxy, site, or GitHub workflow dispatch.
- Only `GET /health` and owner-signed `POST /api/man-staging` are implemented.
- `list`, `history`, `draft(plan/reset)` only; account credentials and account activation are not supported.
- Stage operations are atomic and permanently unable to authorize website activity.

## Manual release prerequisites — not performed
1. Verify the feature-branch GitHub Actions suite passes, including `tests/man_admin_http_integration.test.js` and `tests/man_staging_worker.test.js`.
2. Obtain a **separate staging bot token** in Cloudflare Worker secrets named `MAN_STAGING_BOT_TOKEN`. Do not copy production bot token, proxy details, GitHub Actions secrets, KV IDs or live data.
3. Review deployment target and Cloudflare account permissions. Do not configure any production Worker name, route, KV or Durable Object.
4. Explicitly approve a **manual staging-only deployment** before running `wrangler deploy --config wrangler.man-staging.toml`. This is a future manual step, not a CI step.
5. Use Telegram Mini App signed `initData` from the staging bot only; never place a real token or signed initData in source or logs.
6. Test: nonowner returns 403; owner sees exactly 30 registry entries; `yan_first` cannot be changed; 02–30 cannot publish; plan/reset persists and audit is isolated.
7. Staging rollback: disable/remove only `dame-camelias-man-staging`; preserve production resources.

## Explicit non-goals until final stage
No real site logins, password collection, proxy IP or port entry, automatic account activation, credentials saved in KV or GitHub, publication, credit deduction, customer migration or production merge.

## Known limitations
This staging worker validates server API behavior, not full original Mini App screens; UI verification needs an explicitly configured Telegram staging entry point and manual review. GitHub Actions success and Cloudflare integration testing must be observed rather than inferred from static checks.
