import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("secondary readiness is exposed only through owner ADMIN",()=>{
 const admin=fs.readFileSync("src/admin_app_api.js","utf8");
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 assert.ok(admin.includes('action==="secondary_rating_readiness"'));
 assert.ok(admin.includes('kind:"admin_secondary_rating_readiness",actorId:OWNER_ID'));
 assert.ok(runtime.includes('event.kind==="admin_secondary_rating_readiness"'));
 assert.ok(runtime.includes('readSecondaryConnection(storage,rawEnv,event.accountId,OWNER_ID)'));
 assert.ok(!runtime.includes('executorConnected:false,callbackConnected:false,proofAndLedgerConnected:false'));
 assert.ok(runtime.includes('runner_configuration_missing'));
});

test("ADMIN view shows independent rating diagnostics for selected man",()=>{
 const html=fs.readFileSync("admin/preview-v3.html","utf8");
 const console=html.slice(html.indexOf("function renderManConsole()"),html.indexOf("function renderManSiteForm()"));
 assert.ok(!console.includes("renderSecondaryRatingReadiness("));
 assert.ok(html.includes("callAdmin('secondary_rating_readiness',{accountId:id})"));
 assert.ok(html.includes("id==='yan_first'"));
 assert.ok(html.includes("proof_and_credit_not_connected"));
});

