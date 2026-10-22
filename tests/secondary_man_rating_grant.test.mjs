import test from "node:test";
import assert from "node:assert/strict";
import {OrderReminder} from "../src/reminders.js";
import {reserveSecondaryFeedbackCredit} from "../src/secondary_man_credit_bridge.js";
import {recordTicketedSecondaryResult,settleSecondaryVerifiedResult,secondaryVerifiedResultStatus} from "../src/secondary_man_result_settlement.js";
import {signSecondaryResultAttestation} from "../src/secondary_man_callback_attestation.js";
import {webcrypto,createHash} from "node:crypto";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import {claimSecondaryRatingRunnerPayload,recordSecondaryRatingSubmitBoundary,claimSecondaryRatingProofRecovery} from "../src/secondary_man_review_runner_grant.js";
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
const env={SECONDARY_CALLBACK_HMAC_KEY:"dd".repeat(32),MAN_PROXY_ENCRYPTION_KEY:proxyKey,MAN_SITE_ENCRYPTION_KEY:siteKey};
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


test("posted rating recovery renews only its result ticket and cannot submit again",async()=>{
 const {storage,rows}=await seed();
 const grant=await claimSecondaryRatingRunnerPayload(storage,env,{identity,token,at:2000});
 await recordSecondaryRatingSubmitBoundary(storage,{identity,token,approvedSelectionsSha256:grant.approvedSelectionsSha256,at:2001});
 const beforeKeys=new Set(rows.keys());
 const recovered=await claimSecondaryRatingProofRecovery(storage,env,{identity,token,at:200000});
 assert.equal(recovered.readOnly,true);
 assert.equal(recovered.mode,"proof-recovery");
 assert.equal(recovered.siteLogin,"author@example.test");
 assert.equal(recovered.proxyUsername,"proxy-login");
 assert.equal(recovered.approvedSelectionsSha256,grant.approvedSelectionsSha256);
 assert.notEqual(recovered.callbackTicket,token);
 assert.match(recovered.resultSigningKey,/^[a-f0-9]{64}$/);
 assert.notEqual(recovered.resultSigningKey,env.SECONDARY_CALLBACK_HMAC_KEY);
 assert.equal((await storage.get(key("operation")+":rating:"+identity.nonce+":ledger")).status,"reserved");
 assert.equal((await storage.get(key("publication")+":rating")).status,"attempted");
 assert.equal([...rows.keys()].filter(k=>!beforeKeys.has(k)).length,1);
 await assert.rejects(()=>claimSecondaryRatingProofRecovery(storage,env,{identity,token,at:200001}),/authorized/);
 await assert.rejects(()=>claimSecondaryRatingRunnerPayload(storage,env,{identity,token:recovered.callbackTicket,at:200001}),/authorization/);
 await assert.rejects(()=>recordSecondaryRatingSubmitBoundary(storage,{identity,token:recovered.callbackTicket,approvedSelectionsSha256:grant.approvedSelectionsSha256,at:200001}),/consumed/);
});

test("recovery rejects unsubmitted, replaced, revoked, settled or foreign operations",async()=>{
 const scenarios=[
  async s=>{},
  async s=>s.put(key("publication")+":rating",{...await s.get(key("publication")+":rating"),status:"completed"}),
  async s=>s.put(key("operation")+":rating:"+identity.nonce+":ledger",{...identity,status:"completed"}),
  async s=>s.put("man-owner-approval-v1:yan_second",{approved:false}),
  async s=>s.put("secondary-site-identity-v1:yan_second",{accountId:"yan_second",proxyVersion:99,siteVersion:3}),
  async s=>s.put(key("callback")+":rating:"+identity.nonce,{...await s.get(key("callback")+":rating:"+identity.nonce),status:"consumed"})
 ];
 for(let n=0;n<scenarios.length;n++){
  const {storage}=await seed();
  if(n){const g=await claimSecondaryRatingRunnerPayload(storage,env,{identity,token,at:2000});
   await recordSecondaryRatingSubmitBoundary(storage,{identity,token,approvedSelectionsSha256:g.approvedSelectionsSha256,at:2001});}
  await scenarios[n](storage);
  await assert.rejects(()=>claimSecondaryRatingProofRecovery(storage,env,{identity,token,at:200000}),/authorized/);
 }
 const {storage}=await seed();
 for(const altered of [{...identity,accountId:"yan_03"},{...identity,profileId:"123"}])
  await assert.rejects(()=>claimSecondaryRatingProofRecovery(storage,env,{identity:altered,token,at:200000}),/authorized/);
 await assert.rejects(()=>claimSecondaryRatingProofRecovery(storage,env,{identity,token:"b".repeat(32),at:200000}),/authorized/);
 await assert.rejects(()=>claimSecondaryRatingProofRecovery(storage,env,{identity:{...identity,accountId:"yan_first"},token,at:200000}),/Invalid/);
});

test("missing Worker signing configuration fails before consuming a publication grant",async()=>{
 const {storage,rows}=await seed();const snapshot=JSON.stringify([...rows]);
 await assert.rejects(()=>claimSecondaryRatingRunnerPayload(storage,{...env,SECONDARY_CALLBACK_HMAC_KEY:""},{identity,token,at:2000}),/invalid/);
 assert.equal(JSON.stringify([...rows]),snapshot);
});

test("read-only recovery archives exact JPEG and settles existing actual ledger once",async()=>{
 const {storage,rows}=await seed();
 class Memory {
  map=new Map();async get(k){return structuredClone(this.map.get(k));}
  async put(k,v){this.map.set(k,structuredClone(v));}async delete(k){this.map.delete(k);}
  async transaction(fn){return fn(this);}async setAlarm(){}
  async list({prefix=""}={}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)));}
 }
 const ledgerDb=new Memory(),calls=[],proofRows=new Map();
 await ledgerDb.put("credits_v1",{grant:2,spent:0,claims:{},history:[]});
 const ledger=new OrderReminder({storage:ledgerDb,blockConcurrencyWhile:fn=>fn()},{});
 const proofKv={get:async(k,type)=>{const value=proofRows.get(k);return value?(type==="json"?JSON.parse(value):value):null;},put:async(k,v)=>proofRows.set(k,v)};
 const liveEnv={...env,VISITORS_KV:proofKv,ORDER_REMINDERS:{idFromName:x=>x,get:()=>({fetch:async(url,options)=>{
  calls.push(JSON.parse(options.body));return ledger.fetch(new Request(url,options));
 }})}};
 rows.delete(key("operation")+":rating:"+identity.nonce+":ledger");
 assert.equal((await reserveSecondaryFeedbackCredit(storage,liveEnv,identity,{independentAuthorConfirmed:true})).status,"reserved");
 const grant=await claimSecondaryRatingRunnerPayload(storage,liveEnv,{identity,token,at:2000});
 await recordSecondaryRatingSubmitBoundary(storage,{identity,token,approvedSelectionsSha256:grant.approvedSelectionsSha256,at:2001});
 const recovered=await claimSecondaryRatingProofRecovery(storage,liveEnv,{identity,token,at:200000});
 const jpeg=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100),Buffer.from([255,217])]);
 const input={identity,proxyVersion:2,siteVersion:3,issuedAt:200001,status:"verified_published",
  sitePublicationId:"proof_existing_rating",proofFileId:"jpeg_"+createHash("sha256").update(jpeg).digest("hex").slice(0,40)};
 const opts={identity,token:recovered.callbackTicket,secret:env.SECONDARY_CALLBACK_HMAC_KEY,input,
  signature:await signSecondaryResultAttestation(recovered.resultSigningKey,input),at:200002,
  moderatorApproved:true,independentAuthorConfirmed:true,proofKv,originalJpegBase64:jpeg.toString("base64")};
 assert.equal((await recordTicketedSecondaryResult(storage,opts)).status,"proof_saved");
 assert.equal((await settleSecondaryVerifiedResult(storage,liveEnv,{original:identity,callback:identity})).status,"completed");
 assert.equal((await secondaryVerifiedResultStatus(storage,identity)).status,"completed");
 assert.deepEqual(calls.filter(x=>x.type.startsWith("credits_")).map(x=>x.type),["credits_reserve","credits_complete"]);
 assert.equal((await storage.get(key("publication")+":rating")).status,"completed");
 await assert.rejects(()=>recordTicketedSecondaryResult(storage,opts),/consumed|invalid/);
 await assert.rejects(()=>settleSecondaryVerifiedResult(storage,liveEnv,{original:identity,callback:identity}),/not ready/);
 assert.deepEqual(calls.filter(x=>x.type.startsWith("credits_")).map(x=>x.type),["credits_reserve","credits_complete"]);
 assert.equal(proofRows.size,1);
});
