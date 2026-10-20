import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync("admin/preview-v3.html","utf8");
test("ADMIN male account includes read-only diagnostics with explicit client, profile, kind and nonce",()=>{
 for(const id of ["secOperationClient","secOperationProfile","secOperationKind","secOperationNonce"])
  assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes("renderSecondaryOperationDiagnostic(x)+"));
 assert.ok(html.includes('callAdmin("secondary_operation_status"'));
 assert.ok(html.includes("secondaryOperationState?.accountId===man.id"));
 assert.ok(html.includes("Вид операции"));
 assert.ok(html.includes("Билет подтверждения"));
 assert.ok(html.includes("Списание кредита"));
 assert.ok(html.includes("Повторная отправка на сайт запрещена"));
 const start=html.indexOf("async function checkSecondaryOperation");
 const end=html.indexOf("let manApprovalBusy",start);
 const scope=html.slice(start,end);
 assert.ok(scope.includes("q.userId"));
 assert.ok(scope.includes("q.profileId"));
 assert.ok(scope.includes("q.kind"));
 assert.ok(scope.includes("q.nonce"));
 assert.ok(!scope.includes("credits(")&&!scope.includes("settleSecondaryVerifiedResult("));
});
test("ADMIN JS remains valid and no raw proof or callback secret is displayed",()=>{
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.ok(scripts.length);
 for(const match of scripts)assert.doesNotThrow(()=>new vm.Script(match[1]));
 const start=html.indexOf("function renderSecondaryOperationDiagnostic(");
 const end=html.indexOf("async function checkSecondaryOperation",start);
 const scope=html.slice(start,end);
 for(const forbidden of ["proofFileId","sitePublicationId","signature","SECONDARY_CALLBACK_HMAC_KEY","callbackToken"])
  assert.ok(!scope.includes(forbidden));
});
