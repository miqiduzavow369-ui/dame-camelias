import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {reserveSecondaryFeedbackCredit,settleSecondaryFeedbackCredit} from "../src/secondary_man_credit_bridge.js";
import {appendVerifiedFeedbackEvidence} from "../src/secondary_man_feedback_evidence.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const state=()=>{const map=new Map();const db={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),transaction:async f=>f(db)};return {db,map};};
const identity=(accountId,nonce="abcdef123456")=>({userId:"123456789",accountId,profileId:"2468",kind:"review",nonce});
function fakeEnv(){
 const seen=[],ledger=new Map();
 const env={ORDER_REMINDERS:{idFromName:x=>x,get:()=>({fetch:async(_,req)=>{
  const value=JSON.parse(req.body);
  if(value.type==="credits_reserve"){
   const key=[value.userId,value.kind,value.profileId,value.nonce].join(":");
   if(ledger.has(key))return {ok:true,json:async()=>({ok:false})};
   ledger.set(key,"reserved");
  }else if(value.type==="credits_complete"){
   const key=[value.userId,value.kind,value.profileId,value.nonce].join(":");
   if(ledger.get(key)!=="reserved")return {ok:true,json:async()=>({ok:false})};
   ledger.set(key,"completed");
  }
  seen.push(value);return {ok:true,json:async()=>({ok:true})};
 }})}};
 return {env,seen};
}
test("different men get independent ledger nonces, and no settlement without proof",async()=>{
 const {db}=state(),{env,seen}=fakeEnv();
 const a=identity("yan_second"),b=identity("yan_03");
 for(const x of [a,b]){
  const result=await reserveSecondaryFeedbackCredit(db,env,x,{independentAuthorConfirmed:true,moderatorApproved:true});
  assert.equal(result.status,"reserved");
 }
 const reserves=seen.filter(v=>v.type==="credits_reserve");
 assert.equal(reserves.length,2);
 assert.notEqual(reserves[0].nonce,reserves[1].nonce);
 assert.match(reserves[0].nonce,/^[a-f0-9]{12}$/);
 await assert.rejects(()=>settleSecondaryFeedbackCredit(db,env,a),/proof required/);
 await appendVerifiedFeedbackEvidence(db,{identity:a,sitePublicationId:"proof-12345",proofFileId:"file-123456",moderatorApproved:true,independentAuthorConfirmed:true,at:1000});
 assert.equal((await settleSecondaryFeedbackCredit(db,env,a)).status,"completed");
 await assert.rejects(()=>settleSecondaryFeedbackCredit(db,env,a),/not ready/);
 await assert.rejects(()=>reserveSecondaryFeedbackCredit(db,env,a,{independentAuthorConfirmed:true,moderatorApproved:true}),/already reserved/);
 assert.equal(seen.filter(x=>x.type==="credits_complete").length,1);
});
test("unconfirmed author and unmoderated review never reserve credit",async()=>{
 const {db}=state(),{env,seen}=fakeEnv();
 await assert.rejects(()=>reserveSecondaryFeedbackCredit(db,env,identity("yan_second"),{independentAuthorConfirmed:false,moderatorApproved:true}),/required/);
 await assert.rejects(()=>reserveSecondaryFeedbackCredit(db,env,identity("yan_second"),{independentAuthorConfirmed:true,moderatorApproved:false}),/required/);
 await assert.rejects(()=>reserveSecondaryFeedbackCredit(db,env,identity("yan_first"),{independentAuthorConfirmed:true,moderatorApproved:true}),/immutable/);
 assert.equal(seen.length,0);
});
