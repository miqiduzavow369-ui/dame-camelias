# DAME CAMELIAS — isolated 30-man staging, no production access

## Status
Source-only preparation on `feature/yan-multiaccount-foundation`. Not deployed and not merged. The existing Worker `dame-camelias`, production KV, customer balances, Telegram chat flows, and `yan_first` must remain untouched.

## Boundary
- Isolated Wrangler configuration: `wrangler.man-staging.toml`
- Independent Worker name: `dame-camelias-man-staging`
- Independent Durable Object class / binding: `ManStagingAccounts` / `MAN_STAGING_ACCOUNTS`
- No existing KV ID, production Durable Object binding, routes, proxy, site, or GitHub workflow dispatch.
- Staging-only routes: `GET /health`, `GET /test-admin` (static test dashboard shell) and owner-signed `POST /api/man-staging` (all data/actions authenticated).
- Readiness gate: `GET /health` returns 200 only when separate staging token, isolated Durable Object binding and all publication/client disable flags are present, and no production binding is detected. Otherwise `/health`, `/test-admin` and the API return `503 staging_unconfigured` without disclosing credentials.
- A successful `/health` is a configuration check, **not** proof of Telegram authentication, GitHub Actions, site access, queue processing or end-to-end readiness.
- Environment allowlist is strict: only `MAN_STAGING_ONLY`, `CABINET_PUBLICATIONS_ENABLED`, `CABINET_CLIENTS_ENABLED`, `MAN_STAGING_ACCOUNTS`, and `MAN_STAGING_BOT_TOKEN` are accepted. Any extra or renamed binding causes `/health`, `/test-admin`, and `/api/man-staging` to fail closed with HTTP 503.
- Before staging deployment, audit all Wrangler vars, Durable Object bindings and secrets against this five-name allowlist. Do not add aliases for any production resources.
- Setup actions: `list`, `history`, `draft(plan/reset)`; no account credentials or real activation.
- Mock executor actions: `mock_queue` (sanitized owner-only list), `mock_seed` (create inert fixture), and `mock_finish` (record mock success/rejection). Mock records never touch external sites, credits, customer data, or production Durable Objects.
- The dashboard is accessible only through the separate staging Worker; opening the HTML without a staging Telegram signed `initData` cannot read or change queue data.
- Defense in depth: the internal `ManStagingAccounts` Durable Object independently verifies the staging Telegram `initData` signature and owner user ID before any read or write. A forged `ownerId` field alone never authorizes internal DO access. The separate staging token is supplied only through the staging Worker environment.
- Both the outer API and internal Durable Object reject JSON request bodies over 16,000 UTF-8 bytes (HTTP 413) and malformed/non-object JSON (HTTP 400) before reading or changing simulation records. Direct Durable Object size and malformed-body regressions are included in `tests/man_staging_queue.test.js`.
- Both boundaries now use `src/man_staging_auth.js`: require exactly one signed `hash`, `auth_date`, and `user`; reject timestamps more than 30 seconds in the future or older than 15 minutes; verify owner ID and the HMAC signature independently. This is **freshness validation**, not one-time-use replay prevention within the valid 15-minute window.
- Regression coverage: `tests/man_staging_auth.test.js` plus outer/inner route cases in `tests/man_staging_queue.test.js`.
- Stage operations are atomic and permanently unable to authorize website activity.

## Cloudflare bundle verification (non-deploying)
- The feature-branch CI runs `npx --yes wrangler@4.102.0 deploy --config wrangler.man-staging.toml --dry-run --outdir /tmp/dame-camelias-man-staging-bundle`. The `--dry-run` flag compiles the staging Worker and **does not upload or publish it**.
- CI checks a nonempty JavaScript bundle exists; the boundary regression test permits only that exact reviewed dry-run command, not a real deployment or any production credentials.
- The dry-run validates Cloudflare bundling but does not prove live Durable Object migrations, a staging token, Telegram bot setup, or UI usability. Those remain blocked pending explicit staging-only deployment approval.

## Telegram Mini App readiness
- The staging dashboard loads the official Telegram WebApp SDK before its own script and uses signed initData for all API actions.
- The staging Worker allows Telegram Web framing; this does not bypass owner signature verification.
- Source-level checks are present; a real staging bot, Cloudflare deployment and authenticated Telegram Web acceptance are **not** yet verified.
- Do not copy a production bot token to staging.

## Owner-approved staging deployment attempt — blocked safely
- On 2026-10-18, workflow `.github/workflows/deploy-man-staging-approved.yml` ran on the feature branch as GitHub Actions run `39148015832`.
- Its pre-deployment gate stopped with `Missing CLOUDFLARE_API_TOKEN. Nothing deployed.`. All deployment, staging secret installation, and health verification steps were skipped. **Staging is not deployed.**
- Add GitHub Actions **repository secrets** under Settings → Secrets and variables → Actions: `CLOUDFLARE_API_TOKEN` (scoped for the separate Worker), `CLOUDFLARE_ACCOUNT_ID` (target Cloudflare account), and `MAN_STAGING_BOT_TOKEN` (token issued by a separate Telegram test bot). Do not add token values to code, chat, logs or regular GitHub variables.
- The staging workflow refuses to deploy if any required secret is missing or if the staging Telegram bot token matches the production `BOT_TOKEN` secret where present. It targets only `wrangler.man-staging.toml` on `feature/yan-multiaccount-foundation`; it does not use the production `wrangler.toml`.
- After secrets are added, rerun the failed workflow through its GitHub Actions UI. Inspect the last health-check job and independently verify the resulting staging workers.dev address; do not assume a URL is live before a successful deployment.
- Separate staging Telegram bot setup and Mini App menu/web app URL must be configured before owner-signed UI acceptance; the Worker workflow by itself does not register the Telegram bot menu.

## Manual release prerequisites — not performed
1. Verify the feature-branch GitHub Actions suite passes, including `tests/man_admin_http_integration.test.js`, `tests/man_staging_worker.test.js`, `tests/man_staging_queue.test.js`, `tests/man_mock_queue_view.test.js`, and `tests/man_staging_html.test.js` (inline JavaScript compilation, Telegram SDK ordering, cross-account UI guards and isolation), and `tests/man_staging_deploy_contract.test.js` (strict separate Worker, Durable Object, migration and permitted Wrangler variables).
2. Obtain a **separate staging bot token** in Cloudflare Worker secrets named `MAN_STAGING_BOT_TOKEN`. Do not copy production bot token, proxy details, GitHub Actions secrets, KV IDs or live data.
3. Review deployment target and Cloudflare account permissions. Do not configure any production Worker name, route, KV or Durable Object.
4. Explicitly approve a **manual staging-only deployment** before running `wrangler deploy --config wrangler.man-staging.toml`. This is a future manual step, not a CI step.
5. Use Telegram Mini App signed `initData` from the staging bot only; never place a real token or signed initData in source or logs.
6. Test: nonowner returns 403; owner sees exactly 30 registry entries; `yan_first` cannot be changed; 02–30 cannot publish; plan/reset persists and audit is isolated. Open `/test-admin` from the staging Telegram bot, create a simulated rating/review, inspect per-man history, and complete it with a simulated outcome. Confirm `sitePublished:false` and `creditsDebited:false` throughout.
7. Staging rollback: disable/remove only `dame-camelias-man-staging`; preserve production resources.

## Explicit non-goals until final stage
No real site logins, password collection, proxy IP or port entry, automatic account activation, credentials saved in KV or GitHub, publication, credit deduction, customer migration or production merge.

## Known limitations
This staging Worker provides a separate lightweight queue test screen, not the original production ADMINISTRATION Mini App. UI verification needs an explicitly configured Telegram staging entry point and manual review. GitHub Actions success and Cloudflare integration testing must be observed rather than inferred from static checks.
