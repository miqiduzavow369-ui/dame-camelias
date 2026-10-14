# DAME CAMELIAS

Existing Telegram bot, Cloudflare Worker/KV/Durable Objects and GitHub Actions runners.

The universal cabinet change is in draft PR [#106](https://github.com/miqiduzavow369-ui/dame-camelias/pull/106). See [implementation report, validation limits, rollout and rollback](docs/MULTI_CLIENT_REPORT_2026-10-15.md).

`src/cabinet_runtime.js` authenticates and routes each user to a private coordinator; `src/owner_anketa.js` exports the shared `createCabinet(userId)` engine and legacy owner-compatible entry points. `src/client_registry.js` stores client permissions and salted PIN credentials through the existing DO binding. Publication credits, permanent publication guards and Moscow-day profile limits retain independent global/per-user identities. Older trial modules remain for compatibility regression coverage; the Worker routes active cabinet traffic through the common engine.

Local checks:

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python -m py_compile tools/*.py
```

These tests do not perform real publications. Production deployment requires explicit owner approval. Git alone does not back up live KV/DO state; see [recovery handoff](docs/RECOVERY_HANDOFF_2026-10-14.md).
