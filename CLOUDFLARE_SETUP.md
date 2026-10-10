# DAME CAMELIAS — Cloudflare Workers

## Deployment from GitHub
1. Cloudflare Dashboard → Workers & Pages → Create application → Import a repository / Connect to Git.
2. Authorize GitHub and select `miqiduzavow369-ui/dame-camelias` (branch `main`).
3. Choose **Workers**, not Pages. Deploy using the repository's `wrangler.toml`.
4. Open Worker → Settings → Variables and Secrets. Add **secrets** (encrypted), not plaintext variables:
   - `BOT_TOKEN` — BotFather token of @DameCameliasConsultantBot
   - `WEBHOOK_SECRET` — a random 32+ character string containing only letters, digits, underscore or hyphen.
   - `FORM_URL` — optional public HTTPS form URL, can be added later.
5. After deployment the worker has a URL like `https://dame-camelias-bot.<subdomain>.workers.dev`.
6. Register Telegram webhook with POST `https://api.telegram.org/bot<TOKEN>/setWebhook` and JSON `{"url":"https://YOUR-WORKER.workers.dev/webhook","secret_token":"YOUR_WEBHOOK_SECRET","allowed_updates":["message","callback_query"]}`. Use a trusted private API client; never paste a token-bearing URL into chat, GitHub or screenshots.
7. Test the bot with `/start`.

**Security:** keep all secrets outside GitHub. The Worker verifies Telegram's secret-token header. A manager's @username is not a numeric chat ID; automatic manager notifications require the manager to start the bot and a separate form endpoint.

**Status:** Menu is implemented. HTML form integration and order delivery are not implemented yet.
