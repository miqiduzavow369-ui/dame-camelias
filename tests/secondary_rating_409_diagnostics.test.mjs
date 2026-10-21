import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("secondary rating preflight reveals missing runner configuration without dispatch",()=>{
 const src=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const a=src.indexOf('if(event.kind==="mini_rating_action")');
 const b=src.indexOf('if(event.kind==="mini_rating_open")',a);
 assert.ok(a>=0&&b>a);
 const s=src.slice(a,b);
 assert.ok(s.includes('reason:"secondary_runner_configuration_missing"'));
 assert.ok(s.includes('kind:"secondary_publication_account_snapshot"'));
 assert.ok(s.includes('reason:"secondary_owner_account_not_ready"'));
 assert.ok(s.indexOf('reason:"secondary_runner_configuration_missing"')<s.indexOf('launchApprovedSecondaryRating('));
 assert.ok(s.includes('failureStage==="launch"?"secondary_rating_reconciliation_required"'));
 assert.ok(s.includes('storage.list({prefix:manStorageKey('));
 assert.ok(s.includes('!row&&outstanding'));
 assert.ok(s.includes('reason:"secondary_rating_reconciliation_required"'));
 assert.ok(s.includes('return engine.miniRatingAction('));
});
test("Mini App does not tell user to retry after ambiguous secondary rating attempt",()=>{
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match);
 assert.doesNotThrow(()=>new vm.Script(match[1]));
 assert.ok(html.includes('secondary_rating_reconciliation_required:"⚠️ Результат операции требует проверки администратором.'));
 assert.ok(html.includes('secondary_runner_configuration_missing:'));
 assert.ok(html.includes('secondary_owner_account_not_ready:'));
});
