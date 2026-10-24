# CITY DIARY — offline validation and future activation checklist

**Status:** Design and offline tests only. This checklist is NOT authorization to register Cloudflare Durable Objects, set a Telegram webhook, merge PR #284, or dispatch messages to real clients.

## Existing production must remain untouched

- `wrangler.toml` has `OrderReminder` and the existing `ORDER_REMINDERS` binding. Never repurpose its alarms or KV keys for diary delivery.
- Do not change current `/webhook`, `src/index.js`, live Telegram bot token, ADMIN, credit accounting, manual reviews/ratings, men or ASHOO during staging preparation.
- The diary scheduler, bridge, coordinator, callback and webhook gate are presently independent modules and are deliberately not registered as live routes.

## Offline validation only — no additional Telegram bots

1. No test Telegram bot, additional bot token, webhook registration or new Cloudflare deployment. Use Node's in-memory storage, mocked Telegram API responses and isolated GitHub Actions only.
2. Keep `CityDiaryScheduler` unregistered and unbound until an explicit later production go/no-go decision. Do not call `setWebhook` on any bot.
3. Unit-test the Telegram `X-Telegram-Bot-Api-Secret-Token` verification with placeholder values. Real secrets are never put into source control.
4. For future activation, authenticate the incoming webhook at the HTTP boundary **before** calling `handleVerifiedCityDiaryWebhook`. Never allow request JSON or a query string to supply `trustedWebhook`, owner ID, binding name, or secret.
5. Before activation, build a trusted coordinator entrypoint from the already authenticated per-client cabinet, not a generic public `userId` action. Call post-write sync only for successful diary mutations.
6. Simulate two isolated client accounts and verify that owner IDs, receipts and Telegram message IDs cannot cross contexts.

## Negative and recovery cases to run entirely offline

- Wrong secret, absent secret, wrong HTTP method, malformed body, non-private chat, forged Thanks callback, and wrong sender must fail without deleting anything.
- Create reminder; edit time; cancel before alarm; cancel while alarm is claimed; confirm that no blind resend follows an unknown Telegram API outcome.
- Send once, click «Спасибо ✨», verify a durable acknowledgement, and separately verify deletion. Repeat the click after deletion and after simulated deletion failure; no duplicate send.
- Simulate a scheduler response lost **after commit**; a replay must reconcile the same schedule revision, not create a new one.
- Simulate message removal failure and observe `cleanupRequired`; bound retries and manual follow-up must not change the acknowledged delivery state.
- Recreate simulated Worker and scheduler instances, preserve recorded receipts, and verify that old snapshots cannot revive cancelled reminders.
- Check performance and archive growth, secret rotation, callback deduplication, response timeouts, and rollback before any production proposal.

## No-go conditions

Never activate real notifications if the authorization header is not verified, an event can be sent twice, the cancellation outcome is ambiguous in UI, an account can access another account's scheduler, or fallback routes could hit the existing manual City's `OrderReminder` alarm.

## Approval boundary

Production deployment, webhook replacement, migration of client data and any change to existing City publication/credit/ADMIN routes require an explicit separate go/no-go decision and separately reviewed launch readiness evidence.

**User decision (2026-10-24):** No test Telegram bots. All current verification must remain offline and must not create or connect another bot.
