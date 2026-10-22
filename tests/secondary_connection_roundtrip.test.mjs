import test from "node:test";
import assert from "node:assert/strict";
import {cabinetEvent,cabinetEndpoint} from "../src/cabinet_runtime.js";
import {OWNER_ID} from "../src/client_registry.js";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {manStorageKey,createAccountOperation} from "../src/man_account_isolation.js";
import {readSecondaryConnection,installSecondaryConnection} from "../src/secondary_man_connection.js";
import {startSecondaryRatingDryfill,requireFreshSecondaryRatingDryfill} from "../src/secondary_man_rating_dryfill.js";
import {createHmac} from "node:crypto";
import {handleAdminApi} from "../src/admin_app_api.js";

// All credentials, clients and records below are synthetic. No network is used.
const PROXY_KEY="11".repeat(32),SITE_KEY="22".repeat(32);
const CLIENT="123456789",OTHER="987654321",PROFILE="690230";
class Memory {
 map=new Map();
 async get(k){return structuredClone(this.map.get(k));}
 async put(k,v){this.map.set(k,structuredClone(v));}
 async delete(k){this.map.delete(k);}
 async transaction(fn){return fn(this);}
 async setAlarm(){}
 async list({prefix=""}={}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)));}
}
async function encrypt(secret,value,aad){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await crypto.subtle.importKey("raw",Uint8Array.from(secret.match(/../g),x=>parseInt(x,16)),"AES-GCM",false,["encrypt"]);
 const sealed=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(aad)},key,new TextEncoder().encode(JSON.stringify(value)));
 return {iv:[...iv],sealed:[...new Uint8Array(sealed)]};
}
async function seed(storage,id){
 const login=id+"@example.test",now=Date.now();
 await storage.put("man-proxy-sealed-v1:"+id,{accountId:id,version:2,protocol:"http",
  proxyVerified:true,ipVerified:true,expectedIp:"8.8.8.8",
  ...await encrypt(PROXY_KEY,{protocol:"http",host:id+".proxy.example.test",port:8080,
   username:id,password:"synthetic-proxy",expectedIp:"8.8.8.8"},id)});
 await storage.put("man-intimcity-sealed-v1:"+id,{accountId:id,version:3,boundProxyVersion:2,
  siteUrl:"https://b.intimcity.rip/",...await encrypt(SITE_KEY,{siteUrl:"https://b.intimcity.rip/",
   login,password:"synthetic-site"},id+":intimcity:2")});
 await storage.put("man-browser-check-v1:"+id,{accountId:id,proxyVersion:2,status:"verified",siteReachable:true});
 await storage.put("man-site-login-check-v1:"+id,{accountId:id,proxyVersion:2,siteVersion:3,
  status:"completed",code:"login_authenticated_identity_verified",claimed:true,startedAt:now-100,finishedAt:now});
 await storage.put("secondary-site-identity-v1:"+id,{accountId:id,proxyVersion:2,siteVersion:3,siteAccountId:login});
 await storage.put("man-owner-approval-v1:"+id,{accountId:id,version:1,approved:true,proxyVersion:2,siteVersion:3});
}
function fixture(){
 const stores=new Map([[OWNER_ID,new Memory()],[CLIENT,new Memory()],[OTHER,new Memory()]]),shared=new Map(),rpc=[];
 const env={DC_ACTIONS_TOKEN:"synthetic",ANKETA_CALLBACK_TOKEN:"synthetic",SECONDARY_CALLBACK_HMAC_KEY:"33".repeat(32),
  MAN_PROXY_ENCRYPTION_KEY:PROXY_KEY,MAN_SITE_ENCRYPTION_KEY:SITE_KEY,
  VISITORS_KV:{get:async(k,format)=>{const v=shared.get(k)??null;return format==="json"&&v!==null?JSON.parse(v):v;},put:async(k,v)=>shared.set(k,v)},
  ORDER_REMINDERS:{idFromName:x=>x,get:name=>({fetch:async(url,options)=>{
   const input=JSON.parse(options.body);rpc.push({name,input});
   if(name==="client-registry:v1")return Response.json({client:{id:input.userId,active:true}});
   if(name.startsWith("agreement:v1:"))return Response.json({status:"accepted"});
   if(name.startsWith("cabinet-events:v1:")){
    const uid=name.slice("cabinet-events:v1:".length);
    return Response.json(await cabinetEvent(stores.get(uid),env,input));
   }
   throw Error("Unexpected RPC: "+name);
  }})}};
 const event=(userId,event)=>cabinetEvent(stores.get(userId),env,{userId,event});
 return {stores,shared,env,rpc,event};
}
async function savePrivateProfile(storage,uid){
 const catalog=[{label:"Общая оценка",options:["5"]}];
 await storage.put("private:owner_anketa_library:"+uid,{value:JSON.stringify([PROFILE]),expires:0});
 await storage.put("private:owner_anketa_saved:"+uid+":"+PROFILE,{value:JSON.stringify({confirmed:true,
  host:"b.intimcity.rip",profile:{id:PROFILE,name:"Synthetic profile"},catalog}),expires:0});
}

test("every secondary ADMIN connection is reused by a client's full prepare/payload/result/status route",async()=>{
 const oldFetch=globalThis.fetch,dispatches=[];
 globalThis.fetch=async(url)=>{
  assert.match(String(url),/^https:\/\/api\.github\.com\/repos\/miqiduzavow369-ui\/dame-camelias\/actions\/workflows\/secondary-man-rating-dryfill\.yml\/dispatches$/);
  dispatches.push(String(url));return new Response(null,{status:204});
 };
 try{
  const f=fixture(),owner=f.stores.get(OWNER_ID),client=f.stores.get(CLIENT);
  await savePrivateProfile(client,CLIENT);
  for(const {id:accountId} of MAN_ACCOUNTS.slice(1)){
   await seed(owner,accountId);
   const admin=await f.event(OWNER_ID,{kind:"admin_secondary_rating_readiness",actorId:OWNER_ID,accountId});
   assert.equal(admin.ready,true,accountId);assert.deepEqual(admin.blockers,[]);
   assert.ok(!JSON.stringify(admin).includes("example.test"));
   assert.equal(admin.canPublish,false);
   const catalog=await f.event(OWNER_ID,{kind:"secondary_catalog_cabinet_ready",accountId});
   assert.equal(catalog.ready,admin.ready);
   const target={accountId,profileId:PROFILE};
   assert.equal((await f.event(CLIENT,{kind:"mini_rating_open",...target})).ok,true);
   assert.equal((await f.event(CLIENT,{kind:"mini_rating_save",...target,selected:{0:"5"},metElsewhere:false})).ok,true);
   assert.equal((await f.event(CLIENT,{kind:"mini_rating_action",...target,action:"prepare"})).stage,"preparing");
   const i=createAccountOperation({userId:CLIENT,...target,kind:"rating",nonce:"000000000000"});
   const dryKey=manStorageKey({...i,scope:"selection"})+":rating-site-dryfill";
   const dry=await client.get(dryKey);
   const query=new URLSearchParams({account_id:accountId,user_id:CLIENT,profile_id:PROFILE,nonce:dry.nonce});
   const payload=await cabinetEndpoint(new Request("https://audit.invalid/api/secondary-man/rating-dryfill-payload?"+query,
    {headers:{Authorization:"Bearer synthetic"}}),f.env,"secondary_man_rating_dryfill_payload");
   assert.equal(payload.status,200);const grant=await payload.json();
   assert.equal(grant.proxyHost,accountId+".proxy.example.test");assert.equal(grant.siteLogin,accountId+"@example.test");
   assert.equal(grant.userId,CLIENT);assert.equal(grant.accountId,accountId);
   const completed=await cabinetEndpoint(new Request("https://audit.invalid/api/secondary-man/rating-dryfill-result",{
    method:"POST",headers:{Authorization:"Bearer synthetic"},body:JSON.stringify({identity:i,nonce:dry.nonce,code:"verified"})
   }),f.env,"secondary_man_rating_dryfill_result");
   assert.equal(completed.status,200);assert.equal((await completed.json()).stage,"ready");
   assert.equal((await f.event(CLIENT,{kind:"mini_rating_action",...target,action:"status"})).stage,"ready");
   assert.equal(await owner.get(dryKey),undefined);
   assert.deepEqual(await client.get("man-proxy-sealed-v1:"+accountId),await owner.get("man-proxy-sealed-v1:"+accountId));
   assert.equal(await f.stores.get(OTHER).get("man-proxy-sealed-v1:"+accountId),undefined);
   // Expiry does not require changing the selections or entering credentials again.
   const row=await client.get(dryKey);row.completedAt=Date.now()-11*60000;await client.put(dryKey,row);
   await assert.rejects(requireFreshSecondaryRatingDryfill(client,{...f.env,VISITORS_KV:{get:async()=>({confirmed:true,profile:{id:PROFILE}})}},i));
   assert.equal((await f.event(CLIENT,{kind:"mini_rating_action",...target,action:"prepare"})).stage,"preparing");
  }
  assert.equal(dispatches.length,58);
  assert.ok(![...client.map.keys()].some(k=>k.includes(":publication:")||k.endsWith(":ledger")));
  assert.ok(!f.rpc.some(x=>x.name.startsWith("publication-credit:")));
 }finally{globalThis.fetch=oldFetch;}
});

test("different account, changed proxy, revoked permission and unverified login never become a confirmed connection",async()=>{
 const f=fixture(),owner=f.stores.get(OWNER_ID),client=f.stores.get(CLIENT);
 await seed(owner,"yan_second");await seed(owner,"yan_03");
 const source=(await readSecondaryConnection(owner,f.env,"yan_second",OWNER_ID)).snapshot;
 await assert.rejects(installSecondaryConnection(client,"yan_03",source));
 assert.equal(client.map.size,0);
 for(const [key,change] of [
  ["man-proxy-sealed-v1:yan_second",{version:4}],
  ["man-owner-approval-v1:yan_second",{approved:false}],
  ["man-site-login-check-v1:yan_second",{code:"login_authenticated_identity_unconfirmed"}],
  ["man-intimcity-sealed-v1:yan_second",{accountId:"yan_03"}]
 ]){
  const original=await owner.get(key);await owner.put(key,{...original,...change});
  assert.equal((await f.event(OWNER_ID,{kind:"secondary_catalog_cabinet_ready",accountId:"yan_second"})).ready,false);
  assert.equal((await f.event(OWNER_ID,{kind:"secondary_publication_account_snapshot",accountId:"yan_second"})).ok,false);
  await owner.put(key,original);
 }
 await assert.rejects(readSecondaryConnection(owner,f.env,"yan_first",OWNER_ID));
 await assert.rejects(installSecondaryConnection(client,"yan_first",source));
});

test("all 29 review payloads use the same personal ADMIN connection and remain one-use",async()=>{
 const f=fixture(),owner=f.stores.get(OWNER_ID),client=f.stores.get(CLIENT);
 for(const {id:accountId} of MAN_ACCOUNTS.slice(1)){
  await seed(owner,accountId);
  const config=await f.event(OWNER_ID,{kind:"secondary_publication_account_snapshot",accountId});
  await installSecondaryConnection(client,accountId,config);
  const i=createAccountOperation({userId:CLIENT,accountId,profileId:PROFILE,kind:"review",nonce:"abcdef123456"});
  const key=scope=>manStorageKey({...i,scope});
  // Synthetic prerequisite records; no real reserve, dispatch or site POST.
  await client.put(key("review-draft")+":review",{...i,version:1,authorAttested:true,text:"Synthetic personal review for "+accountId});
  await client.put(key("publication")+":review",{identity:i,status:"attempted",attempted:true,
   proxyVersion:2,siteVersion:3,independentAuthorConfirmed:true,moderatorApproved:true});
  await client.put(key("operation")+":review:"+i.nonce+":ledger",{...i,status:"reserved"});
  await client.put(key("callback")+":review:"+i.nonce,{identity:i,status:"issued",token:"a".repeat(32),
   proxyVersion:2,siteVersion:3,issuedAt:Date.now()-1000,expiresAt:Date.now()+60000});
  const query=new URLSearchParams({account_id:accountId,user_id:CLIENT,profile_id:PROFILE,nonce:i.nonce,callback_ticket:"a".repeat(32)});
  const request=()=>new Request("https://audit.invalid/api/secondary-man/review-payload?"+query,{headers:{Authorization:"Bearer synthetic"}});
  const response=await cabinetEndpoint(request(),f.env,"secondary_man_review_runner_payload");
  assert.equal(response.status,200);const grant=await response.json();
  assert.equal(grant.siteLogin,accountId+"@example.test");
  assert.equal(grant.proxyHost,accountId+".proxy.example.test");
  assert.equal(grant.userId,CLIENT);assert.equal(grant.accountId,accountId);
  assert.equal((await cabinetEndpoint(request(),f.env,"secondary_man_review_runner_payload")).status,409);
 }
 assert.ok(!f.rpc.some(x=>!x.name.startsWith("cabinet-events:v1:")));
});

test("private client review loads and a changed draft cannot inherit an old text approval",async()=>{
 const f=fixture(),client=f.stores.get(CLIENT),accountId="yan_second";
 await savePrivateProfile(client,CLIENT);
 const i=createAccountOperation({userId:CLIENT,accountId,profileId:PROFILE,kind:"review",nonce:"abcdef123456"});
 await client.put(manStorageKey({...i,scope:"review-draft"})+":review",{...i,version:2,authorAttested:true,text:"Synthetic review version two."});
 await client.put(manStorageKey({...i,scope:"moderation"})+":review",{identity:i,approved:true,draftVersion:1,approvedTextSha256:"0".repeat(64)});
 const loaded=await f.event(CLIENT,{kind:"mini_secondary_draft",accountId,profileId:PROFILE,draftKind:"review",action:"load"});
 assert.equal(loaded.text,"Synthetic review version two.");
 const status=await f.event(CLIENT,{kind:"mini_review_action",accountId,profileId:PROFILE,action:"status"});
 assert.equal(status.stage,"saved");assert.equal(status.publicationAvailable,false);
 assert.equal((await f.event(OTHER,{kind:"mini_secondary_draft",accountId,profileId:PROFILE,draftKind:"review",action:"load"})).status,403);
});

test("signed ADMIN diagnostics accepts a real numeric profile and never leaks account credentials",async()=>{
 const f=fixture();f.env.BOT_TOKEN="synthetic-admin-token";
 const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:Number(OWNER_ID)})});
 const check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("\n");
 const secret=createHmac("sha256","WebAppData").update(f.env.BOT_TOKEN).digest();
 params.set("hash",createHmac("sha256",secret).update(check).digest("hex"));
 const response=await handleAdminApi(new Request("https://audit.invalid/api/admin/action",{
  method:"POST",body:JSON.stringify({initData:params.toString(),action:"secondary_operation_status",
   userId:CLIENT,accountId:"yan_second",profileId:PROFILE,kind:"rating",nonce:"abcdef123456"})
 }),f.env);
 assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.ok,true);assert.equal(result.profileId,PROFILE);
 assert.equal(result.canRetrySitePost,false);
});
