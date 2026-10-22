// Mandatory offline contract: no real account, browser session, site post or Telegram message.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {Memory,seed,fixture,savePrivateProfile,CLIENT,PROFILE,OWNER_ID} from "./helpers/secondary_registration_fixture.mjs";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {OrderReminder} from "../src/reminders.js";
import {manStorageKey,createAccountOperation} from "../src/man_account_isolation.js";
import {readSecondaryConnection,installSecondaryConnection} from "../src/secondary_man_connection.js";
import {launchApprovedSecondaryRating} from "../src/secondary_man_rating_launch.js";
import {recordSecondaryRatingSubmitBoundary} from "../src/secondary_man_review_runner_grant.js";
import {cabinetEndpoint} from "../src/cabinet_runtime.js";
import {signSecondaryResultAttestation} from "../src/secondary_man_callback_attestation.js";
import {secondaryCompletedProof,deliverSecondaryCompletedResult} from "../src/secondary_man_result_delivery.js";

for(const man of MAN_ACCOUNTS.slice(1))test(man.id+": ADMIN → own grant → one submit boundary → signed JPEG → one spend → cabinet result",async()=>{
 const f=fixture(),owner=f.stores.get(OWNER_ID),client=f.stores.get(CLIENT);
 f.env.BOT_TOKEN="synthetic-bot";
 const objects=new Map(),ledgerCalls=[],originalGet=f.env.ORDER_REMINDERS.get;
 f.env.ORDER_REMINDERS.get=name=>{
  if(!name.startsWith("publication-credits:")&&!name.startsWith("daily-profile:"))return originalGet(name);
  return {fetch:async(url,options)=>{
   if(!objects.has(name)){
    const storage=new Memory();
    if(name.startsWith("publication-credits:"))await storage.put("credits_v1",{grant:10,spent:0,claims:{},history:[]});
    objects.set(name,new OrderReminder({storage,blockConcurrencyWhile:fn=>fn()},f.env));
   }
   ledgerCalls.push(JSON.parse(options.body));return objects.get(name).fetch(new Request(url,options));
  }};
 };
 await seed(owner,man.id);await savePrivateProfile(client,CLIENT);
 const registration=await f.event(OWNER_ID,{kind:"admin_man_registration_status",actorId:OWNER_ID,accountId:man.id});
 assert.equal(registration.ok,true);assert.equal(registration.connection.ready,true);
 assert.equal(registration.connection.canPublish,false);
 const serialized=JSON.stringify(registration);
 assert.ok(!serialized.includes("synthetic-proxy-")&&!serialized.includes("synthetic-site-")&&!serialized.includes('"sealed"'));
 const {snapshot}=await readSecondaryConnection(owner,f.env,man.id,OWNER_ID);
 await installSecondaryConnection(client,man.id,snapshot);
 const foreign={...snapshot,proxy:{...snapshot.proxy,accountId:man.id==="yan_second"?"yan_03":"yan_second"}};
 await assert.rejects(()=>installSecondaryConnection(new Memory(),man.id,foreign),/not confirmed/);
 await f.event(CLIENT,{kind:"mini_rating_save",accountId:man.id,profileId:PROFILE,selected:{0:"5"},metElsewhere:false});
 const identity=createAccountOperation({userId:CLIENT,accountId:man.id,profileId:PROFILE,kind:"rating",nonce:"abcdef123456"});
 let dispatch;
 const launch=await launchApprovedSecondaryRating(client,{...f.env,VISITORS_KV:{get:async()=>({confirmed:true,profile:{id:PROFILE}})}},{identity,at:Date.now(),dispatch:async args=>(dispatch=args,{accepted:true})});
 assert.equal(launch.dispatchAccepted,true);
 const query=new URLSearchParams({account_id:man.id,user_id:CLIENT,profile_id:PROFILE,nonce:identity.nonce,callback_ticket:dispatch.callbackTicket});
 const request=()=>new Request("https://audit.invalid/api/secondary-man/rating-payload?"+query,{headers:{Authorization:"Bearer synthetic"}});
 const response=await cabinetEndpoint(request(),f.env,"secondary_man_rating_runner_payload");assert.equal(response.status,200);
 const grant=await response.json();
 assert.equal(grant.proxyHost,man.id+".proxy.example.test");assert.equal(grant.proxyPassword,"synthetic-proxy-"+man.id);
 assert.equal(grant.siteLogin,man.id+"@example.test");assert.equal(grant.sitePassword,"synthetic-site-"+man.id);
 assert.match(grant.resultSigningKey,/^[a-f0-9]{64}$/);assert.notEqual(grant.resultSigningKey,f.env.SECONDARY_CALLBACK_HMAC_KEY);
 assert.equal((await cabinetEndpoint(request(),f.env,"secondary_man_rating_runner_payload")).status,409);
 await recordSecondaryRatingSubmitBoundary(client,{identity,token:dispatch.callbackTicket,approvedSelectionsSha256:grant.approvedSelectionsSha256,at:Date.now()});
 await assert.rejects(()=>recordSecondaryRatingSubmitBoundary(client,{identity,token:dispatch.callbackTicket,approvedSelectionsSha256:grant.approvedSelectionsSha256,at:Date.now()}),/consumed/);
 const jpeg=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100),Buffer.from([255,217])]);
 const input={identity,proxyVersion:2,siteVersion:3,issuedAt:Date.now(),status:"verified_published",sitePublicationId:"proof_"+man.id,
  proofFileId:"jpeg_"+createHash("sha256").update(jpeg).digest("hex").slice(0,40)};
 const body={identity,token:dispatch.callbackTicket,input,signature:await signSecondaryResultAttestation(grant.resultSigningKey,input),originalJpegBase64:jpeg.toString("base64")};
 const callback=()=>new Request("https://audit.invalid/api/secondary-man/result",{method:"POST",headers:{Authorization:"Bearer synthetic"},body:JSON.stringify(body)});
 const previousFetch=globalThis.fetch;let sends=0;
 globalThis.fetch=async(url,options)=>{
  assert.match(url,/\/sendPhoto$/);sends++;
  assert.match(options.body.get("caption"),new RegExp(man.name));
  assert.deepEqual(Buffer.from(await options.body.get("photo").arrayBuffer()),jpeg);
  return Response.json({ok:true,result:{message_id:17}});
 };
 try{
  const result=await cabinetEndpoint(callback(),f.env,"secondary_man_signed_result");assert.equal(result.status,200);
  const completed=await result.json();assert.equal(completed.status,"completed");assert.equal(completed.deliveryStatus,"sent");
  assert.equal((await cabinetEndpoint(callback(),f.env,"secondary_man_signed_result")).status,409);
  await deliverSecondaryCompletedResult(client,f.env,identity);assert.equal(sends,1);
 }finally{globalThis.fetch=previousFetch;}
 assert.equal(ledgerCalls.filter(x=>x.type==="credits_reserve").length,1);
 assert.equal(ledgerCalls.filter(x=>x.type==="credits_complete").length,1);
 assert.equal(ledgerCalls.find(x=>x.type==="credits_complete").accountId,man.id);
 const view=await f.event(CLIENT,{kind:"mini_preview"});
 assert.equal(view.secondaryStatuses[PROFILE][man.id].rating,"published");
 assert.equal(view.history.find(x=>x.account===man.id).hasProof,true);
 assert.equal(view.finance.events.find(x=>x.type==="spend").accountId,man.id);
 assert.equal(view.profiles[0].daily.remaining,1);
 assert.equal(view.profiles[0].capabilities.rating.account,"yan_first");
 assert.notEqual(view.profiles[0].capabilities.rating.state,"published");
 assert.equal((await f.event(CLIENT,{kind:"mini_proof",account:man.id,profileId:PROFILE,publicationKind:"rating"})).originalJpegBase64,jpeg.toString("base64"));
 await assert.rejects(()=>secondaryCompletedProof(f.stores.get("987654321"),f.env,{...identity,userId:"987654321"}),/proof/);
 const oldVersion=await owner.get("man-proxy-sealed-v1:"+man.id);
 await owner.put("man-proxy-sealed-v1:"+man.id,{...oldVersion,version:oldVersion.version+1});
 assert.equal((await f.event(OWNER_ID,{kind:"admin_man_registration_status",actorId:OWNER_ID,accountId:man.id})).connection.ready,false);
 const bad=await f.event(CLIENT,{kind:"admin_man_registration_status",actorId:OWNER_ID,accountId:man.id});assert.equal(bad.status,403);
 assert.equal(await client.get("man-proxy-sealed-v1:yan_first"),undefined);
});
