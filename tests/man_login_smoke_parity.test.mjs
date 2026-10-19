import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
const old=fs.readFileSync("tools/intimcity_login_smoke_test.py","utf8");
const current=fs.readFileSync("tools/man_site_login_preflight.py","utf8");
const coordinator=fs.readFileSync("src/man_site_login_preflight.js","utf8");
const deploy=fs.readFileSync(".github/workflows/deploy-existing-worker.yml","utf8");
test("secondary man login mirrors original visible selectors and human challenge detection",()=>{
 for(const selector of ['input[name="login"][placeholder="E-mail"]','input[name="password"][type="password"]',
   'input[type="submit"]','iframe[src*="captcha"], input[name*="captcha"], input[name*="code"]']){
  assert.ok(old.includes(selector),selector);
  assert.ok(current.includes(selector),selector);
 }
 assert.match(current,/login_challenge_required/);
 assert.match(coordinator,/login_challenge_required/);
 assert.match(coordinator,/siteIdentityVerified:false,canPublish:false/);
});
test("diagnostic separation of Cloudflare missing secrets never prints secret values",()=>{
 assert.match(deploy,/if \[ -z "\$CLOUDFLARE_API_TOKEN" \]/);
 assert.match(deploy,/if \[ -z "\$CLOUDFLARE_ACCOUNT_ID" \]/);
 assert.doesNotMatch(deploy,/echo .*\$CLOUDFLARE_API_TOKEN/);
 assert.doesNotMatch(deploy,/echo .*\$CLOUDFLARE_ACCOUNT_ID/);
});
test("runner Python syntax parses",()=>{
 const r=spawnSync("python3",["-c","import ast,sys;ast.parse(sys.stdin.read())"],{input:current,encoding:"utf8"});
 assert.equal(r.status,0,r.stderr);
});