import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const api=fs.readFileSync("src/admin_app_api.js","utf8");
const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
const html=fs.readFileSync("admin/preview-v3.html","utf8");
test("owner signed ADMIN uses the same private coordinator for approval changes",()=>{
 assert.match(api,/authenticatedOwner\(body,env\)/);
 assert.match(api,/secondary_man_approval_set/);
 assert.match(api,/kind:"admin_secondary_man_approval"/);
 assert.match(runtime,/event.kind==="admin_secondary_man_approval"/);
 assert.match(runtime,/uid!==OWNER_ID\|\|event.actorId!==OWNER_ID/);
 assert.match(runtime,/setSecondaryManApproval\(storage/);
 assert.match(runtime,/readSecondaryManApproval\(storage/);
 assert.match(runtime,/technical_checks_incomplete/);
 assert.match(runtime,/site\.proxyReady!==true/);
});
test("ADMIN exposes approval state per account and never claims new publishers work",()=>{
 assert.match(runtime,/approval:approvalMap\.get\(x\.id\)\?\?null/);
 assert.match(runtime,/publicationAvailable:false/);
 assert.match(html,/updateManOwnerApproval\(approved\)/);
 assert.match(html,/Подтвердить подключение/);
 assert.match(html,/Отозвать подключение/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(js);
 assert.doesNotThrow(()=>new vm.Script(js[1]));
});

test("ADMIN revocation is independent of currently working proxy and site",()=>{
 const start=runtime.indexOf('if(event.kind==="admin_secondary_man_approval")');
 const end=runtime.indexOf('if(event.kind==="admin_man_registry")',start);
 const code=runtime.slice(start,end);
 const revoke=code.indexOf('if(event.approved===false)');
 const check=code.indexOf('proxyStatus(storage,params)');
 assert.ok(revoke>0&&check>revoke);
 assert.match(code,/previous\.proxyVersion/);
 assert.match(code,/previous\.siteVersion/);
 assert.match(code,/setSecondaryManApproval\(storage/);
});

