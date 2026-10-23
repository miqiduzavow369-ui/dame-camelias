# Packaged HTML and decorative media

The existing Worker serves HTML from `src/generated/static_pages.js`. ADMIN HTML
is returned only after the existing Telegram signature and owner checks. It is
never placed in the public asset collection. Existing API paths, bot identity,
KV/DO bindings, credentials and publication handlers keep their contracts.

`config/public_media.json` is the reviewed list of decorative images/videos.
`node tools/build_static_files.mjs` validates paths, rejects symlinks, checks media
signatures and copies only these files into `.static-assets/media/`. Source code,
HTML, credentials, proof archives and client Telegram photos are excluded.
Wrangler serves the decorative files at `/media/assets/...` and `/media/anketa/...`.
Worker-side media reads use the local ASSETS binding; Telegram receives public
decorative URLs or the same uploaded image bytes. No GitHub token reaches a client.

After editing source HTML or the media manifest, run:

```sh
node tools/build_static_files.mjs
node --import ./tests/helpers/offline_fetch.mjs --test tests/private_static_transport.test.mjs
```

Commit the regenerated server HTML module with the source. Media output stays
ignored; Wrangler's custom build creates it again before deployment. A changed
HTML/media file now needs a successful Worker/assets deployment, unlike the
former runtime fetch from GitHub main. Check Cloudflare build watch paths cover
HTML, assets, this build script, the manifest, src and wrangler.toml. GitHub
Actions triggers alone do not control Cloudflare's watch paths.

The CI dry run compiles without deployment credentials or live operations.
Browser regression interceptors reject public raw GitHub dependencies. Before
repository visibility changes, verify the prepared version in production,
private access for dispatch/build tools, Actions quota, recovery and a rollback
version which also uses packaged HTML/media. This code change alone does not
change repository visibility or certify those account settings.
