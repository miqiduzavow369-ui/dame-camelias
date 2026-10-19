import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {spawnSync} from "node:child_process";
const runner=fs.readFileSync("tools/man_site_login_preflight.py","utf8");
const legacy=fs.readFileSync("tools/intimcity_profile_lookup.py","utf8");
test("secondary site login uses the existing Yan First authenticated callback User-Agent",()=>{
 assert.match(legacy,/"User-Agent":"DameCameliasBot\/1\.0"/);
 assert.match(runner,/"User-Agent":"DameCameliasBot\/1\.0"/);
 assert.match(runner,/headers=headers,method="GET" if data is None else "POST"/);
 assert.doesNotMatch(runner,/print\(.*(?:sitePassword|proxyPassword|ANKETA_CALLBACK_TOKEN)/);
});
test("Python runner remains syntactically valid",()=>{
 const result=spawnSync("python3",["-c","import ast,sys;ast.parse(sys.stdin.read())"],{input:runner,encoding:"utf8"});
 assert.equal(result.status,0,result.stderr);
});