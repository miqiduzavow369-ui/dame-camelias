import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("secondary review UI offers explicit, separate publication only after owner approval",()=>{
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 const source=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(source,"Inline Mini App script present");
 new vm.Script(source[1]);
 assert.ok(html.includes('publishButton.hidden=stage!=="approved"'));
 assert.ok(html.includes('publishButton.onclick=async()=>'));
 assert.ok(html.includes('request("publish")'));
 assert.ok(html.includes('confirmed:action==="publish"'));
 assert.ok(html.includes('action==="submit"?"save":action'));
 assert.ok(html.includes('if(selectedAccount!=="yan_first"){'));
 assert.ok(html.includes('Отправить отзыв'));
});

test("owner ADMIN previews exact text and confirms hash for chosen secondary man",()=>{
 const html=fs.readFileSync("admin/preview-v3.html","utf8");
 const source=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(source);
 new vm.Script(source[1]);
 assert.ok(html.includes('secondary_review_preview'));
 assert.ok(html.includes('secondary_review_approve'));
 assert.ok(html.includes('expectedTextSha256:p.approvedTextSha256'));
 assert.ok(html.includes('confirmExactText:true'));
 const console=html.slice(html.indexOf("function renderManConsole()"),html.indexOf("function renderManSiteForm()"));
 assert.ok(!console.includes("renderSecondaryReviewApproval("));
 assert.ok(html.includes('selectedManId==="yan_first")return ""'));
});

test("secondary review client gate checks saved profile list and exact account",()=>{
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const worker=fs.readFileSync("src/index.js","utf8");
 const start=runtime.indexOf('if(event.kind==="mini_review_action")');
 const end=runtime.indexOf('if(event.kind==="mini_review_draft")',start);
 assert.ok(start>0&&end>start);
 const block=runtime.slice(start,end);
 assert.ok(block.includes('owner_anketa_library:'));
 assert.ok(block.includes('event.confirmed!==true'));
 assert.ok(block.includes('launchApprovedSecondaryReview('));
 assert.ok(block.includes('if(uid!==OWNER_ID'));
 assert.ok(block.includes('return engine.miniReviewAction('));
 assert.ok(worker.includes('confirmed:body.confirmed===true'));
});

