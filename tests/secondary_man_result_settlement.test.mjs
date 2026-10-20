import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {reserveSecondaryFeedbackCredit} from "../src/secondary_man_credit_bridge.js";
import {recordSecondaryVerifiedResult,settleSecondaryVerifiedResult,secondaryVerifiedResultStatus} from "../src/secondary_man_result_settlement.js";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const identity=(accountId,nonce="abcdef123456")=>({userId:"123456789",accountId,profileId:"2468",kind:"review",nonce});
function storage(){const entries=new Map();const tx={get:async key=>entries.get(key),put:async(k,v)=>entries.set(k,v),transaction:async fn=>fn(tx)};return {tx,entries};}
function fakeEnv(){const ledger=new Map(),seen=[];
 const env={ORDER_REMINDERS:{idFromName:s=>s,get:()=>({fetch:async(_,request)=>{
  const body=JSON.parse(request.body);
  seen.push(body);
  const k=[body.userId,body.kind,body.profileId,body.nonce].join(":");
  let result={ok:true};
  if(body.type==="credits_reserve"){
   if(ledger.has(k))result={ok:false};
   else ledger.set(k,"reserved");
  }
  if(body.type==="credits_complete"){
   if(ledger.get(k)!=="reserved")result={ok:false};
   else ledger.set(k,"completed");
  }
  return {ok:true,json:async()=>result};
 }})}};
 return {env,seen};
}
async function attempted(tx,i){
 const k=manStorageKey({userId:i.userId,accountId:i.accountId,profileId:i.profileId,scope:"publication"})+":"+i.kind;
 await tx.put(k,{identity:createAccountOperation(i),status:"attempted",attempted:true,proxyVersion:1,siteVersion:2});
}
function proof(i){return {original:i,callback:i,sitePublicationId:"verified-site-2345",proofFileId:"telegram-image-5432",moderatorApproved:true,independentAuthorConfirmed:true,verifiedByTrustedExecutor:true,at:1000};}
test("two men's identical profile, client and nonce settle independently, once",async()=>{
 const {tx,entries}=storage(),{env,seen}=fakeEnv();
 for(const accountId of ["yan_second","yan_03"]){
  const i=identity(accountId);
  const reserved=await reserveSecondaryFeedbackCredit(tx,env,i,{independentAuthorConfirmed:true,moderatorApproved:true});
  assert.equal(reserved.status,"reserved");
  await attempted(tx,i);
  assert.equal((await recordSecondaryVerifiedResult(tx,proof(i))).status,"proof_saved");
  assert.equal((await secondaryVerifiedResultStatus(tx,i)).proofPresent,true);
  await assert.rejects(()=>recordSecondaryVerifiedResult(tx,proof(i)),/already claimed/);
  assert.equal((await settleSecondaryVerifiedResult(tx,env,{original:i,callback:i})).status,"completed");
  await assert.rejects(()=>settleSecondaryVerifiedResult(tx,env,{original:i,callback:i}),/not ready/);
 }
 assert.equal(seen.filter(v=>v.type==="credits_complete").length,2);
 assert.equal(new Set(seen.filter(v=>v.type==="credits_complete").map(v=>v.nonce)).size,2);
 assert.equal(entries.size,8);
});
test("foreign callbacks, missing prior attempt or untrusted proof cannot trigger settlement",async()=>{
 const {tx}=storage(),i=identity("yan_second");
 await assert.rejects(()=>recordSecondaryVerifiedResult(tx,proof(i)),/not attempted/);
 await attempted(tx,i);
 await assert.rejects(()=>recordSecondaryVerifiedResult(tx,{...proof(i),callback:identity("yan_03")}),/mismatch/);
 await assert.rejects(()=>recordSecondaryVerifiedResult(tx,{...proof(i),verifiedByTrustedExecutor:false}),/required/);
 await assert.rejects(()=>recordSecondaryVerifiedResult(tx,{...proof(i),proofFileId:""}),/required/);
 assert.equal((await secondaryVerifiedResultStatus(tx,i)).status,"not_started");
 await assert.rejects(()=>recordSecondaryVerifiedResult(tx,proof(identity("yan_first"))),/immutable/);
});
test("failed credit completion remains locked for reconciliation without another site attempt",async()=>{
 const {tx}=storage(),i=identity("yan_second");
 const env={ORDER_REMINDERS:{idFromName:s=>s,get:()=>({fetch:async(_,r)=>{
  const body=JSON.parse(r.body);
  return {ok:true,json:async()=>({ok:body.type!=="credits_complete"})};
 }})}};
 const reserve=await reserveSecondaryFeedbackCredit(tx,env,i,{independentAuthorConfirmed:true,moderatorApproved:true});
 assert.equal(reserve.status,"reserved");
 await attempted(tx,i);
 await recordSecondaryVerifiedResult(tx,proof(i));
 const done=await settleSecondaryVerifiedResult(tx,env,{original:i,callback:i});
 assert.equal(done.status,"reconciliation_required");
 await assert.rejects(()=>settleSecondaryVerifiedResult(tx,env,{original:i,callback:i}),/not ready/);
 assert.equal((await secondaryVerifiedResultStatus(tx,i)).status,"reconciliation_required");
});

test("uncertain or changed publication cannot settle a verified screenshot",async()=>{
 for(const status of ["uncertain","prepared","completed"]){
  const {tx}=storage(),{env,seen}=fakeEnv(),i=identity("yan_second",status==="uncertain"?"aaaaaaaaaaaa":status==="prepared"?"bbbbbbbbbbbb":"cccccccccccc");
  await reserveSecondaryFeedbackCredit(tx,env,i,{independentAuthorConfirmed:true,moderatorApproved:true});
  await attempted(tx,i);
  await recordSecondaryVerifiedResult(tx,proof(i));
  const key=manStorageKey({userId:i.userId,accountId:i.accountId,profileId:i.profileId,scope:"publication"})+":"+i.kind;
  await tx.put(key,{...await tx.get(key),status});
  await assert.rejects(()=>settleSecondaryVerifiedResult(tx,env,{original:i,callback:i}),/not ready/);
  assert.equal(seen.filter(v=>v.type==="credits_complete").length,0);
  assert.equal((await secondaryVerifiedResultStatus(tx,i)).status,"proof_saved");
 }
});
