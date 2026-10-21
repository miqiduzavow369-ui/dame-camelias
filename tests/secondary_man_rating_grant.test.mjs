import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import {claimSecondaryRatingRunnerPayload,recordSecondaryRatingSubmitBoundary} from "../src/secondary_man_review_runner_grant.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const identity={userId:"123456789",accountId:"yan_second",profileId:"690230",kind:"rating",nonce:"abcdef123456"};
const token="a".repeat(32);
const proxyKey="bb".repeat(32),siteKey="cc".repeat(32);
const key=scope=>manStorageKey({...identity,scope});
const selections=[{index:0,label:"Общая оценка",value:"5"}];
const payload={metElsewhere:false,selections};
const text=new TextEncoder();
async function fingerprint(s){return [...new Uint8Array(await webcrypto.subtle.digest("SHA-256",text.encode(s)))].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function seal(secret,plain,aad){
 const iv=webcrypto.getRandomValues(new Uint8Array(12));
 const k=await webcrypto.subtle.importKey("raw",Uint8Array.from(secret.match(/../g),x=>parseInt(x,16)),{name:"AES-GCM"},false,["encrypt"]);
 const binary=await webcrypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:text.encode(aad)},k,text.encode(JSON.stringify(plain)));
 return {iv:[...iv],sealed:[...new Uint8Array(binary)]};
}
async function seed(){
 const rows=new Map();
 const storage={get:async k=>rows.get(k),put:async(k,v)=>{rows.set(k,v);},transaction:async fn=>fn(storage)};
 await storage.put(key("rating-draft")+":rating",{
  ...identity,version:1,kind:"rating",selected:{"0":"5"},metElsewhere:false,
  catalogSignature:JSON.stringify([{label:"Общая оценка",options:["5"]}])
 });
 await storage.put(key("publication")+":rating",{
  identity:createAccountOperation(identity),status:"attempted",attempted:true,
  independentAuthorConfirmed:true,proxyVersion:2,siteVersion:3,
  ratingSelections:selections,ratingDraftVersion:1,
  ratingSelectionsSha256:await fingerprint(JSON.stringify(payload))
 });
 await storage.put(key("operation")+":rating:"+identity.nonce+":ledger",{
  ...identity,status:"reserved"
 });
 await storage.put(key("callback")+":rating:"+identity.nonce,{
  identity:createAccountOperation(identity),status:"issued",token,issuedAt:1000,
  expiresAt:100000,proxyVersion:2,siteVersion:3
 });
 await storage.put("man-owner-approval-v1:yan_second",{
  accountId:"yan_second",approved:true,version:1,proxyVersion:2,siteVersion:3
 });
 await storage.put("secondary-site-identity-v1:yan_second",{
  accountId:"yan_second",siteAccountId:"author@example.test",proxyVersion:2,siteVersion:3
 });
 await storage.put("man-proxy-sealed-v1:yan_second",{
  accountId:"yan_second",version:2,proxyVerified:true,ipVerified:true,expectedIp:"8.8.8.8",
  ...await seal(proxyKey,{protocol:"http",host:"proxy.example.test",
   port:8080,expectedIp:"8.8.8.8",username:"proxy-login",password:"proxy-secret"},"yan_second")
 });
 await storage.put("man-intimcity-sealed-v1:yan_second",{
  accountId:"yan_second",version:3,boundProxyVersion:2,siteUrl:"https://b.intimcity.rip/",
  ...await seal(siteKey,{siteUrl:"https://b.intimcity.rip/",
   login:"author@example.test",password:"site-secret"},"yan_second:intimcity:2")
 });
 return {storage,rows};
}
const env={MAN_PROXY_ENCRYPTION_KEY:proxyKey,MAN_SITE_ENCRYPTION_KEY:siteKey};
test("secondary rating grant consumes once and preserves exact saved values",async()=>{
 const {storage}=await seed();
 const grant=await claimSecondaryRatingRunnerPayload(storage,env,{
  identity,token,at:2000
 });
 assert.equal(grant.kind,"rating");
 assert.equal(grant.accountId,"yan_second");
 assert.equal(grant.siteLogin,"author@example.test");
 assert.equal(grant.proxyHost,"proxy.example.test");
 assert.deepEqual(grant.selections,payload);
 assert.equal(grant.approvedSelectionsSha256,await fingerprint(JSON.stringify(payload)));
 await assert.rejects(()=>claimSecondaryRatingRunnerPayload(storage,env,{
  identity,token,at:2001
 }),/authorization/);
 assert.equal((await recordSecondaryRatingSubmitBoundary(storage,{
  identity,token,approvedSelectionsSha256:grant.approvedSelectionsSha256,at:2002
 })).stage,"rating_submit_boundary");
 await assert.rejects(()=>recordSecondaryRatingSubmitBoundary(storage,{
  identity,token,approvedSelectionsSha256:grant.approvedSelectionsSha256,at:2003
 }),/consumed/);
});
test("rating grant rejects changed saved selections and a Yan First substitute",async()=>{
 const {storage}=await seed();
 const keyDraft=key("rating-draft")+":rating";
 await storage.put(keyDraft,{...await storage.get(keyDraft),version:2});
 await assert.rejects(()=>claimSecondaryRatingRunnerPayload(storage,env,{
  identity,token,at:2000
 }),/authorization/);
 await assert.rejects(()=>claimSecondaryRatingRunnerPayload(storage,env,{
  identity:{...identity,accountId:"yan_first"},token,at:2000
 }),/Invalid secondary rating grant/);
});
