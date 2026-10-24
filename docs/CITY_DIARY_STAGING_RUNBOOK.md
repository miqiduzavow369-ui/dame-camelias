# CITY DIARY — staging activation checklist (do not deploy in production)

**Status:** Design and offline tests only. This checklist is NOT authorization to register Cloudflare Durable Objects, set a Telegram webhook, merge PR #284, or dispatch messages to real clients.

## Existing production must remain untouched

- `wrangler.toml` has `OrderReminder` and the existing `ORDER_REMINDERS` binding. Never repurpose its alarms or KV keys for diary delivery.
- Do not change current `/webhook`, `src/index.js`, live Telegram bot token, ADMIN, credit accounting, manual reviews/ratings, men or ASHOO during staging preparation.
- The diary scheduler, bridge, coordinator, callback and webhook gate are presently independent modules and are deliberately not registered as live routes.

## Isolated staging prerequisites

1. Provision a **separate** Cloudflare Worker and its own `CityDiaryScheduler` Durable Object binding, with distinct deployment name, routes, migration and secrets; never point at live City production bindings.
2. Use a dedicated **test** Telegram bot token and its private test user/chat. Do not call `setWebhook` on the production bot during experimentation. Store all tokens as Worker secrets and keep them out of source control and logs.
3. Register the staging bot webhook with a randomly generated `secret_token` (Telegram supplies it in `X-Telegram-Bot-Api-Secret-Token`). The gate in `src/city_diary_webhook_gate.js` requires a token of at least 32 allowed characters. Set a distinct internal scheduler bearer secret.
4. Authenticate the incoming webhook at the HTTP boundary **before** calling `handleVerifiedCityDiaryWebhook`. Never allow request JSON or a query string to supply `trustedWebhook`, owner ID, binding name, or secret.
5. Build a trusted coordinator entrypoint from the already authenticated per-client cabinet, not a generic public `userId` action. Call post-write sync only for successful diary mutations.
6. Verify that staging scheduler owner IDs, receipt keys, operation revisions and Telegram message IDs never become visible across two test accounts.

## Negative and recovery cases to run in staging

- Wrong secret, absent secret, wrong HTTP method, malformed body, non-private chat, forged Thanks callback, and wrong sender must fail without deleting anything.
- Create reminder; edit time; cancel before alarm; cancel while alarm is claimed; confirm that no blind resend follows an unknown Telegram API outcome.
- Send once, click «Спасибо ✨», verify a durable acknowledgement, and separately verify deletion. Repeat the click after deletion and after simulated deletion failure; no duplicate send.
- Simulate a scheduler response lost **after commit**; a replay must reconcile the same schedule revision, not create a new one.
- Simulate message removal failure and observe `cleanupRequired`; bound retries and manual follow-up must not change the acknowledged delivery state.
- Restart staging Worker and scheduler, preserve recorded receipts, and verify that old snapshots cannot revive cancelled reminders.
- Check performance and archive growth, secret rotation, callback deduplication, response timeouts, and rollback before any production proposal.

## No-go conditions

Never activate real notifications if the authorization header is not verified, an event can be sent twice, the cancellation outcome is ambiguous in UI, an account can access another account's scheduler, or fallback routes could hit the existing manual City's `OrderReminder` alarm.

## Approval boundary

Production deployment, webhook replacement, migration of client data and any change to existing City publication/credit/ADMIN routes require an explicit separate go/no-go decision and verified staging evidence.
