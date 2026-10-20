import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("secondary readiness is exposed only through owner ADMIN",()=>{
 const admin=fs.readFileSync("src/admin_app_api.js","utf8");
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 assert.ok(admin.includes('action==="secondary_rating_readiness"'));
 assert.ok(admin.includes('kind:"admin_secondary_rating_readiness",actorId:OWNER_ID'));
 assert.ok(runtime.includes('event.kind==="admin_secondary_rating_readiness"'));
 assert.ok(runtime.includes('secondaryRatingReadiness(id,'));
 assert.ok(runtime.includes('executorConnected:false,callbackConnected:false,proofAndLedgerConnected:false'));
});
