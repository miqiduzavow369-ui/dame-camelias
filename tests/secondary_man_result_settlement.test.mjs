import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto,createHash} from "node:crypto";
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
const jpegBytes=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100),Buffer.from([255,217])]);
const jpegDigest=createHash("sha256").update(jpegBytes).digest("hex");
const jpegFileId="jpeg_"+jpegDigest.slice(0,40);
function installProof(env,i){
 env.VISITORS_KV={get:async()=>({accountId:i.accountId,userId:i.userId,
  profileId:i.profileId,kind:i.kind,nonce:i.nonce,
  base64:jpegBytes.toString("base64"),digest:jpegDigest,size:jpegBytes.length})};
}
function proof(i){return {original:i,callback:i,sitePublicationId:"verified-site-2345",proofFileId:jpegFileId,moderatorApproved:true,independentAuthorConfirmed:true,verifiedByTrustedExecutor:true,at:1000};}
test("two men's identical profile, client and nonce settle independently, once",async()=>{
 const {tx,entries}=storage(),{env,seen}=fakeEnv();
 for(const accountId of ["yan_second","yan_03"]){
  const i=identity(accountId);
  const reserved=await reserveSecondaryFeedbackCredit(tx,env,i,{independentAuthorConfirmed:true,moderatorApproved:true});
  assert.equal(reserved.status,"reserved");
  await attempted(tx,i);
  assert.equal((await recordSecondaryVerifiedResult(tx,proof(i))).status,"proof_saved");
  assert.equal((await secondaryVerifiedResultStatus(tx,i)).proofPresent,true);
  installProof(env,i);
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
 installProof(env,i);
 const done=await settleSecondaryVerifiedResult(tx,env,{original:i,callback:i});
 assert.equal(done.status,"reconciliation_required");
 await assert.rejects(()=>settleSecondaryVerifiedResult(tx,env,{original:i,callback:i}),/not ready/);
 assert.equal((await secondaryVerifiedResultStatus(tx,i)).status,"reconciliation_required");
 const ledgerKey=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"operation"})+":"+i.kind+":"+i.nonce+":ledger";
 assert.equal((await tx.get(ledgerKey)).status,"reconciliation_required");
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

test("publication status changed while external credit completes cannot be falsely finalized",async()=>{
 const {tx}=storage(),i=identity("yan_second","dddddddddddd");
 const {env:reserveEnv}=fakeEnv();
 await reserveSecondaryFeedbackCredit(tx,reserveEnv,i,{independentAuthorConfirmed:true,moderatorApproved:true});
 await attempted(tx,i);
 await recordSecondaryVerifiedResult(tx,proof(i));
 const publicationKey=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"publication"})+":"+i.kind;
 const {env}=fakeEnv();
 env.ORDER_REMINDERS.get=()=>({fetch:async(_,request)=>{
  const body=JSON.parse(request.body);
  if(body.type==="credits_complete"){
   const row=await tx.get(publicationKey);
   await tx.put(publicationKey,{...row,status:"uncertain"});
  }
  return {ok:true,json:async()=>({ok:true})};
 }});
 installProof(env,i);
 const result=await settleSecondaryVerifiedResult(tx,env,{original:i,callback:i});
 assert.equal(result.status,"reconciliation_required");
 assert.equal((await secondaryVerifiedResultStatus(tx,i)).status,"reconciliation_required");
 assert.equal((await tx.get(publicationKey)).status,"uncertain");
 await assert.rejects(()=>settleSecondaryVerifiedResult(tx,env,{original:i,callback:i}),/not ready/);
});

test("proof storage read failure is reconciled without debit or site repost",async()=>{
 const {tx}=storage(),i=identity("yan_second","eeeeeeeeeeee"),{env,seen}=fakeEnv();
 await reserveSecondaryFeedbackCredit(tx,env,i,{independentAuthorConfirmed:true,moderatorApproved:true});
 await attempted(tx,i);
 await recordSecondaryVerifiedResult(tx,proof(i));
 const evidenceKey=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"history"})+":"+i.kind+":"+i.nonce;
 const failing={...tx,get:async key=>{
  if(key===evidenceKey)throw Error("Temporary evidence read failure");
  return tx.get(key);
 },transaction:tx.transaction};
 const result=await settleSecondaryVerifiedResult(failing,env,{original:i,callback:i});
 assert.equal(result.status,"reconciliation_required");
 const resultKey=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"proof"})+":"+i.kind+":"+i.nonce+":settlement";
 assert.equal((await tx.get(resultKey)).status,"reconciliation_required");
 assert.equal(seen.filter(x=>x.type==="credits_complete").length,0);
 await assert.rejects(()=>settleSecondaryVerifiedResult(tx,env,{original:i,callback:i}),/not ready/);
});

test("publication changed while proof evidence is saved never becomes proof_saved",async()=>{
 const {tx}=storage(),i=identity("yan_second","ffffffffffff"),pubKey=manStorageKey({
  userId:i.userId,accountId:i.accountId,profileId:i.profileId,scope:"publication"})+":"+i.kind;
 const historyKey=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"history"})+":"+i.kind+":"+i.nonce;
 await attempted(tx,i);
 const racing={...tx,transaction:async fn=>fn({...tx,put:async(key,value)=>{
  await tx.put(key,value);
  if(key===historyKey){
   const pub=await tx.get(pubKey);
   await tx.put(pubKey,{...pub,status:"uncertain"});
  }
 }})};
 const result=await recordSecondaryVerifiedResult(racing,proof(i));
 assert.equal(result.status,"reconciliation_required");
 assert.equal((await secondaryVerifiedResultStatus(tx,i)).status,"reconciliation_required");
 assert.equal((await tx.get(pubKey)).status,"uncertain");
});
