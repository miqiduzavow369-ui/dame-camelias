import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
const admin=fs.readFileSync("admin/preview-v3.html","utf8");
test("ADMIN requires verified pinned proxy and technical login before approval",()=>{
 const start=runtime.indexOf('if(event.kind==="admin_secondary_man_approval")');
 const end=runtime.indexOf('if(event.kind==="admin_man_visibility")',start);
 assert.ok(start>0&&end>start);
 const body=runtime.slice(start,end);
 assert.match(body,/login\.technicalReady!==true/);
 assert.match(body,/proxy\.proxyVerified!==true/);
 assert.match(body,/site\.proxyReady!==true/);
 assert.match(body,/event\.approved===false/);
});
test("ADMIN confirms the connection without granting a publication",()=>{
 assert.match(admin,/const identityOK=loginOK;/);
 assert.match(admin,/x\.readiness\?\.connectionReady/);
 const match=admin.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match);
 assert.doesNotThrow(()=>new vm.Script(match[1]));
});

