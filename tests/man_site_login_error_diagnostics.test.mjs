import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
const source=fs.readFileSync("tools/man_site_login_preflight.py","utf8");
test("runner reports safely categorized failed credential claims",()=>{
 for(const name of ["secure_claim_http_","secure_claim_network_failure",
 "secure_claim_invalid_response","secure_claim_invalid_payload","credentials_claimed",
 "chromium_start","proxy_ip_checked","site_login_attempt","callback_http_"]){
  assert.ok(source.includes(name),name);
 }
 assert.doesNotMatch(source,/print\(.*details\[["'](?:sitePassword|proxyPassword|siteLogin)/);
 assert.match(source,/except urllib\.error\.HTTPError as exc:/);
 assert.match(source,/raise RuntimeError\("Secure credential claim rejected"\) from None/);
});
test("runner is valid Python",()=>{
 const p=spawnSync("python3",["-c","import ast,sys;ast.parse(sys.stdin.read())"],{input:source,encoding:"utf8"});
 assert.equal(p.status,0,p.stderr);
});