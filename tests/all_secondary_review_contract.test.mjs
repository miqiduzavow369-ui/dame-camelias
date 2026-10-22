// Full offline review contract. Telegram, GitHub and site operations are intercepted.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {Memory,seed,fixture,savePrivateProfile,CLIENT,PROFILE,OWNER_ID} from "./helpers/secondary_registration_fixture.mjs";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {OrderReminder} from "../src/reminders.js";
import {manStorageKey} from "../src/man_account_isolation.js";
import {secondaryReviewNoticeKey,ensureSecondaryReviewGroupNotice,handleSecondaryReviewGroupCallback,handleSecondaryReviewCorrection} from "../src/secondary_review_moderation_notice.js";
import {cabinetEndpoint,cabinetEvent} from "../src/cabinet_runtime.js";
import {recordSecondaryReviewSubmitBoundary} from "../src/secondary_man_review_runner_grant.js";
import {signSecondaryResultAttestation} from "../src/secondary_man_callback_attestation.js";
import {deliverSecondaryCompletedResult} from "../src/secondary_man_result_delivery.js";
import {MODERATION_CHAT,MODERATOR_ID} from "../src/review_moderation.js";
const TEXT="Мой личный опыт посещения: встреча прошла хорошо.";
const CORRECTED="Исправленный администратором текст личного отзыва, сохранённый в истории.";
function setup(){
 const f=fixture(),objects=new Map(),originalGet=f.env.ORDER_REMINDERS.get,calls=[],messages=[],dispatches=[];
 f.env.BOT_TOKEN="synthetic-bot";
 f.env.ORDER_REMINDERS.get=name=>{
  if(!name.startsWith("publication-credits:")&&!name.startsWith("daily-profile:")&&name!=="review-moderation-index:v1")return originalGet(name);
  return {fetch:async(url,options)=>{
   if(!objects.has(name)){
    const storage=new Memory();
    if(name.startsWith("publication-credits:"))await storage.put("credits_v1",{grant:10,spent:0,claims:{},history:[]});
    objects.set(name,new OrderReminder({storage,blockConcurrencyWhile:fn=>fn()},f.env));
   }
   calls.push(JSON.parse(options.body));return objects.get(name).fetch(new Request(url,options));
  }};
 };
 const before=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(url.includes("api.github.com/")){dispatches.push(JSON.parse(options.body));return new Response(null,{status:204});}
  assert.match(url,/^https:\/\/api.telegram.org\/botsynthetic-bot\//);
  const method=url.split("/").at(-1),body=options.body instanceof FormData?options.body:JSON.parse(options.body);
  messages.push({method,body});return Response.json({ok:true,result:{message_id:100+messages.length}});
 };
 return {...f,calls,messages,dispatches,restore:()=>globalThis.fetch=before};
}
function decision(man,action,version=1,messageId=101){return {kind:"admin_secondary_review_group_decision",actorId:OWNER_ID,accountId:man.id,profileId:PROFILE,draftVersion:version,messageId,action};}
for(const man of MAN_ACCOUNTS.slice(1))test(man.id+": review moderation, correction/cancellation, own grant, JPEG, debit, group and cabinet",async()=>{
 const f=setup(),client=f.stores.get(CLIENT),i={userId:CLIENT,accountId:man.id,profileId:PROFILE,kind:"review"};
 try{
  await seed(f.stores.get(OWNER_ID),man.id);await savePrivateProfile(client,CLIENT);
  const save=()=>f.event(CLIENT,{kind:"mini_secondary_draft",accountId:man.id,profileId:PROFILE,draftKind:"review",action:"save",text:TEXT,authorAttested:true});
  assert.equal((await save()).ok,true);
  const card=f.messages.find(x=>x.method==="sendMessage");
  assert.deepEqual(card.body.reply_markup.inline_keyboard.map(x=>x[0].text),["✅ Опубликовать","✏️ Скорректировать","❌ Отклонить"]);
  assert.ok(card.body.reply_markup.inline_keyboard.every(x=>Buffer.byteLength(x[0].callback_data)<=64));
  assert.match(card.body.text,new RegExp(man.name));
  assert.equal(f.dispatches.length,0);assert.equal(f.calls.filter(x=>x.type==="credits_reserve").length,0);
  // No duplicate notices on polling, no client edits while a moderator decides.
  assert.equal((await save()).ok,false);
  await f.event(CLIENT,{kind:"mini_review_action",accountId:man.id,profileId:PROFILE,action:"status"});
  assert.equal(f.messages.filter(x=>x.method==="sendMessage").length,1);
  assert.equal((await f.event(CLIENT,{...decision(man,"approve"),actorId:"999999"})).status,403);
  assert.equal((await f.event(CLIENT,decision(man,"cancel"))).ok,true);
  assert.equal((await f.event(CLIENT,{kind:"mini_review_action",accountId:man.id,profileId:PROFILE,action:"status"})).stage,"rejected");
  assert.equal((await f.event(CLIENT,{kind:"mini_preview"})).secondaryStatuses[PROFILE][man.id].review,"rejected");
  assert.equal((await f.event(CLIENT,decision(man,"approve"))).ok,false);
  assert.equal(f.dispatches.length,0);assert.equal(f.calls.filter(x=>x.type==="credits_reserve").length,0);
  // A new explicitly attested review is a new version; old buttons stay invalid.
  assert.equal((await save()).ok,true);
  const notice=await client.get(secondaryReviewNoticeKey(i)),mid=notice.messageId;
  assert.equal((await f.event(CLIENT,decision(man,"approve"))).ok,false);
  assert.equal((await f.event(CLIENT,decision(man,"edit",2,mid))).ok,true);
  const editing=await client.get(secondaryReviewNoticeKey(i));
  assert.ok(Number.isSafeInteger(editing.promptId));
  assert.equal(f.dispatches.length,0);
  // Reply routing uses the same durable index as primary moderation, without
  // technical routing strings in a user-facing prompt or touching primary state.
  const rpc=(env,uid,event)=>cabinetEvent(f.stores.get(uid),env,{userId:uid,event});
  const corrected=await handleSecondaryReviewCorrection({message:{message_id:999,chat:{id:MODERATION_CHAT},from:{id:MODERATOR_ID},reply_to_message:{message_id:editing.promptId},text:CORRECTED}},f.env,rpc);
  assert.equal(corrected,true);assert.equal(f.dispatches.length,1);
  const pub=await client.get(manStorageKey({...i,scope:"publication"})+":review"),identity=pub.identity;
  assert.equal(pub.moderatorApproved,true);assert.equal(pub.independentAuthorConfirmed,true);
  const draft=await client.get(manStorageKey({...i,scope:"review-draft"})+":review");
  assert.equal(draft.text,CORRECTED);assert.equal(draft.originalText,TEXT);assert.equal(draft.revisions.length,1);assert.equal(draft.authorAttested,true);
  assert.equal((await f.event(CLIENT,decision(man,"approve",2,mid))).ok,false);
  assert.equal((await f.event(CLIENT,{...decision(man,"replace",2,mid),promptId:editing.promptId,text:CORRECTED})).ok,false);
  const inputs=f.dispatches[0].inputs;assert.equal(inputs.account_id,man.id);assert.equal(inputs.site_host,"c.intimcity.rip");
  const query=new URLSearchParams({account_id:man.id,user_id:CLIENT,profile_id:PROFILE,nonce:identity.nonce,callback_ticket:inputs.callback_ticket});
  const payload=()=>new Request("https://audit.invalid/api/secondary-man/review-payload?"+query,{headers:{Authorization:"Bearer synthetic"}});
  const res=await cabinetEndpoint(payload(),f.env,"secondary_man_review_runner_payload");assert.equal(res.status,200);
  const grant=await res.json();assert.equal(grant.proxyHost,man.id+".proxy.example.test");assert.equal(grant.proxyPassword,"synthetic-proxy-"+man.id);
  assert.equal(grant.siteLogin,man.id+"@example.test");assert.equal(grant.sitePassword,"synthetic-site-"+man.id);assert.equal(grant.approvedText,CORRECTED);
  assert.equal(grant.verifiedSiteLogin,grant.siteLogin);assert.notEqual(grant.resultSigningKey,f.env.SECONDARY_CALLBACK_HMAC_KEY);
  assert.equal((await cabinetEndpoint(payload(),f.env,"secondary_man_review_runner_payload")).status,409);
  await recordSecondaryReviewSubmitBoundary(client,{identity,token:inputs.callback_ticket,approvedTextSha256:grant.approvedTextSha256,at:Date.now()});
  await assert.rejects(()=>recordSecondaryReviewSubmitBoundary(client,{identity,token:inputs.callback_ticket,approvedTextSha256:grant.approvedTextSha256,at:Date.now()}));
  const jpeg=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100),Buffer.from([255,217])]);
  const input={identity,proxyVersion:2,siteVersion:3,issuedAt:Date.now(),status:"verified_published",sitePublicationId:"proof_"+man.id,proofFileId:"jpeg_"+createHash("sha256").update(jpeg).digest("hex").slice(0,40)};
  const body={identity,token:inputs.callback_ticket,input,signature:await signSecondaryResultAttestation(grant.resultSigningKey,input),originalJpegBase64:jpeg.toString("base64")};
  const callback=()=>new Request("https://audit.invalid/api/secondary-man/result",{method:"POST",headers:{Authorization:"Bearer synthetic"},body:JSON.stringify(body)});
  const response=await cabinetEndpoint(callback(),f.env,"secondary_man_signed_result");assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.status,"completed");assert.equal(result.deliveryStatus,"sent");
  assert.equal((await cabinetEndpoint(callback(),f.env,"secondary_man_signed_result")).status,409);
  await deliverSecondaryCompletedResult(client,f.env,identity);
  const photos=f.messages.filter(x=>x.method==="sendPhoto");assert.equal(photos.length,1);
  assert.equal(JSON.parse(photos[0].body.get("reply_parameters")).message_id,mid);
  assert.deepEqual(Buffer.from(await photos[0].body.get("photo").arrayBuffer()),jpeg);
  assert.match(photos[0].body.get("caption"),/1–10/);
  assert.equal(f.calls.filter(x=>x.type==="credits_complete").length,1);assert.equal(f.calls.filter(x=>x.type==="credits_reserve").length,1);
  assert.equal(f.dispatches.length,1);assert.equal((await client.get(secondaryReviewNoticeKey(i))).status,"published");
  const view=await f.event(CLIENT,{kind:"mini_preview"});assert.equal(view.secondaryStatuses[PROFILE][man.id].review,"published");
  assert.equal(view.history.find(x=>x.account===man.id).hasProof,true);assert.equal(view.finance.events.find(x=>x.type==="spend").accountId,man.id);
  assert.notEqual(view.profiles[0].capabilities.review.state,"published");
  assert.equal((await f.event(CLIENT,{kind:"mini_review_action",accountId:man.id,profileId:PROFILE,action:"status"})).stage,"published");
  assert.equal((await f.event(CLIENT,{kind:"mini_proof",account:man.id,profileId:PROFILE,publicationKind:"review"})).originalJpegBase64,jpeg.toString("base64"));
  assert.equal(await client.get("man-proxy-sealed-v1:yan_first"),undefined);
 }finally{f.restore();}
});
test("old one-button card is edited in place without duplicate, publication or credit reservation",async()=>{
 const f=setup(),client=f.stores.get(CLIENT),i={userId:CLIENT,accountId:"yan_second",profileId:PROFILE,kind:"review"};
 try{
  await client.put(manStorageKey({...i,scope:"review-draft"})+":review",{...i,text:TEXT,version:1,authorAttested:true});
  await client.put(secondaryReviewNoticeKey(i),{status:"delivered",version:1,messageId:57});
  const request=()=>new Request("https://audit.invalid/api/secondary-man/review-notice-refresh",{method:"POST",headers:{Authorization:"Bearer synthetic"},body:JSON.stringify({user_id:CLIENT,accountId:i.accountId,profileId:PROFILE})});
  const response=await cabinetEndpoint(request(),f.env,"secondary_review_notice_refresh");assert.equal(response.status,200);
  assert.equal((await response.json()).messageId,57);
  const edits=f.messages.filter(x=>x.method==="editMessageText");assert.equal(edits.length,1);assert.equal(edits[0].body.reply_markup.inline_keyboard.length,3);
  await cabinetEndpoint(request(),f.env,"secondary_review_notice_refresh");assert.equal(f.messages.length,1);
  assert.equal(f.dispatches.length,0);assert.equal(f.calls.filter(x=>x.type==="credits_reserve").length,0);
  assert.equal((await client.get(manStorageKey({...i,scope:"review-draft"})+":review")).text,TEXT);
  const missing=await ensureSecondaryReviewGroupNotice(f.stores.get(OWNER_ID),f.env,{...i,userId:OWNER_ID},{existingOnly:true});assert.equal(missing.ok,false);
 }finally{f.restore();}
});

for(const mode of ["own-owner-approve","stale-owner-connection","ambiguous-dispatch"])test(mode+": live decision safeguards and repeat fencing",async()=>{
 const f=setup(),uid=mode==="own-owner-approve"?OWNER_ID:CLIENT,store=f.stores.get(uid),man=MAN_ACCOUNTS[1];
 try{
  await seed(f.stores.get(OWNER_ID),man.id);await savePrivateProfile(store,uid);
  await f.event(uid,{kind:"mini_secondary_draft",accountId:man.id,profileId:PROFILE,draftKind:"review",action:"save",text:TEXT,authorAttested:true});
  if(mode==="stale-owner-connection"){
   const owner=f.stores.get(OWNER_ID),row=await owner.get("man-proxy-sealed-v1:"+man.id);
   await owner.put("man-proxy-sealed-v1:"+man.id,{...row,version:row.version+1});
  }
  let attempts=0,previousFetch=globalThis.fetch;
  if(mode==="ambiguous-dispatch")globalThis.fetch=async(url,options)=>{if(url.includes("api.github.com/")){attempts++;throw Error("timeout after possible dispatch");}return previousFetch(url,options);};
  const callback={callback_query:{id:"synthetic",data:"srmod:approve:"+uid+":"+man.id+":"+PROFILE+":1",from:{id:OWNER_ID},message:{message_id:101,chat:{id:MODERATION_CHAT}}}};
  const rpc=(env,userId,event)=>cabinetEvent(f.stores.get(userId),env,{userId,event});
  assert.equal(await handleSecondaryReviewGroupCallback(callback,f.env,rpc),true);
  const i={userId:uid,accountId:man.id,profileId:PROFILE,kind:"review"},notice=await store.get(secondaryReviewNoticeKey(i));
  if(mode==="own-owner-approve")assert.equal(notice.status,"approved");
  if(mode==="stale-owner-connection"){
   assert.equal(notice.status,"delivered");assert.equal(f.dispatches.length,0);assert.equal(f.calls.filter(x=>x.type==="credits_reserve").length,0);
  }else{
   await handleSecondaryReviewGroupCallback(callback,f.env,rpc);
   if(mode==="ambiguous-dispatch"){
    assert.equal(attempts,1);assert.equal(notice.status,"uncertain");
    assert.equal((await f.event(uid,{kind:"mini_review_action",accountId:man.id,profileId:PROFILE,action:"status"})).stage,"unknown");
   }else assert.equal(f.dispatches.length,1);
   assert.equal((await f.event(uid,decision(man,"cancel"))).ok,false);
   assert.equal(f.calls.filter(x=>x.type==="credits_reserve").length,1);
  }
 }finally{f.restore();}
});
