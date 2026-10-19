import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const worker=fs.readFileSync("src/cabinet_runtime.js","utf8");
const runner=fs.readFileSync("tools/man_site_login_preflight.py","utf8");
test("callback token rejection uses fixed non-secret diagnostic marker",()=>{
 assert.match(worker,/X-DC-Callback-Handler":"token_rejected"/);
 assert.match(worker,/status:403/);
 assert.doesNotMatch(worker,/X-DC-Callback-Handler":env\./);
});
test("runner reports marker only without copying response or secrets",()=>{
 assert.match(runner,/handler="worker_token_rejected" if marker=="token_rejected"/);
 assert.match(runner,/secure_claim_http_\{exc.code\}/);
 assert.doesNotMatch(runner,/print\(exc\.read/);
 assert.doesNotMatch(runner,/print\(.*ANKETA_CALLBACK_TOKEN/);
});
