import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("only owner account snapshot can request a missing-identity login recheck",()=>{
 const src=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const start=src.indexOf('if(event.kind==="secondary_publication_account_snapshot"||');
 const end=src.indexOf('if(event.kind==="secondary_catalog_cabinet_ready")',start);
 const body=src.slice(start,end);
 assert.ok(body.includes('if(uid!==OWNER_ID)return {ok:false,status:403}'));
 assert.ok(body.includes('if(accountId==="yan_first"'));
 assert.ok(body.includes('if(event.kind==="secondary_publication_account_snapshot"){'));
 assert.ok(body.includes('await startSiteLoginCheck(storage,rawEnv,params,'));
 assert.ok(body.includes('man-site-login-preflight.yml/dispatches'));
 assert.ok(body.includes('"secondary-identity-recheck-v1:"+accountId'));
 assert.ok(body.includes('now-prev.at>15*60*1000'));
 assert.ok(body.includes('verified.proxyVersion===proxy?.version'));
 assert.ok(body.includes('verified.siteVersion===site?.version'));
 assert.ok(body.includes('readSecondaryConnection(storage,rawEnv,accountId,OWNER_ID)'));
 assert.ok(body.includes('if(!connection.ready)'));
});
test("secondary recovery does not publish, mutate credits or change user interface",()=>{
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 assert.ok(html.includes('send.textContent="✅ Отправить отзыв"'));
 const src=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const start=src.indexOf('if(event.kind==="secondary_publication_account_snapshot"||');
 const end=src.indexOf('if(event.kind==="secondary_catalog_cabinet_ready")',start);
 const body=src.slice(start,end);
 assert.ok(!body.includes('launchApprovedSecondaryRating'));
 assert.ok(!body.includes('reserveSecondaryFeedbackCredit'));
 assert.ok(!body.includes('secondary-man-rating-publish.yml'));
});

