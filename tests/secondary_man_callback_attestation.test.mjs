import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import {signSecondaryResultAttestation,verifySecondaryResultAttestation} from "../src/secondary_man_callback_attestation.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret="ab".repeat(32),otherSecret="cd".repeat(32);
const input=(man="yan_second")=>({
 identity:{userId:"123456789",accountId:man,profileId:"2468",kind:"review",nonce:"abcdef123456"},
 proxyVersion:2,siteVersion:3,issuedAt:1000000,status:"verified_published",
 sitePublicationId:"site-confirmed-1234",proofFileId:"telegram-proof-5678"
});
function storage(){
 const map=new Map();
 return {map,get:async key=>map.get(key),put:async(k,v)=>map.set(k,v)};
}
async function attempted(db,x){
 const i=x.identity;
 const key=manStorageKey({userId:i.userId,accountId:i.accountId,profileId:i.profileId,scope:"publication"})+":"+i.kind;
 await db.put(key,{identity:createAccountOperation(i),status:"attempted",attempted:true,
  proxyVersion:x.proxyVersion,siteVersion:x.siteVersion});
}
test("per-man HMAC attestation binds proof to site, proxy, client, profile and operation",async()=>{
 const db=storage(),x=input();
 await attempted(db,x);
 const signature=await signSecondaryResultAttestation(secret,x);
 const result=await verifySecondaryResultAttestation(db,{secret,input:x,signature,at:x.issuedAt+1000});
 assert.equal(result.identity.accountId,"yan_second");
 assert.equal(result.verifiedByTrustedExecutor,true);
 for(const change of [
  {identity:{...x.identity,accountId:"yan_03"}},
  {identity:{...x.identity,userId:"987654321"}},
  {identity:{...x.identity,profileId:"9999"}},
  {identity:{...x.identity,kind:"rating"}},
  {identity:{...x.identity,nonce:"bbbbbb123456"}},
  {proxyVersion:8},{siteVersion:9},{sitePublicationId:"site-confirmed-wrong"},
  {proofFileId:"telegram-proof-wrong"}
 ]){
  await assert.rejects(()=>verifySecondaryResultAttestation(db,{secret,input:{...x,...change},signature,at:x.issuedAt+1000}),/invalid/);
 }
 await assert.rejects(()=>verifySecondaryResultAttestation(db,{secret:otherSecret,input:x,signature,at:x.issuedAt+1000}),/invalid/);
 await assert.rejects(()=>verifySecondaryResultAttestation(db,{secret,input:x,signature,at:x.issuedAt+600000}),/invalid/);
});
test("signature cannot authorize a missing, replaced or not-attempted publication",async()=>{
 const x=input(),db=storage(),signature=await signSecondaryResultAttestation(secret,x);
 await assert.rejects(()=>verifySecondaryResultAttestation(db,{secret,input:x,signature,at:x.issuedAt}),/invalid/);
 await attempted(db,x);
 const k=manStorageKey({userId:x.identity.userId,accountId:x.identity.accountId,profileId:x.identity.profileId,scope:"publication"})+":"+x.identity.kind;
 await db.put(k,{identity:createAccountOperation(x.identity),status:"prepared",attempted:false,proxyVersion:2,siteVersion:3});
 await assert.rejects(()=>verifySecondaryResultAttestation(db,{secret,input:x,signature,at:x.issuedAt}),/invalid/);
 await db.put(k,{identity:createAccountOperation(x.identity),status:"attempted",attempted:true,proxyVersion:7,siteVersion:3});
 await assert.rejects(()=>verifySecondaryResultAttestation(db,{secret,input:x,signature,at:x.issuedAt}),/invalid/);
 await assert.rejects(()=>signSecondaryResultAttestation(secret,input("yan_first")) ,/invalid/);
});
