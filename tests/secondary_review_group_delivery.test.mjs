import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {moderationCallback,ensureSecondaryReviewGroupNotice,verifySecondaryReviewGroupDecision,handleSecondaryReviewGroupCallback} from "../src/secondary_review_moderation_notice.js";
import {manStorageKey} from "../src/man_account_isolation.js";

const i={userId:"123456789",accountId:"yan_second",profileId:"690230",kind:"review"};
function store(){
 const m=new Map();
 const tx={get:async k=>m.get(k),put:async(k,v)=>m.set(k,v)};
 m.set(manStorageKey({...i,scope:"review-draft"})+":review",
  {...i,authorAttested:true,version:1,text:"Мой личный опыт посещения: встреча прошла хорошо."});
 return {m,storage:{get:tx.get,transaction:fn=>fn(tx)}};
}
test("group notification is account/version-specific and never publishes or reserves credit",async()=>{
 const {storage}=store();
 assert.match(moderationCallback(i,1),/^srmod:approve:123456789:yan_second:690230:1$/);
 const first=await ensureSecondaryReviewGroupNotice(storage,{BOT_TOKEN:""},i);
 assert.equal(first.ok,false);
 const second=await ensureSecondaryReviewGroupNotice(storage,{BOT_TOKEN:""},i);
 assert.equal(second.ok,true);
 assert.equal(second.already,true);
 assert.equal(await verifySecondaryReviewGroupDecision(storage,i,{version:1,messageId:100}),false);
});
test("legacy Yan moderation and unchanged HTML remain independent",()=>{
 const index=fs.readFileSync("src/index.js","utf8");
 assert.ok(index.includes("handleSecondaryReviewGroupCallback(update,env,cabinetRPC)"));
 assert.ok(index.includes("handleModeration(update,env)"));
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 assert.ok(runtime.includes("if(event.kind===\"admin_secondary_review_group_approve\")"));
 assert.ok(runtime.includes("verifySecondaryReviewGroupDecision(storage,i"));
 assert.ok(runtime.includes('event.draftKind==="review"&&event.action==="save"'));
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 assert.ok(html.includes('send.textContent="✅ Отправить отзыв"'));
});
test("unauthorized moderator callback cannot approve",async()=>{
 const id=moderationCallback(i,1);
 const calls=[];
 const result=await handleSecondaryReviewGroupCallback({
  callback_query:{id:"q",data:id,from:{id:999},message:{chat:{id:-1003900552612},message_id:5}}
 },{BOT_TOKEN:null},async(...x)=>{calls.push(x);return {ok:true};});
 assert.equal(result,true);
 assert.equal(calls.length,0);
});
