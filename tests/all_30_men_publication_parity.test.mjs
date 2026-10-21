import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import {clientMenAvailability,LEGACY_CLIENT_ROUTE} from "../src/man_client_parity.js";

const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
const html=fs.readFileSync("anketa/mini-preview.html","utf8");
const rating=fs.readFileSync("tools/secondary_man_rating_job.py","utf8");
const review=fs.readFileSync("tools/secondary_man_review_job.py","utf8");

test("all thirty men share client action stages while retaining isolated account identities",()=>{
 assert.equal(MAN_ACCOUNTS.length,30);
 assert.equal(new Set(MAN_ACCOUNTS.map(x=>x.id)).size,30);
 assert.equal(MAN_ACCOUNTS[0].id,"yan_first");
 assert.equal(MAN_ACCOUNTS[1].id,"yan_second");
 const client=clientMenAvailability();
 assert.equal(client.length,30);
 for(const man of MAN_ACCOUNTS){
  const entry=client.find(row=>row.id===man.id);
  assert.ok(entry);
  assert.deepEqual(entry.ratingRoute,LEGACY_CLIENT_ROUTE.rating);
  assert.deepEqual(entry.reviewRoute,LEGACY_CLIENT_ROUTE.review);
  if(man.id==="yan_first"){
   assert.equal(man.enabledByDefault,true);
   assert.equal(entry.route,"legacy_yan_first");
  }else{
   assert.equal(man.enabledByDefault,false);
   assert.equal(entry.route,"not_connected");
   assert.equal(entry.enabled,false);
   const ratingOp=createAccountOperation({userId:"123456789",accountId:man.id,
    profileId:"690230",kind:"rating",nonce:"abcdef123456"});
   const reviewOp=createAccountOperation({...ratingOp,kind:"review"});
   const r=manStorageKey({...ratingOp,scope:"publication"})+":rating";
   const v=manStorageKey({...reviewOp,scope:"publication"})+":review";
   assert.ok(r.includes(":"+man.id+":"));
   assert.ok(v.includes(":"+man.id+":"));
   assert.notEqual(r,v);
  }
 }
});
test("every secondary rating and review use owner's own sealed account records and recheck approval at grant",()=>{
 const r=runtime.slice(runtime.indexOf('if(event.kind==="mini_rating_action")'),
  runtime.indexOf('if(event.kind==="mini_rating_open")'));
 const v=runtime.slice(runtime.indexOf('if(event.kind==="mini_review_action")'),
  runtime.indexOf('if(event.kind==="mini_review_draft")'));
 const reviewGrant=runtime.slice(runtime.indexOf('if(event.kind==="secondary_man_review_runner_payload")'),
  runtime.indexOf('if(event.kind==="secondary_man_review_submit_boundary")'));
 const ratingGrant=runtime.slice(runtime.indexOf('if(event.kind==="secondary_man_rating_runner_payload")'),
  runtime.indexOf('if(event.kind==="secondary_man_rating_submit_boundary")'));
 for(const block of [r,v]){
  assert.ok(block.includes('kind:"secondary_publication_account_snapshot"'));
  for(const prefix of ["man-proxy-sealed-v1:","man-intimcity-sealed-v1:",
   "man-owner-approval-v1:","secondary-site-identity-v1:"])
   assert.ok(block.includes(prefix+"+accountId"),prefix);
 }
 for(const block of [ratingGrant,reviewGrant]){
  assert.ok(block.includes('kind:"secondary_publication_account_version_check"'));
  assert.ok(block.includes('if(uid!==OWNER_ID)'));
 }
 assert.ok(runtime.includes('return engine.miniRatingAction('));
 assert.ok(runtime.includes('return engine.miniReviewAction('));
 assert.ok(!html.includes('window.confirm("Подтвердить однократную публикацию выбранных оценок'));
 assert.ok(!html.includes('send.textContent="💾 Сохранить отзыв"'));
 assert.ok(rating.includes('SECONDARY_ACCOUNT_ID'));
 assert.ok(review.includes('SECONDARY_ACCOUNT_ID'));
 assert.ok(!rating.includes('SECONDARY_ACCOUNT_ID","yan_first"'));
 assert.ok(!review.includes('SECONDARY_ACCOUNT_ID","yan_first"'));
});
