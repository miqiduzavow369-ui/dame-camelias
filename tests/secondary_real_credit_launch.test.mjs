import test from "node:test";
import assert from "node:assert/strict";
import {OrderReminder} from "../src/reminders.js";
import {credits,creditHistory} from "../src/publication_credits.js";
import {reserveSecondaryFeedbackCredit,reconcileUnstartedSecondaryReservations,settleSecondaryFeedbackCredit} from "../src/secondary_man_credit_bridge.js";
import {launchApprovedSecondaryRating,preflightSecondaryRating} from "../src/secondary_man_rating_launch.js";
import {appendVerifiedFeedbackEvidence} from "../src/secondary_man_feedback_evidence.js";
import {manStorageKey,createAccountOperation} from "../src/man_account_isolation.js";
import {cabinetEvent} from "../src/cabinet_runtime.js";

const UID="5866034656",PID="690230";
class Memory {
 map=new Map();
 async get(k){return structuredClone(this.map.get(k));}
 async put(k,v){this.map.set(k,structuredClone(v));}
 async delete(k){this.map.delete(k);}
 async list({prefix=""}={}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)));}
 async transaction(fn){return fn(this);}
 async setAlarm(){}
}
const identity=(accountId,nonce="abcdef123456")=>({userId:UID,profileId:PID,kind:"rating",accountId,nonce});
const key=i=>manStorageKey({...i,scope:"operation"})+":rating:"+i.nonce+":ledger";
function fixture(){
 const db=new Memory(),calls=[];
 const ledger=new OrderReminder({storage:db,blockConcurrencyWhile:fn=>fn()},{});
 const env={DC_ACTIONS_TOKEN:"synthetic",ANKETA_CALLBACK_TOKEN:"synthetic",SECONDARY_CALLBACK_HMAC_KEY:"synthetic",
  MAN_PROXY_ENCRYPTION_KEY:"synthetic",MAN_SITE_ENCRYPTION_KEY:"synthetic",
  VISITORS_KV:{get:async()=>({confirmed:true,profile:{id:PID}})},
  ORDER_REMINDERS:{idFromName:x=>x,get:name=>({fetch:async(url,options)=>{
   assert.equal(name,"publication-credits:"+UID);calls.push(JSON.parse(options.body));
   return ledger.fetch(new Request(url,options));
  }})}};
 return {db,env,calls};
}
async function ready(storage,i){
 const a=i.accountId;
 await storage.put("man-proxy-sealed-v1:"+a,{accountId:a,version:1,proxyVerified:true,ipVerified:true});
 await storage.put("man-intimcity-sealed-v1:"+a,{accountId:a,version:2,boundProxyVersion:1,configured:true,siteUrl:"https://c.intimcity.rip/"});
 await storage.put("man-owner-approval-v1:"+a,{accountId:a,version:1,proxyVersion:1,siteVersion:2,approved:true});
 await storage.put("secondary-site-identity-v1:"+a,{accountId:a,proxyVersion:1,siteVersion:2,siteAccountId:a+"@example.test"});
 const catalog=[{label:"Общая оценка",options:["5"]},{label:"Вежливость",options:["Да"]}];
 await storage.put(manStorageKey({...i,scope:"rating-draft"})+":rating",{
  ...i,version:1,catalogSignature:JSON.stringify(catalog),selected:{0:"5",1:"Да"},metElsewhere:false});
}
async function oldClaim(storage,i){
 const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(
  ["secondary-ledger-v1",i.userId,i.accountId,i.profileId,i.kind,i.nonce].join(":")));
 const ledgerNonce=[...new Uint8Array(bytes).slice(0,6)].map(x=>x.toString(16).padStart(2,"0")).join("");
 await storage.put(key(i),{...i,ledgerNonce,status:"reserving"});
 return ledgerNonce;
}
test("real ledger launches two personal ratings on the same profile after Yan First without shared claims",async()=>{
 const {db,env}=fixture();
 await credits(env,UID,"reserve","rating",PID,"111111111111");
 await credits(env,UID,"complete","rating",PID,"111111111111");
 const legacy=structuredClone((await db.get("credits_v1")).claims["rating:"+PID]);
 const client=new Memory(),dispatched=[];
 for(const a of ["yan_second","yan_03"]){
  const i=identity(a);await ready(client,i);
  const result=await launchApprovedSecondaryRating(client,env,{identity:i,at:Date.now(),dispatch:async input=>{
   dispatched.push(input);return {accepted:true};
  }});
  assert.equal(result.ok,true);assert.equal(result.dispatchAccepted,true);
 }
 assert.deepEqual(dispatched.map(x=>x.accountId),["yan_second","yan_03"]);
 assert.notEqual(dispatched[0].callbackTicket,dispatched[1].callbackTicket);
 assert.deepEqual((await db.get("credits_v1")).claims["rating:"+PID],legacy);
 const balance=await credits(env,UID,"status");
 assert.equal(balance.spent,1);assert.equal(balance.reserved,2);assert.equal(balance.available,7);
 const events=(await creditHistory(env,UID)).events;
 assert.equal(events.filter(x=>x.type==="reserve").length,2);
 assert.deepEqual(events.filter(x=>x.type==="reserve").map(x=>x.accountId).sort(),["yan_03","yan_second"]);
});
test("all 29 secondary men have their own claim while sharing the same unchanged client balance",async()=>{
 const {db,env}=fixture(),s=new Memory();
 await db.put("credits_v1",{grant:60,grantRevision:2,spent:0,claims:{},history:[]});
 for(const a of ["yan_second",...Array.from({length:28},(_,i)=>"yan_"+String(i+3).padStart(2,"0"))]){
  assert.equal((await reserveSecondaryFeedbackCredit(s,env,identity(a),{independentAuthorConfirmed:true})).ok,true);
 }
 assert.equal(Object.keys((await db.get("credits_v1")).claims).length,29);
 const balance=await credits(env,UID,"status");
 assert.equal(balance.available,31);assert.equal(balance.reserved,29);assert.equal(balance.spent,0);
});
test("failed legacy reserve is retired only after a ledger fence, preserving Yan's completed credit",async()=>{
 const {db,env}=fixture(),s=new Memory(),i=identity("yan_second");
 await credits(env,UID,"reserve","rating",PID,"111111111111");
 await credits(env,UID,"complete","rating",PID,"111111111111");
 const before=await db.get("credits_v1"),nonce=await oldClaim(s,i);
 await reconcileUnstartedSecondaryReservations(s,env,i);
 assert.equal((await s.get(key(i))).status,"reserve_rejected");
 assert.deepEqual((await db.get("credits_v1")).claims,before.claims);
 assert.equal((await db.get("credits_v1")).spent,before.spent);
 assert.equal((await credits(env,UID,"reserve","rating",PID,nonce)).reason,"reserve_fenced");
 assert.equal((await reserveSecondaryFeedbackCredit(s,env,{...i,nonce:"222222222222"},{independentAuthorConfirmed:true})).ok,true);
 assert.equal((await credits(env,UID,"status")).spent,1);
});
test("fencing an absent old reserve prevents a delayed RPC from later consuming credit",async()=>{
 const {env}=fixture(),s=new Memory(),i=identity("yan_second");
 const nonce=await oldClaim(s,i);
 await reconcileUnstartedSecondaryReservations(s,env,i);
 assert.equal((await credits(env,UID,"reserve","rating",PID,nonce)).reason,"reserve_fenced");
 assert.equal((await credits(env,UID,"status")).available,10);
});
test("a real held reservation or an existing publication/ticket is never automatically cleared",async()=>{
 const {env,calls}=fixture(),s=new Memory(),i=identity("yan_second"),nonce=await oldClaim(s,i);
 await credits(env,UID,"reserve","rating",PID,nonce);
 await reconcileUnstartedSecondaryReservations(s,env,i);
 assert.equal((await s.get(key(i))).status,"reserving");
 assert.equal((await credits(env,UID,"status")).reserved,1);
 await s.put(manStorageKey({...i,scope:"publication"})+":rating",{identity:{...i,version:1},status:"attempted"});
 const n=calls.length;await reconcileUnstartedSecondaryReservations(s,env,i);
 assert.equal(calls.length,n);
 await s.delete(manStorageKey({...i,scope:"publication"})+":rating");
 await s.put(manStorageKey({...i,scope:"callback"})+":rating:"+i.nonce,{status:"issued"});
 await reconcileUnstartedSecondaryReservations(s,env,i);assert.equal(calls.length,n);
});
test("definite insufficient balance is rejected without an ambiguous claim",async()=>{
 const {db,env}=fixture(),s=new Memory(),i=identity("yan_second");
 await db.put("credits_v1",{grant:0,grantRevision:1,spent:0,claims:{},history:[]});
 const result=await reserveSecondaryFeedbackCredit(s,env,i,{independentAuthorConfirmed:true});
 assert.equal(result.status,"reserve_rejected");assert.equal(result.reason,"empty");
 assert.equal((await s.get(key(i))).status,"reserve_rejected");
 assert.deepEqual((await db.get("credits_v1")).claims,{});
});
test("scoped completion and its alarm retry settle exactly the selected man's credit",async()=>{
 const {db,env}=fixture(),s=new Memory(),i=identity("yan_second"),other=identity("yan_03"),queue=[];
 env.__enqueueLedger=async entry=>queue.push(entry);
 env.__settleLedger=async()=>{};
 for(const item of [i,other])await reserveSecondaryFeedbackCredit(s,env,item,{independentAuthorConfirmed:true});
 await appendVerifiedFeedbackEvidence(s,{identity:i,sitePublicationId:"proof-12345",proofFileId:"file-123456",
  independentAuthorConfirmed:true,moderatorApproved:true,at:1000});
 assert.equal((await settleSecondaryFeedbackCredit(s,env,i)).ok,true);
 assert.equal(queue[0].accountId,i.accountId);
 const outbox=new Memory();await outbox.put("ledger_outbox",{retry:queue[0]});
 await new OrderReminder({storage:outbox,blockConcurrencyWhile:fn=>fn()},env).runAlarm();
 assert.deepEqual(await outbox.get("ledger_outbox"),{});
 const balance=await credits(env,UID,"status");assert.equal(balance.spent,1);assert.equal(balance.reserved,1);
 assert.equal((await db.get("credits_v1")).claims["yan_03:rating:"+PID].status,"reserved");
});
test("client status recovers a false legacy block and the same saved selection dispatches once",async()=>{
 const {env}=fixture(),s=new Memory(),i=identity("yan_second");await ready(s,i);
 await s.put("private:owner_anketa_saved:"+UID+":"+PID,{expires:0,
  value:JSON.stringify({confirmed:true,host:"c.intimcity.rip",profile:{id:PID}})});
 const preflight=await preflightSecondaryRating(s,env,{identity:i});
 const dry=createAccountOperation({...i,nonce:"000000000000"});
 await s.put(manStorageKey({...dry,scope:"selection"})+":rating-site-dryfill",{
  identity:dry,status:"verified",claimed:true,completedAt:Date.now(),fingerprint:preflight.fingerprint,
  draftVersion:1,proxyVersion:1,siteVersion:2});
 await credits(env,UID,"reserve","rating",PID,"111111111111");
 await credits(env,UID,"complete","rating",PID,"111111111111");
 await oldClaim(s,i);
 const event=action=>cabinetEvent(s,env,{userId:UID,event:{kind:"mini_rating_action",
  action,accountId:i.accountId,profileId:PID,confirmed:action==="publish"}});
 assert.deepEqual(await event("status"),{ok:true,stage:"ready"});
 const savedDraft=await s.get(manStorageKey({...i,scope:"rating-draft"})+":rating");
 const previous=globalThis.fetch,dispatches=[];
 globalThis.fetch=async(url,options)=>{
  assert.match(String(url),/\/secondary-man-rating-publish.yml\/dispatches$/);
  dispatches.push(JSON.parse(options.body));return new Response(null,{status:204});
 };
 try{
  assert.equal((await event("publish")).stage,"publishing");
  assert.equal((await event("publish")).reason,"already_published_or_pending");
 }finally{globalThis.fetch=previous;}
 assert.equal(dispatches.length,1);assert.equal(dispatches[0].inputs.account_id,i.accountId);
 assert.deepEqual(await s.get(manStorageKey({...i,scope:"rating-draft"})+":rating"),savedDraft);
 assert.equal((await credits(env,UID,"status")).spent,1);
 assert.equal((await credits(env,UID,"status")).reserved,1);
});
