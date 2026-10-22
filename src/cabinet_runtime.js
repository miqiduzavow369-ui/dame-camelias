import {agreementStatus,agreementLabel} from "./agreement.js";
import {LOADING_EMOJI_KEY,selectedLoadingEmoji} from "./loading_emoji.js";
import {validWebApp} from "./telegram_auth.js";
import {createCabinet} from "./owner_anketa.js";
import {registry,OWNER_ID,TRIAL_ID,validId,pinRecord} from "./client_registry.js";
import {credits,adjustCredits,creditHistory} from "./publication_credits.js";
import {readPublicationArchive,accountLabel,displayArchiveDate} from "./publication_archive.js";
import {dailyLimit} from "./daily_publication_limit.js";
import {ownerManRegistry} from "./man_admin_registry.js";
import {MAN_ACCOUNTS} from "./man_accounts.js";
import {clientMenAvailability,secondaryCabinetAvailability} from "./man_client_parity.js";
import {manVisibility,changeManVisibility,clientManVisibilityMap} from "./man_client_visibility.js";
import {readSecondaryManApproval,setSecondaryManApproval,approvalMatchesConfiguration} from "./secondary_man_owner_approval.js";
import {readManSetupDrafts,changeManSetupDraft,readManSetupHistory} from "./man_setup_store.js";
import {proxyStatus,saveProxy} from "./man_proxy_vault.js";
import {browserCheckStatus,startBrowserCheck,claimBrowserCheck,completeBrowserCheck} from "./man_browser_preflight.js";
import {siteLoginStatus,startSiteLoginCheck,claimSiteLoginCheck,completeSiteLoginCheck,restoreVerifiedSiteIdentity} from "./man_site_login_preflight.js";
import {profileProbeStatus,startProfileProbe,claimProfileProbe,completeProfileProbe} from "./secondary_man_profile_probe.js";
import {recordTicketedSecondaryResult,secondaryVerifiedResultStatus} from "./secondary_man_result_settlement.js";
import {verifySecondaryResultAttestation} from "./secondary_man_callback_attestation.js";
import {saveSecondaryOriginalJpeg} from "./secondary_man_original_screenshot.js";
import {readSecondaryOperationDiagnostics} from "./secondary_man_operation_diagnostics.js";
import {manStorageKey,requirePublicationIdentity} from "./man_account_isolation.js";
import {verifyManProxy} from "./man_proxy_verification.js";
import {checkManSiteThroughProxy} from "./man_proxy_site_check.js";
import {privateDraftStatus,savePrivateDraft,importPrivateDrafts} from "./man_private_drafts.js";
import {readSiteStatus,saveSiteCredentials,saveSiteCredentialDraft,updateSiteDomain} from "./man_site_vault.js";
import {readManDiagnostics,prepareManRetry} from "./man_check_diagnostics.js";
import {secondaryDraftAction} from "./secondary_man_client_draft.js";
import {saveSharedCriteria,readSharedCriteria} from "./shared_rating_criteria.js";
import {openSecondaryRatingForm,saveSecondaryRatingForm} from "./secondary_man_rating_form.js";
import {secondaryPublicationOperationalStatus} from "./secondary_man_publication_status.js";
import {claimSecondaryReviewRunnerPayload,recordSecondaryReviewSubmitBoundary} from "./secondary_man_review_runner_grant.js";
import {claimSecondaryRatingRunnerPayload,recordSecondaryRatingSubmitBoundary,claimSecondaryRatingProofRecovery} from "./secondary_man_review_runner_grant.js";
import {launchApprovedSecondaryRating,preflightSecondaryRating} from "./secondary_man_rating_launch.js";
import {secondaryRatingDryfillStatus,startSecondaryRatingDryfill,claimSecondaryRatingDryfill,completeSecondaryRatingDryfill,requireFreshSecondaryRatingDryfill} from "./secondary_man_rating_dryfill.js";
import {approveSecondaryReviewForSubmission,launchApprovedSecondaryReview} from "./secondary_man_review_launch.js";
import {ensureSecondaryReviewGroupNotice,verifySecondaryReviewGroupDecision} from "./secondary_review_moderation_notice.js";
import {settleSecondaryVerifiedResult} from "./secondary_man_result_settlement.js";
import {readSecondaryConnection,installSecondaryConnection} from "./secondary_man_connection.js";
import {deliverSecondaryCompletedResult,secondaryCompletedProof} from "./secondary_man_result_delivery.js";
import {reconcileUnstartedSecondaryReservations} from "./secondary_man_credit_bridge.js";
// ADMIN's verified connection is the same connection used by client operations.
// A connection is never, by itself, permission to submit a rating or review.
async function secondaryRatingCabinetConnected(storage,accountId,rawEnv){
 if(accountId==="yan_first"||!MAN_ACCOUNTS.some(m=>m.id===accountId))return false;
 return (await readSecondaryConnection(storage,rawEnv,accountId,OWNER_ID)).connection.ready;
}

async function autoStartSecondaryCatalogLookup(storage,rawEnv,event){
  const userId=String(event.userId||""),profileId=String(event.profileId||"");
  const accountId=String(event.accountId||"");
  if(!/^\d{5,16}$/.test(userId)||!/^\d{1,9}$/.test(profileId)||
     accountId==="yan_first"||!MAN_ACCOUNTS.some(m=>m.id===accountId))
    return {ok:false,status:400,reason:"invalid_catalog_request"};
  try{
   // The client coordinator attests ownership after opening its private
   // saved profile; never look for another client's private record in shared KV.
   if(event.profileOwned!==true)return {ok:false,status:403,reason:"profile_not_saved"};
   if(await readSharedCriteria(rawEnv.VISITORS_KV,profileId))
    return {ok:true,stage:"available"};
   if(!await secondaryRatingCabinetConnected(storage,accountId,rawEnv))
    return {ok:false,status:409,reason:"secondary_cabinet_unverified"};
   const key="secondary-auto-rating-lookup-v1:"+profileId,now=Date.now();
   const reserved=await storage.transaction(async tx=>{
    const prev=await tx.get(key);
    if(prev?.expiresAt>now)return false;
    await tx.put(key,{accountId,profileId,expiresAt:now+8*60*1000});
    return true;
   });
   if(!reserved)return {ok:true,stage:"loading"};
   const params={actorId:OWNER_ID,cabinetId:OWNER_ID,ownerId:OWNER_ID,accountId};
   const [proxy,site,login]=await Promise.all([
    proxyStatus(storage,params),readSiteStatus(storage,params),siteLoginStatus(storage,params)
   ]);
   const dispatched=await startProfileProbe(storage,{accountId,profileId,at:now,
    proxy,site,login,catalogReadOnly:true,
    dispatch:async ({accountId,profileId,nonce,siteHost})=>{
     if(!rawEnv.DC_ACTIONS_TOKEN||!rawEnv.ANKETA_CALLBACK_TOKEN||!rawEnv.ANKETA_CALLBACK_URL)
      return {ok:false};
     const response=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/secondary-man-profile-probe.yml/dispatches",{
      method:"POST",headers:{"Authorization":"Bearer "+rawEnv.DC_ACTIONS_TOKEN,
       "Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
       "Content-Type":"application/json","User-Agent":"dame-camelias-worker"},
      body:JSON.stringify({ref:"main",inputs:{account_id:accountId,profile_id:profileId,nonce,site_host:siteHost}}),
      signal:AbortSignal.timeout(15000)
     });
     return {ok:response.status===204};
    }});
   if(dispatched.ok!==true){
    await storage.delete(key);
    return {ok:false,status:409,reason:"catalog_lookup_unavailable"};
   }
   return {ok:true,stage:"loading"};
  }catch{
   // Retry can be attempted; no secondary publication action is possible here.
   await storage.delete("secondary-auto-rating-lookup-v1:"+profileId).catch(()=>{});
   return {ok:false,status:409,reason:"catalog_lookup_unavailable"};
  }
}

async function isSecondaryCabinetReady(storage,rawEnv,uid,accountId){
 if(uid===OWNER_ID)return secondaryRatingCabinetConnected(storage,accountId,rawEnv);
 const check=await cabinetRPC(rawEnv,OWNER_ID,{kind:"secondary_catalog_cabinet_ready",accountId});
 return check?.ok===true&&check.ready===true;
}
export const settlementKey=x=>[x.ledger,x.userId,x.profileId,x.kind,x.nonce,x.date||""].join(":");
const nonce=()=>crypto.randomUUID().replace(/-/g,"").slice(0,16);
export function privateActor(update){
 const actor=update.callback_query?.from||update.message?.from;
 const chat=update.callback_query?.message?.chat||update.message?.chat;
 return actor&&!actor.is_bot&&validId(actor.id)&&String(actor.id)===String(chat?.id)&&chat?.type==="private"?String(actor.id):null;
}
export async function cabinetRPC(env,userId,event){
 const obj=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("cabinet-events:v1:"+userId));
 const res=await obj.fetch("https://cabinet.internal/",{method:"POST",body:JSON.stringify({type:"cabinet_event",userId,event})});
 if(!res.ok)throw Error("Cabinet coordinator unavailable");return res.json();
}
export async function handleCabinet(update,env){
 const uid=privateActor(update),action=String(update.callback_query?.data||"");
 if(!uid){
  if(/^(owner_anketa|trial_cabinet|clients):/.test(action))return true;
  return false;
 }
 const {handled,home}=await cabinetRPC(env,uid,{kind:"update",update});
 return home?"home":handled;
}
export async function cabinetEndpoint(request,env,kind){
 // Authenticate before selecting a user-specific coordinator.
 let body=null,uid;
 if(Number(request.headers.get("content-length")||0)>1200000)return new Response("Too large",{status:413});
 if(kind==="ratings"){
  // Telegram signature is verified again inside the engine. Parse only for routing.
  body=await request.clone().json().catch(()=>null);
  if(!await validWebApp(body?.initData,env.BOT_TOKEN,3600))return new Response("Forbidden",{status:403});
  try{uid=String(JSON.parse(new URLSearchParams(body?.initData).get("user"))?.id||"");}catch{}
 }else{
  if(!env.ANKETA_CALLBACK_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)return new Response("Forbidden",{status:403,headers:{"X-DC-Callback-Handler":"token_rejected","Cache-Control":"no-store"}});
  body=request.method==="POST"?await request.clone().json().catch(()=>null):null;
  uid=String(body?.user_id||(kind==="secondary_man_signed_result"||kind==="secondary_man_result_delivery"||kind==="secondary_man_rating_dryfill_result"||kind==="secondary_man_rating_submit_boundary"||kind==="secondary_man_review_submit_boundary"?body?.identity?.userId:null)||new URL(request.url).searchParams.get("user_id")||OWNER_ID);
 }
 if(!validId(uid))return new Response("Invalid user",{status:400});
 const result=await cabinetRPC(env,uid,{kind,url:request.url,method:request.method,headers:{Authorization:request.headers.get("Authorization")||""},body:request.method==="POST"?await request.text():null});
 return new Response(result.body,{status:result.status,headers:result.headers});
}
async function telegram(env,method,data){
 const response=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...data,protect_content:String(data.chat_id)!==OWNER_ID}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(!response.ok||!result.ok){const error=Error("Telegram delivery failed");error.telegramCode=result.error_code||response.status;throw error;}return result.result;
}
// Private storage is authoritative in the per-user DO. Legacy owner keys are
// lazily imported and mirrored for rollback; absence/expiry is also persisted.
function privateStorage(storage,kv,uid){
 const isPrivate=key=>key.startsWith("cabinet_v3:"+uid+":")||(!key.startsWith("owner_anketa_publication_v1:")&&(key.includes(":"+uid)||uid===OWNER_ID&&/^(owner_anketa_(review_|proof_archive)|owner_cabinet_)/.test(key)));
 return {
  async get(key,format){
   if(!isPrivate(key))return kv.get(key,format);
   const cacheKey="private:"+key;let entry=await storage.get(cacheKey);
   if(entry===undefined){
    const value=await kv.get(key);
    const transient=/owner_cabinet_(pending|failed):|owner_anketa_(state|selected_account|navigation|progress|client_flow|chat_ids):/.test(key);
    entry={value,expires:transient?Date.now()+900000:0};await storage.put(cacheKey,entry);
   }
   const value=entry.expires&&entry.expires<=Date.now()?null:entry.value;
   return format==="json"&&value!==null?JSON.parse(value):value;
  },
  async put(key,value,options={}){
   if(!isPrivate(key))return kv.put(key,value,options);
   await storage.put("private:"+key,{value,expires:options.expirationTtl?Date.now()+options.expirationTtl*1000:0});
   if(uid===OWNER_ID)await kv.put(key,value,options);
  },
  async delete(key){
   if(!isPrivate(key))return kv.delete(key);
   await storage.put("private:"+key,{value:null,expires:0});
   if(uid===OWNER_ID)await kv.delete(key);
  }
 };
}
async function migrateTrial(storage,env){
 if(await storage.get("trial_imported"))return;
 const rawList=await env.VISITORS_KV.get("trial_cabinet_v1:"+TRIAL_ID+":profiles","json");
 const list=Array.isArray(rawList)?rawList:[];
 const urls={};
 for(const p of list){
  if(!/^\d{1,9}$/.test(String(p.id))||typeof p.url!=="string")continue;
  urls[p.id]=p.url;
  const verified=await env.VISITORS_KV.get("cabinet_v2:"+TRIAL_ID+":saved:"+p.id,"json");
  if(verified?.url===p.url&&verified.verifiedAt&&verified.id===p.id&&typeof verified.name==="string"&&verified.name.trim()&&verified.name.length<=100&&Number.isInteger(verified.age)&&verified.age>=18&&verified.age<=99&&typeof verified.metro==="string"&&verified.metro.length<=100&&/^https:\/\/[a-z0-9-]+\.intimcity\.rip\/indi\/anketa\d{1,9}\.htm$/.test(p.url)){
   await env.VISITORS_KV.put("owner_anketa_saved:"+TRIAL_ID+":"+p.id,JSON.stringify({profile:verified,host:new URL(p.url).hostname,confirmed:true,updatedAt:verified.verifiedAt}));
  }
 }
 const ids=await env.VISITORS_KV.get("owner_anketa_library:"+TRIAL_ID,"json")||[];
 await env.VISITORS_KV.put("owner_anketa_library:"+TRIAL_ID,JSON.stringify([...new Set([...ids,...Object.keys(urls)])]));
 await storage.put("legacy_urls",urls);
 await storage.put("trial_imported",true);
}
async function clearAdminMedia(storage,env,send){
 const messages=await storage.get("admin_archive_media")||[];
 for(const id of messages)if(Number.isSafeInteger(id))await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:id}).catch(()=>{});
 await storage.delete("admin_archive_media");
}
async function clearAdminNavigation(storage,env,send){
 await clearAdminMedia(storage,env,send);
 const previous=await storage.get("admin_navigation");
 if(Number.isSafeInteger(previous))await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:previous}).catch(()=>{});
 await storage.delete("admin_navigation");
}
async function admin(update,env,storage,send){
 const uid=privateActor(update),action=String(update.callback_query?.data||""),text=String(update.message?.text||"").trim();
 if(uid!==OWNER_ID)return action.startsWith("clients:");
 const pending=await storage.get("admin_pending");
 if((pending||await storage.get("admin_navigation"))&&(text.startsWith("/")||action&&!action.startsWith("clients:"))){await storage.delete("admin_pending");await clearAdminNavigation(storage,env,send);return false;}
 if(!action.startsWith("clients:")&&!pending)return false;
 await clearAdminMedia(storage,env,send);
 const html=value=>String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
 const archive=async userId=>{
  const result=await cabinetRPC(env,userId,{kind:"admin_archive",actorId:OWNER_ID});
  if(result.status!==200)throw Error("Archive unavailable");return result.archive;
 };
 const say=async(value,rows=[],backAction="clients:menu",photo=null)=>{
  const previous=await storage.get("admin_navigation");
  const backLabel=backAction==="clients:list"?"⬅️ К клиенткам":String(backAction).startsWith("clients:view:")?"⬅️ К карточке клиентки":String(backAction).startsWith("clients:pubprofile:")?"⬅️ К аккаунтам":String(backAction).startsWith("clients:pubday:")?"⬅️ К анкетам":String(backAction).startsWith("clients:pubs:")?"⬅️ К датам":"⬅️ Администратор";
  const text="🌹 <b>DAME CAMELIAS</b>\n\n"+value;
  const common={chat_id:uid,parse_mode:"HTML",reply_markup:{inline_keyboard:[...rows,...(backAction?[[{text:backLabel,callback_data:backAction}]]:[]),[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]]}};
  let sent;
  if(photo){try{sent=await send(env,"sendPhoto",{...common,photo,caption:text});}catch{}}
  if(!sent)sent=await send(env,"sendMessage",{...common,text});
  if(Number.isSafeInteger(sent?.message_id)){
   await storage.put("admin_navigation",sent.message_id);
   if(Number.isSafeInteger(previous)&&previous!==sent.message_id)await send(env,"deleteMessage",{chat_id:uid,message_id:previous}).catch(()=>{});
  }
  return sent;
 };
 if(update.callback_query)await send(env,"answerCallbackQuery",{callback_query_id:update.callback_query.id});
 if(action==="clients:cancel"||action.startsWith("owner_anketa:")){await storage.delete("admin_pending");await clearAdminNavigation(storage,env,send);return action==="clients:cancel"?"cabinet":false;}
 if(action==="clients:menu"){
  await storage.delete("admin_pending");
  await say("👑 <b>АДМИНИСТРАТОР</b>\n\n💕 Добавьте клиентку или откройте управление её доступом и балансом.",[
    [{text:"➕ Добавить ID клиентки",callback_data:"clients:add"}],
    [{text:"👥 Клиентки",callback_data:"clients:list"}]
  ],false);return true;
 }
 if(action==="clients:add"){
  await storage.put("admin_pending",{mode:"id",expires:Date.now()+600000});await say("➕ <b>НОВАЯ КЛИЕНТКА</b>\n\n🆔 Пришлите Telegram ID клиентки одним сообщением.\n\n💕 Затем назначим код доступа и начальный баланс.");return true;
 }
 if(action==="clients:list"){
  await storage.delete("admin_pending");const result=await registry(env,{action:"list",actorId:uid});
  await say("👥 <b>КЛИЕНТКИ</b>\n\n"+(result.clients.length?"💕 Выберите аккаунт, чтобы управлять доступом и балансом.":"🌷 Пока ни одной клиентки не добавлено. Вернитесь в административное меню, чтобы добавить первую."),result.clients.map(c=>[{text:(c.active?"🟢 ":"🔒 ")+"ID "+c.id,callback_data:"clients:view:"+c.id}]));return true;
 }
 const dates=/^clients:pubs:(\d{5,16})(?::(\d{1,5}))?$/.exec(action);
 const date=/^clients:pubday:(\d{5,16}):(\d{8})(?::(\d{1,5}))?$/.exec(action);
 const profile=/^clients:pubprofile:(\d{5,16}):(\d{8}):(\d{1,9})$/.exec(action);
 const account=/^clients:p:(\d{5,16}):(\d{8}):(\d{1,9}):([a-z][a-z0-9_]{0,11}):(\d{1,5})$/.exec(action);
 const legacy=/^clients:pubacct:(\d{5,16}):(\d{8}):[a-z][a-z0-9_]{0,11}:\d{1,5}$/.exec(action);
 const history=dates||date||profile||account||legacy;
 if(history){
  await storage.delete("admin_pending");
  const target=history[1],backToClient="clients:view:"+target;
  const {client:c}=await registry(env,{action:"get",userId:target});
  if(!c){await say("🌷 <b>АККАУНТ НЕ НАЙДЕН</b>\n\nОткройте список клиенток и выберите нужный аккаунт.",[],"clients:list");return true;}
  let saved;
  try{saved=await archive(target);}catch{await say("🌷 <b>АРХИВ ВРЕМЕННО НЕДОСТУПЕН</b>\n\nПопробуйте открыть публикации позже.",[],backToClient);return true;}
  if(dates){
   const days=[...new Set(saved.items.map(x=>x.date))].sort().reverse();
   const page=Math.min(Number(dates[2]||0),Math.max(0,Math.ceil(days.length/12)-1));
   const rows=days.slice(page*12,page*12+12).map(day=>[{text:"📅 "+displayArchiveDate(day),callback_data:"clients:pubday:"+target+":"+day}]);
   const pages=[];
   if(page>0)pages.push({text:"⬅️ Новее",callback_data:"clients:pubs:"+target+":"+(page-1)});
   if((page+1)*12<days.length)pages.push({text:"Ранее ➡️",callback_data:"clients:pubs:"+target+":"+(page+1)});
   if(pages.length)rows.push(pages);
   await say("📚 <b>ПУБЛИКАЦИИ</b>\n\n🆔 Клиентка: "+target+"\n\n"+(days.length?"💕 Выберите дату публикации.":"🌷 Подтверждённых публикаций пока нет."),rows,backToClient);return true;
  }
  const day=history[2],items=saved.items.filter(x=>x.date===day),backToDates="clients:pubs:"+target;
  if(date||legacy){
   const ids=[...new Set(items.map(x=>x.profileId))].sort((a,b)=>Number(a)-Number(b));
   const page=Math.min(Number(date?.[3]||0),Math.max(0,Math.ceil(ids.length/12)-1));
   const rows=ids.slice(page*12,page*12+12).map(id=>[{text:"🌹 Анкета №"+id,callback_data:"clients:pubprofile:"+target+":"+day+":"+id}]);
   const pages=[];
   if(page>0)pages.push({text:"⬅️ Предыдущие",callback_data:"clients:pubday:"+target+":"+day+":"+(page-1)});
   if((page+1)*12<ids.length)pages.push({text:"Следующие ➡️",callback_data:"clients:pubday:"+target+":"+day+":"+(page+1)});
   if(pages.length)rows.push(pages);
   await say("📅 <b>"+displayArchiveDate(day)+"</b>\n\n🆔 Клиентка: "+target+"\n\n"+(ids.length?"💕 Выберите анкету, с которой выполнены публикации.":"🌷 За эту дату подтверждённых публикаций нет."),rows,backToDates);return true;
  }
  const id=history[3],profileItems=items.filter(x=>x.profileId===id),backToProfiles="clients:pubday:"+target+":"+day;
  if(profile){
   const accounts=[...new Set(profileItems.map(x=>x.account))].sort();
   await say("🌹 <b>АНКЕТА №"+id+"</b>\n\n📅 "+displayArchiveDate(day)+"\n🆔 Клиентка: "+target+"\n\n"+(accounts.length?"💕 Выберите аккаунт, с которого выполнены публикации.":"🌷 Для этой анкеты за выбранную дату публикаций нет."),accounts.map(name=>[{text:"👨‍💻 "+accountLabel(name),callback_data:"clients:p:"+target+":"+day+":"+id+":"+name+":0"}]),backToProfiles);return true;
  }
  const name=account[4],receipts=profileItems.filter(x=>x.account===name&&x.fileId);
  const page=Math.min(Number(account[5]),Math.max(0,Math.ceil(receipts.length/8)-1));
  const batch=receipts.slice(page*8,page*8+8),backToAccounts="clients:pubprofile:"+target+":"+day+":"+id;
  const media=batch.map(x=>({type:"photo",media:x.fileId,caption:(x.kind==="rating"?"⭐ <b>ПОДТВЕРЖДЕНИЕ ОЦЕНКИ</b>":"✍️ <b>ПОДТВЕРЖДЕНИЕ ОТЗЫВА</b>")+"\n\n👨‍💻 "+html(accountLabel(name))+"\n🌹 Анкета №"+x.profileId+"\n📅 "+displayArchiveDate(day),parse_mode:"HTML"}));
  let failed=false;
  if(media.length){
   try{
    const delivered=media.length===1?[await send(env,"sendPhoto",{chat_id:uid,photo:media[0].media,caption:media[0].caption,parse_mode:"HTML"})]:await send(env,"sendMediaGroup",{chat_id:uid,media});
    const ids=Array.isArray(delivered)?delivered.map(x=>x.message_id).filter(Number.isSafeInteger):[];
    if(ids.length!==media.length)throw Error("Archive media delivery failed");
    await storage.put("admin_archive_media",ids);
   }catch{failed=true;}
  }
  const rows=[],pages=[];
  if(page>0)pages.push({text:"⬅️ Предыдущие",callback_data:"clients:p:"+target+":"+day+":"+id+":"+name+":"+(page-1)});
  if((page+1)*8<receipts.length)pages.push({text:"Следующие ➡️",callback_data:"clients:p:"+target+":"+day+":"+id+":"+name+":"+(page+1)});
  if(pages.length)rows.push(pages);
  await say("📚 <b>ПОДТВЕРЖДЕНИЯ ПУБЛИКАЦИЙ</b>\n\n🌹 Анкета №"+id+"\n📅 "+displayArchiveDate(day)+"\n👨‍💻 "+html(accountLabel(name))+"\n🆔 Клиентка: "+target+"\n\n"+(failed?"🌷 Не удалось открыть сохранённые скриншоты. Попробуйте позже.":batch.length?"💕 Сохранённые подтверждения показаны выше.":"🌷 Сохранённых скриншотов для этого аккаунта и даты нет."),rows,backToAccounts);return true;
 }
 const view=/^clients:view:(\d{5,16})$/.exec(action);
 if(view){
  await storage.delete("admin_pending");const {client:c}=await registry(env,{action:"get",userId:view[1]});
  if(!c){await say("🌷 <b>АККАУНТ НЕ НАЙДЕН</b>\n\nОткройте список клиенток и выберите нужный аккаунт.",[],"clients:list");return true;}
  const b=await credits(env,c.id,"status");
  let firstPhoto=null;
  try{firstPhoto=(await archive(c.id)).firstProfile?.cardUrl||null;}catch{}
  const agreement=agreementLabel(await agreementStatus(env,c.id));
  await say("👤 <b>КАРТОЧКА КЛИЕНТКИ</b>\n\n🆔 Telegram ID: "+c.id+"\n"+(c.active?"🟢 Доступ открыт":"🔒 Доступ приостановлен")+"\n"+agreement+"\n\n💎 Доступно публикаций: <b>"+b.available+"</b>\n✅ Использовано: "+b.spent+"\n⏳ В резерве: "+b.reserved+"\n\n💕 Выберите действие:",[
    [{text:"📚 Публикации",callback_data:"clients:pubs:"+c.id}],
    [{text:c.active?"⏸ Приостановить доступ":"▶️ Восстановить доступ",callback_data:"clients:"+(c.active?"suspend:":"resume:")+c.id}],
    [{text:"💎 Пополнить баланс",callback_data:"clients:topup:"+c.id}],
    [{text:"⚖️ Изменить остаток",callback_data:"clients:balance:"+c.id}],
    [{text:"🔑 Изменить код доступа",callback_data:"clients:pin:"+c.id}]
  ],"clients:list",firstPhoto);return true;
 }
 const select=/^clients:(suspend|resume|topup|pin|balance):(\d{5,16})$/.exec(action);
 if(select){
  const mode=select[1];
  await storage.put("admin_pending",{mode,userId:select[2],operation:nonce(),expires:Date.now()+600000});
  const prompts={balance:"⚖️ <b>ИЗМЕНИТЬ ОСТАТОК</b>\n\n💎 Какой доступный остаток установить?\n💕 История использованных публикаций сохранится.",topup:"💎 <b>ПОПОЛНЕНИЕ БАЛАНСА</b>\n\n💕 Сколько публикаций добавить клиентке? Пришлите целое число.",pin:"🔑 <b>НОВЫЙ КОД ДОСТУПА</b>\n\n💕 Назначьте код из 6–12 цифр. После смены потребуется повторный вход.",suspend:"⏸ <b>ПРИОСТАНОВИТЬ ДОСТУП</b>\n\n🌷 Кабинет будет закрыт до восстановления доступа. Анкеты, баланс и история сохранятся.",resume:"▶️ <b>ВОССТАНОВИТЬ ДОСТУП</b>\n\n💕 Клиентка снова сможет войти со своим кодом доступа."};
  await say(prompts[mode],mode==="suspend"||mode==="resume"?[[{text:"✅ Подтвердить",callback_data:"clients:confirm:"+(await storage.get("admin_pending")).operation}]]:[],"clients:view:"+select[2]);return true;
 }
 if(!pending||pending.expires<Date.now()){await storage.delete("admin_pending");await say("⏳ <b>ВРЕМЯ ДЕЙСТВИЯ ИСТЕКЛО</b>\n\n🌷 Вернитесь в административное меню и начните заново.");return true;}
 if(action.startsWith("clients:confirm:")){
  if(action!=="clients:confirm:"+pending.operation)return true;
  if(!["create","suspend","resume","pin","topup","balance"].includes(pending.mode)||!pending.ready&&!["suspend","resume"].includes(pending.mode))return true;
  const result=pending.mode==="balance"?await adjustCredits(env,pending.userId,pending.target,pending.expected,pending.operation,uid):await registry(env,{action:pending.mode,actorId:uid,...pending});
  const errors={exists:"Этот аккаунт уже добавлен. Откройте его в списке клиенток.",missing:"Аккаунт не найден. Проверьте список клиенток.",balance_changed:"Баланс уже изменился. Откройте карточку клиентки и повторите действие."};
  await storage.delete("admin_pending");await say(result.ok?"✅ <b>ИЗМЕНЕНИЯ СОХРАНЕНЫ</b>\n\n💕 Данные клиентки обновлены.":"🌷 <b>НЕ УДАЛОСЬ СОХРАНИТЬ</b>\n\n"+(errors[result.reason]||"Попробуйте начать действие заново."),[],result.ok?"clients:view:"+pending.userId:"clients:menu");return true;
 }
 if(!update.message?.text)return true;
 if(update.message.message_id)await send(env,"deleteMessage",{chat_id:uid,message_id:update.message.message_id}).catch(()=>{});
 if(pending.mode==="id"){
  if(!validId(text)||text===OWNER_ID){await say("🆔 <b>ПРОВЕРЬТЕ TELEGRAM ID</b>\n\n🌷 Пришлите числовой ID клиентки. ID администратора здесь использовать нельзя.");return true;}
  await storage.put("admin_pending",{...pending,userId:text,mode:"create_pin"});await say("🔑 <b>КОД ДОСТУПА</b>\n\n🆔 Клиентка: "+text+"\n"+agreementLabel(await agreementStatus(env,text))+"\n\n💕 Назначьте индивидуальный код из 6–12 цифр.");return true;
 }
 if(pending.mode==="create_pin"||pending.mode==="pin"){
  if(!/^\d{6,12}$/.test(text)){await say("🔑 <b>ПРОВЕРЬТЕ КОД ДОСТУПА</b>\n\n🌷 Код должен содержать от 6 до 12 цифр. Пришлите его ещё раз.");return true;}
  if(pending.mode==="pin"){
   await storage.put("admin_pending",{...pending,credential:await pinRecord(text),ready:true});
   await say("🔑 <b>ПОДТВЕРЖДЕНИЕ НОВОГО КОДА</b>\n\n🆔 Клиентка: "+pending.userId+"\n\n💕 Сохранить новый код доступа?",[[{text:"✅ Сохранить код",callback_data:"clients:confirm:"+pending.operation}]],"clients:view:"+pending.userId);return true;
  }
  await storage.put("admin_pending",{...pending,credential:await pinRecord(text),mode:"create_grant"});await say("💎 <b>НАЧАЛЬНЫЙ БАЛАНС</b>\n\n💕 Сколько публикаций назначить клиентке?\n\nПришлите целое число. Можно указать 0 и пополнить баланс позже.");return true;
 }
 if(pending.mode==="balance"){
  if(!/^\d{1,7}$/.test(text)||Number(text)>1000000){await say("💎 <b>ПРОВЕРЬТЕ КОЛИЧЕСТВО</b>\n\n🌷 Пришлите целое число от 0 до 1 000 000.");return true;}
  const balance=await credits(env,pending.userId,"status");
  await storage.put("admin_pending",{...pending,target:Number(text),expected:balance.available,ready:true});
  await say("⚖️ <b>ПОДТВЕРЖДЕНИЕ ОСТАТКА</b>\n\n🆔 Клиентка: "+pending.userId+"\n💎 Сейчас доступно: "+balance.available+"\n✨ Новый остаток: <b>"+text+"</b>\n\n💕 Сохранить изменение?",[[{text:"✅ Сохранить остаток",callback_data:"clients:confirm:"+pending.operation}]],"clients:view:"+pending.userId);return true;
 }
 if(pending.mode==="create_grant"||pending.mode==="topup"){
  if(!/^\d{1,7}$/.test(text)||Number(text)>1000000||pending.mode==="topup"&&Number(text)<1){await say("💎 <b>ПРОВЕРЬТЕ КОЛИЧЕСТВО</b>\n\n🌷 Пришлите целое число "+(pending.mode==="topup"?"от 1":"от 0")+" до 1 000 000.");return true;}
  const next={...pending,mode:pending.mode==="topup"?"topup":"create",operation:pending.operation||nonce(),ready:true,...(pending.mode==="topup"?{amount:Number(text)}:{grant:Number(text)})};
  await storage.put("admin_pending",next);await say((next.mode==="create"?"➕ <b>НОВАЯ КЛИЕНТКА</b>":"💎 <b>ПОПОЛНЕНИЕ БАЛАНСА</b>")+"\n\n🆔 Telegram ID: "+pending.userId+"\n💎 "+(next.mode==="create"?"Начальный баланс":"Добавить публикаций")+": <b>"+text+"</b>"+(next.mode==="create"?"\n"+agreementLabel(await agreementStatus(env,pending.userId)):"")+"\n\n💕 Всё верно? Подтвердите сохранение.",[[{text:next.mode==="create"?"✅ Добавить клиентку":"✅ Пополнить баланс",callback_data:"clients:confirm:"+next.operation}]],next.mode==="create"?"clients:menu":"clients:view:"+pending.userId);return true;
 }
 return true;
}
export async function cabinetEvent(storage,rawEnv,input,send=telegram,verifyTelegram){
 const uid=String(input.userId);if(!validId(uid))throw Error("Invalid cabinet identity");
 const env={...rawEnv,VISITORS_KV:privateStorage(storage,rawEnv.VISITORS_KV,uid)};
 env.__enqueueLedger=async entry=>{
  const queue=await storage.get("ledger_outbox")||{};queue[settlementKey(entry)]=entry;
  await storage.put("ledger_outbox",queue);await storage.setAlarm(Date.now()+60000);
 };
 env.__settleLedger=async entry=>{
  const queue=await storage.get("ledger_outbox")||{};delete queue[settlementKey(entry)];await storage.put("ledger_outbox",queue);
 };
 const event=input.event;
 if(event.kind==="admin_man_check_status"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await readManDiagnostics(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId});}
   catch{return {ok:false,status:400,reason:"diagnostic_unavailable"};}
 }
 if(event.kind==="admin_man_check_retry"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await prepareManRetry(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
      accountId:event.accountId,expectedVersion:event.expectedVersion,at:Date.now()});}
   catch{return {ok:false,status:409,reason:"retry_preparation_rejected"};}
 }
 if(event.kind==="admin_man_site_login_status"){
  if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
  try{return await siteLoginStatus(storage,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId});}
  catch{return {ok:false,status:400,reason:"invalid_account"};}
 }
 if(event.kind==="admin_man_site_login_start"){
  if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
  try{return await startSiteLoginCheck(storage,rawEnv,{
    actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId,
    expectedVersion:event.expectedVersion,retry:event.retry===true,at:Date.now()
  },async ({accountId,nonce,siteHost})=>{
    if(!rawEnv.DC_ACTIONS_TOKEN)return {ok:false,reason:"github_token_missing"};
    if(!rawEnv.ANKETA_CALLBACK_TOKEN)return {ok:false,reason:"callback_token_missing"};
    if(!rawEnv.ANKETA_CALLBACK_URL)return {ok:false,reason:"callback_url_missing"};
    const response=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/man-site-login-preflight.yml/dispatches",{
      method:"POST",
      headers:{"Authorization":"Bearer "+rawEnv.DC_ACTIONS_TOKEN,
       "Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
       "Content-Type":"application/json","User-Agent":"dame-camelias-worker"},
      body:JSON.stringify({ref:"main",inputs:{account_id:accountId,nonce,site_host:siteHost}}),
      signal:AbortSignal.timeout(15000)
    });
    return response.status===204?{ok:true}:{ok:false,reason:({
      401:"github_unauthorized",403:"github_forbidden",404:"workflow_not_found",
      422:"github_validation_failed",429:"github_rate_limited"
    })[response.status]||"github_dispatch_rejected"};
  });}
  catch(e){const reason=String(e.message);
    return {ok:false,status:409,reason:reason==="Already running"?"already_running":
      reason==="Prerequisites not verified"?"prerequisites_missing":"site_login_start_rejected"};}
 }
 if(event.kind==="man_site_login_payload"||event.kind==="man_site_login_result"){
  if(uid!==OWNER_ID)return {status:403,body:"Forbidden"};
  try{
    const src=event.kind==="man_site_login_payload"?new URL(event.url).searchParams:JSON.parse(event.body||"null");
    const accountId=String(src?.get?src.get("account_id")||"":src?.account_id||"");
    const nonce=String(src?.get?src.get("nonce")||"":src?.nonce||"");
    const params={accountId,nonce,at:Date.now()};
    const result=event.kind==="man_site_login_payload"?
      await claimSiteLoginCheck(storage,rawEnv,params):
      await completeSiteLoginCheck(storage,{...params,code:src?.code,failureStage:src?.failure_stage},rawEnv);
    return {status:200,body:JSON.stringify(result),
      headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{return {status:409,body:JSON.stringify({ok:false,reason:"invalid_or_stale_check"}),
      headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="admin_man_site_status"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await readSiteStatus(storage,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId});}
   catch{return {ok:false,status:400,reason:"invalid_account"};}
 }
 if(event.kind==="admin_man_site_domain_update"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await updateSiteDomain(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
    accountId:event.accountId,expectedVersion:event.expectedVersion,at:Date.now()});}
   catch{return {ok:false,status:409,reason:"site_domain_update_rejected"};}
 }
 if(event.kind==="admin_man_site_stage"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await saveSiteCredentialDraft(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
      accountId:event.accountId,expectedVersion:event.expectedVersion,settings:event.settings,at:Date.now()});}
   catch(e){const message=String(e.message);return {ok:false,status:409,
      reason:message==="Site vault key not configured"?"site_vault_key_missing":
       message==="Configured proxy required"?"proxy_not_configured":"site_stage_rejected"};}
 }
 if(event.kind==="admin_man_site_save"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await saveSiteCredentials(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
     accountId:event.accountId,expectedVersion:event.expectedVersion,settings:event.settings,at:Date.now()});}
   catch(e){const message=String(e.message);return {ok:false,status:409,
     reason:message==="Site vault key not configured"?"site_vault_key_missing":
      message==="Verified proxy required"?"proxy_not_verified":"site_save_rejected"};}
 }
 if(event.kind==="admin_man_private_status"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await privateDraftStatus(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId});}
   catch{return {ok:false,status:400,reason:"private_draft_unavailable"};}
 }
 if(event.kind==="admin_man_private_save"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await savePrivateDraft(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
      accountId:event.accountId,settings:event.settings,expectedVersion:event.expectedVersion,at:Date.now()});}
   catch{return {ok:false,status:409,reason:"private_draft_save_rejected"};}
 }
 if(event.kind==="admin_man_private_import"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await importPrivateDrafts(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
     rows:event.rows,at:Date.now()});}
   catch{return {ok:false,status:409,reason:"private_draft_import_rejected"};}
 }
 if(event.kind==="admin_man_site_reachability"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await checkManSiteThroughProxy(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
     accountId:event.accountId,expectedVersion:event.expectedVersion,siteUrl:event.siteUrl});}
   catch(e){return {ok:false,status:409,reason:e.message==="Version conflict"?"version_conflict":"site_check_unavailable"};}
 }
 if(event.kind==="admin_man_proxy_verify"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await verifyManProxy(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
      accountId:event.accountId,expectedVersion:event.expectedVersion,at:Date.now()});}
   catch(e){return {ok:false,status:409,reason:String(e.message)==="Version conflict"?"version_conflict":"proxy_check_unavailable"};}
 }
 if(event.kind==="admin_man_browser_status"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await browserCheckStatus(storage,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId});}
   catch{return {ok:false,status:400,reason:"browser_status_unavailable"};}
 }
 if(event.kind==="admin_man_browser_start"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{
    return await startBrowserCheck(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
      accountId:event.accountId,expectedVersion:event.expectedVersion,
      siteUrl:event.siteUrl,retry:event.retry===true,at:Date.now()},async ({accountId,nonce,host})=>{
      if(!rawEnv.DC_ACTIONS_TOKEN)return {ok:false,reason:"github_token_missing"};
      if(!rawEnv.ANKETA_CALLBACK_TOKEN)return {ok:false,reason:"callback_token_missing"};
      if(!rawEnv.ANKETA_CALLBACK_URL)return {ok:false,reason:"callback_url_missing"};
      const response=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/man-browser-preflight.yml/dispatches",{
       method:"POST",
       headers:{"Authorization":"Bearer "+rawEnv.DC_ACTIONS_TOKEN,"Accept":"application/vnd.github+json",
        "X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json","User-Agent":"dame-camelias-worker"},
       body:JSON.stringify({ref:"main",
        inputs:{account_id:accountId,nonce,site_host:host}}),
       signal:AbortSignal.timeout(15000)
      });
      return response.status===204?{ok:true}:{ok:false,reason:({
       401:"github_unauthorized",403:"github_forbidden",404:"workflow_not_found",
       422:"github_validation_failed",429:"github_rate_limited"
      })[response.status]||"github_dispatch_rejected"};
    });
   }catch(e){return {ok:false,status:409,reason:e.message==="Already running"?"already_running":"browser_start_rejected"};}
 }
 // GitHub Actions callback endpoints use existing server-verified bearer authentication.
 if(event.kind==="man_browser_payload"||event.kind==="man_browser_result"){
   if(uid!==OWNER_ID)return {status:403,body:"Forbidden"};
   try{
    const source=event.kind==="man_browser_payload"?new URL(event.url).searchParams:JSON.parse(event.body||"null");
    const accountId=String(source?.get?source.get("account_id")||"":source?.account_id||"");
    const nonce=String(source?.get?source.get("nonce")||"":source?.nonce||"");
    const params={accountId,nonce,at:Date.now()};
    const result=event.kind==="man_browser_payload"?
      await claimBrowserCheck(storage,rawEnv,params):
      await completeBrowserCheck(storage,{...params,code:source?.code,
       observedIp:source?.observed_ip,siteReachable:source?.site_reachable===true});
    return {status:200,body:JSON.stringify(result),headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
   }catch{return {status:409,body:JSON.stringify({ok:false,reason:"invalid_or_stale_check"}),
     headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="admin_man_proxy_status"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await proxyStatus(storage,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId});}
   catch{return {ok:false,status:400,reason:"invalid_account"};}
 }
 if(event.kind==="admin_man_proxy_save"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await saveProxy(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
     accountId:event.accountId,expectedVersion:event.expectedVersion,settings:event.settings,at:Date.now()});}
   catch(e){return {ok:false,status:409,reason:String(e.message)==="Proxy vault key not configured"?"vault_key_missing":"proxy_save_rejected"};}
 }
 if(event.kind==="secondary_publication_account_snapshot"||
    event.kind==="secondary_publication_account_version_check"){
  // Internal Durable Object RPC only; never exposed by an HTTP action.
  if(uid!==OWNER_ID)return {ok:false,status:403};
  try{
   const accountId=String(event.accountId||"");
   if(accountId==="yan_first"||!MAN_ACCOUNTS.some(m=>m.id===accountId))
    throw Error("Invalid secondary account");
   // Restore the record only if the SAME verified login already completed
   // for this exact account, proxy and site versions. No browser posting.
   await restoreVerifiedSiteIdentity(storage,rawEnv,accountId,OWNER_ID).catch(()=>null);
   // A previously authenticated technical login can have no verified identity.
   // Re-run the EXISTING personal Chromium login probe, never the rating submit.
   // Owner-side only; no client credentials, draft changes, or credit mutations.
   if(event.kind==="secondary_publication_account_snapshot"){
    const verified=await storage.get("secondary-site-identity-v1:"+accountId);
    const site=await storage.get("man-intimcity-sealed-v1:"+accountId);
    const proxy=await storage.get("man-proxy-sealed-v1:"+accountId);
    const matched=verified?.accountId===accountId&&
     verified.proxyVersion===proxy?.version&&
     verified.siteVersion===site?.version&&verified.siteAccountId;
    if(!matched&&site&&proxy&&rawEnv.DC_ACTIONS_TOKEN&&
       rawEnv.ANKETA_CALLBACK_TOKEN&&rawEnv.ANKETA_CALLBACK_URL){
     const stamp="secondary-identity-recheck-v1:"+accountId;
     const now=Date.now(),prev=await storage.get(stamp);
     if(!prev||prev.siteVersion!==site.version||
        prev.proxyVersion!==proxy.version||now-prev.at>15*60*1000){
      const params={actorId:OWNER_ID,cabinetId:OWNER_ID,ownerId:OWNER_ID,
       accountId,expectedVersion:site.version,at:now};
      try{
       await startSiteLoginCheck(storage,rawEnv,params,
        async ({accountId,nonce,siteHost})=>{
         const response=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/man-site-login-preflight.yml/dispatches",{
          method:"POST",headers:{
           Authorization:"Bearer "+rawEnv.DC_ACTIONS_TOKEN,
           Accept:"application/vnd.github+json",
           "Content-Type":"application/json","User-Agent":"dame-camelias-worker"
          },
          body:JSON.stringify({ref:"main",inputs:{
           account_id:accountId,nonce,site_host:siteHost
          }}),signal:AbortSignal.timeout(15000)
         });
         return {ok:response.status===204,reason:"github_dispatch_rejected"};
        });
       await storage.put(stamp,{at:now,proxyVersion:proxy.version,
        siteVersion:site.version});
      }catch{
       // A running or invalid login check must never authorize publication.
      }
     }
    }
   }
   const {connection,snapshot}=await readSecondaryConnection(storage,rawEnv,accountId,OWNER_ID);
   if(!connection.ready)return {ok:false,reason:"secondary_account_not_ready",blockers:connection.blockers};
   const {proxy,site}=snapshot;
   if(event.kind==="secondary_publication_account_version_check")
    return {ok:event.proxyVersion===proxy.version&&event.siteVersion===site.version};
   return {ok:true,...snapshot};
  }catch{return {ok:false,reason:"secondary_account_not_ready"};}
 }
 if(event.kind==="secondary_catalog_cabinet_ready"){
  if(uid!==OWNER_ID)return {ok:false,status:403};
  const ready=await secondaryRatingCabinetConnected(storage,event.accountId,rawEnv).catch(()=>false);
  return {ok:true,ready};
 }
 if(event.kind==="secondary_catalog_cabinet_list"){
  if(uid!==OWNER_ID)return {ok:false,status:403};
  const all=await Promise.all(MAN_ACCOUNTS.slice(1).map(async man=>
   await secondaryRatingCabinetConnected(storage,man.id,rawEnv).catch(()=>false)?man.id:null));
  return {ok:true,readyIds:all.filter(Boolean)};
 }
 if(event.kind==="secondary_catalog_lookup_start"){
  if(uid!==OWNER_ID)return {ok:false,status:403};
  return autoStartSecondaryCatalogLookup(storage,rawEnv,event);
 }
 if(event.kind==="admin_secondary_profile_probe"){
  if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
  const params={actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId};
  try{
    if(event.action==="status")return profileProbeStatus(storage,event.accountId);
    if(event.action!=="start")return {ok:false,status:400,reason:"invalid_action"};
    const [approval,proxy,site,login]=await Promise.all([
      readSecondaryManApproval(storage,params),proxyStatus(storage,params),
      readSiteStatus(storage,params),siteLoginStatus(storage,params)]);
    return await startProfileProbe(storage,{accountId:event.accountId,profileId:String(event.profileId||""),
      at:Date.now(),approval,proxy,site,login,dispatch:async ({accountId,profileId,nonce,siteHost})=>{
       if(!rawEnv.DC_ACTIONS_TOKEN||!rawEnv.ANKETA_CALLBACK_TOKEN||!rawEnv.ANKETA_CALLBACK_URL)
        return {ok:false};
       const response=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/secondary-man-profile-probe.yml/dispatches",{
        method:"POST",headers:{"Authorization":"Bearer "+rawEnv.DC_ACTIONS_TOKEN,
         "Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
         "Content-Type":"application/json","User-Agent":"dame-camelias-worker"},
        body:JSON.stringify({ref:"main",inputs:{account_id:accountId,profile_id:profileId,nonce,site_host:siteHost}}),
        signal:AbortSignal.timeout(15000)
       });
       return {ok:response.status===204};
      }});
  }catch{return {ok:false,status:409,reason:"profile_probe_rejected"};}
 }
 // The future runner may send its signed completion here using the existing
 // ANKETA_CALLBACK_TOKEN transport authentication, plus a distinct HMAC and
 // previously issued single-use ticket. Never honor callback-supplied
 // moderation/consent fields, nor complete the credit ledger in this route.
 if(event.kind==="secondary_man_rating_dryfill_payload"||
    event.kind==="secondary_man_rating_dryfill_result"){
  try{
   const read=event.kind==="secondary_man_rating_dryfill_payload";
   const source=read?new URL(event.url).searchParams:JSON.parse(event.body||"null");
   const userId=read?source.get("user_id"):source?.identity?.userId;
   const accountId=read?source.get("account_id"):source?.identity?.accountId;
   const profileId=read?source.get("profile_id"):source?.identity?.profileId;
   const nonce=read?source.get("nonce"):source?.nonce;
   if(userId!==uid)throw Error("Wrong client");
   const identity={userId:uid,accountId,profileId,kind:"rating",nonce:"000000000000"};
   if(uid!==OWNER_ID){
    const [proxy,site]=await Promise.all([
     storage.get("man-proxy-sealed-v1:"+accountId),
     storage.get("man-intimcity-sealed-v1:"+accountId)
    ]);
    const approved=await cabinetRPC(rawEnv,OWNER_ID,{
     kind:"secondary_publication_account_version_check",accountId,
     proxyVersion:proxy?.version,siteVersion:site?.version
    });
    if(approved?.ok!==true)throw Error("Owner revoked account");
   }
   const result=read?await claimSecondaryRatingDryfill(storage,rawEnv,{
    identity,nonce,at:Date.now()
   }):await completeSecondaryRatingDryfill(storage,{
    identity,nonce,at:Date.now(),code:source?.code
   });
   return {status:200,body:JSON.stringify(result),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{return {status:409,body:JSON.stringify({ok:false,reason:"secondary_rating_dryfill_unavailable"}),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="secondary_man_rating_runner_payload"||event.kind==="secondary_man_rating_proof_recovery"){
  try{
   const q=new URL(event.url).searchParams;
   const identity={userId:uid,accountId:q.get("account_id"),
    profileId:q.get("profile_id"),kind:"rating",nonce:q.get("nonce")};
   if(q.get("user_id")!==uid)throw Error("Client mismatch");
   if(uid!==OWNER_ID){
    const accountId=String(identity.accountId);
    const [proxy,site]=await Promise.all([
     storage.get("man-proxy-sealed-v1:"+accountId),
     storage.get("man-intimcity-sealed-v1:"+accountId)
    ]);
    const status=await cabinetRPC(rawEnv,OWNER_ID,{
     kind:"secondary_publication_account_version_check",accountId,
     proxyVersion:proxy?.version,siteVersion:site?.version
    });
    if(status?.ok!==true)throw Error("Account owner withdrew or changed approval");
   }
   const claim=event.kind==="secondary_man_rating_proof_recovery"?claimSecondaryRatingProofRecovery:claimSecondaryRatingRunnerPayload;
   const data=await claim(storage,rawEnv,{
    identity,token:q.get("callback_ticket"),at:Date.now()
   });
   return {status:200,body:JSON.stringify(data),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{return {status:409,body:JSON.stringify({ok:false,reason:"rating_runner_grant_unavailable"}),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="secondary_man_rating_submit_boundary"){
  try{
   const b=JSON.parse(event.body||"null"),identity=requirePublicationIdentity(b?.identity);
   if(identity.userId!==uid||identity.kind!=="rating")throw Error("Rating mismatch");
   const result=await recordSecondaryRatingSubmitBoundary(storage,{
    identity,token:b.token,approvedSelectionsSha256:b.approvedSelectionsSha256,at:Date.now()
   });
   return {status:200,body:JSON.stringify(result),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{return {status:409,body:JSON.stringify({ok:false,reason:"rating_submit_boundary_rejected"}),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="secondary_man_review_runner_payload"){
  try{
   const q=new URL(event.url).searchParams;
   const identity={userId:uid,accountId:q.get("account_id"),
    profileId:q.get("profile_id"),kind:"review",nonce:q.get("nonce")};
   if(!q.get("user_id")||q.get("user_id")!==uid)throw Error("User mismatch");
   // Every secondary author uses the same owner-held account configuration.
   // A client's cached encrypted copy is only valid while the owner still
   // approves these exact proxy/site versions.
   if(uid!==OWNER_ID){
    const accountId=String(identity.accountId);
    const [proxy,site]=await Promise.all([
     storage.get("man-proxy-sealed-v1:"+accountId),
     storage.get("man-intimcity-sealed-v1:"+accountId)
    ]);
    const status=await cabinetRPC(rawEnv,OWNER_ID,{
     kind:"secondary_publication_account_version_check",accountId,
     proxyVersion:proxy?.version,siteVersion:site?.version
    });
    if(status?.ok!==true)throw Error("Account owner withdrew or changed approval");
   }
   const payload=await claimSecondaryReviewRunnerPayload(storage,rawEnv,{
    identity,token:q.get("callback_ticket"),at:Date.now()
   });
   return {status:200,body:JSON.stringify(payload),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{return {status:409,body:JSON.stringify({ok:false,reason:"runner_grant_unavailable"}),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="secondary_man_review_submit_boundary"){
  try{
   const b=JSON.parse(event.body||"null");
   const identity=requirePublicationIdentity(b?.identity);
   if(identity.userId!==uid||identity.kind!=="review")throw Error("Invalid review identity");
   const result=await recordSecondaryReviewSubmitBoundary(storage,{
    identity,token:b.token,approvedTextSha256:b.approvedTextSha256,at:Date.now()
   });
   return {status:200,body:JSON.stringify(result),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{return {status:409,body:JSON.stringify({ok:false,reason:"submit_boundary_rejected"}),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="secondary_man_result_delivery"){
  try{
   const body=JSON.parse(event.body||"null"),identity=requirePublicationIdentity(body?.identity);
   if(identity.userId!==uid||identity.accountId==="yan_first")throw Error("Wrong result identity");
   const result=await deliverSecondaryCompletedResult(storage,rawEnv,identity);
   const snapshot=await cabinetEvent(storage,rawEnv,{userId:uid,event:{kind:"mini_preview"}},send);
   result.cabinetStatus=snapshot.secondaryStatuses?.[identity.profileId]?.[identity.accountId]?.[identity.kind]||"unknown";
   result.historyOriginal=snapshot.history?.some(x=>x.id===identity.profileId&&x.account===identity.accountId&&x.kind===identity.kind&&x.hasProof)===true;
   result.financeAccount=snapshot.finance?.events?.find(x=>x.type==="spend"&&x.profileId===identity.profileId&&x.kind===identity.kind&&x.accountId===identity.accountId)?.accountId||null;
   return {status:200,body:JSON.stringify(result),headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{return {status:409,body:JSON.stringify({ok:false,reason:"completed_result_required"}),headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="secondary_man_signed_result"){
  try{
   if(!rawEnv.SECONDARY_CALLBACK_HMAC_KEY)return {status:503,body:"Receiver not configured"};
   const body=JSON.parse(event.body||"null");
   if(!body||typeof body!=="object"||Array.isArray(body))throw Error("Bad payload");
   const identity=requirePublicationIdentity(body.identity);
   if(identity.accountId==="yan_first"||identity.userId!==uid)
    throw Error("Wrong account or client");
   const publicationKey=manStorageKey({userId:uid,accountId:identity.accountId,
    profileId:identity.profileId,scope:"publication"})+":"+identity.kind;
   const publication=await storage.get(publicationKey);
   // Only trusted server-owned approvals may authorize storing the result.
   // Older prepared attempts without these recorded attestations fail closed.
   if(publication?.independentAuthorConfirmed!==true||
      (identity.kind==="review"&&publication?.moderatorApproved!==true))
    throw Error("Publisher consent or moderation missing");
   // Never mistake screenshot metadata for a real original file.
   // Authenticate the callback, then archive the unmodified image bytes.
   await verifySecondaryResultAttestation(storage,{
    secret:rawEnv.SECONDARY_CALLBACK_HMAC_KEY,input:body.input,
    signature:body.signature,at:Date.now()
   });
   const result=await recordTicketedSecondaryResult(storage,{
    identity,token:body.token,secret:rawEnv.SECONDARY_CALLBACK_HMAC_KEY,
    input:body.input,signature:body.signature,at:Date.now(),
    independentAuthorConfirmed:publication.independentAuthorConfirmed===true,
    moderatorApproved:identity.kind!=="review"||publication.moderatorApproved===true,
    proofKv:rawEnv.VISITORS_KV,originalJpegBase64:body.originalJpegBase64
   });
   // Verified immutable original proof is required by the settlement adapter.
   // Ambiguous financial outcomes remain locked; site submission is never retried.
   if(result?.status==="proof_saved"&&(identity.kind==="review"||identity.kind==="rating")){
    const settled=await settleSecondaryVerifiedResult(storage,rawEnv,{
     original:identity,callback:identity
    });
    if(settled.status==="completed"){
     const delivery=await deliverSecondaryCompletedResult(storage,rawEnv,identity).catch(()=>({status:"pending"}));
     settled.deliveryStatus=delivery.status;
    }
    return {status:200,body:JSON.stringify(settled),
     headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
   }
   return {status:200,body:JSON.stringify(result),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{
   return {status:409,body:JSON.stringify({ok:false,reason:"untrusted_or_duplicate_result"}),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }
 }
 if(event.kind==="secondary_profile_probe_payload"||event.kind==="secondary_profile_probe_result"){
  if(uid!==OWNER_ID)return {status:403,body:"Forbidden"};
  try{
   const src=event.kind==="secondary_profile_probe_payload"?
    new URL(event.url).searchParams:JSON.parse(event.body||"null");
   const accountId=String(src?.get?src.get("account_id")||"":src?.account_id||"");
   const profileId=String(src?.get?src.get("profile_id")||"":src?.profile_id||"");
   const nonce=String(src?.get?src.get("nonce")||"":src?.nonce||"");
   const params={accountId,profileId,nonce,at:Date.now()};
   const result=event.kind==="secondary_profile_probe_payload"?
    await claimProfileProbe(storage,rawEnv,params):
    await completeProfileProbe(storage,{...params,code:src?.code});
   if(event.kind==="secondary_profile_probe_result"){
    // This completion can only occur once, after an account-specific runner
    // claimed a live nonce with matching proxy/site versions and owner approval.
    if(result.verified===true&&Array.isArray(src.catalog)&&src.catalog.length){
     try{
      await saveSharedCriteria(rawEnv.VISITORS_KV,{accountId,profileId,
       siteHost:result.verifiedSiteHost,catalog:src.catalog});
      result.criteriaCached=true;
     }catch{result.criteriaCached=false;}
    }
    delete result.verifiedSiteHost;
   }
   return {status:200,body:JSON.stringify(result),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
  }catch{return {status:409,body:JSON.stringify({ok:false,reason:"invalid_or_stale_profile_probe"}),
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};}
 }
 if(event.kind==="admin_secondary_rating_readiness"){
   // Owner-only read of server-owned per-man configuration. No credentials,
   // callbacks, grants or publications are returned or triggered.
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{
     const {connection}=await readSecondaryConnection(storage,rawEnv,event.accountId,OWNER_ID);
     const configured=!!(rawEnv.DC_ACTIONS_TOKEN&&rawEnv.ANKETA_CALLBACK_TOKEN&&
      rawEnv.SECONDARY_CALLBACK_HMAC_KEY&&rawEnv.MAN_PROXY_ENCRYPTION_KEY&&
      rawEnv.MAN_SITE_ENCRYPTION_KEY&&rawEnv.VISITORS_KV&&rawEnv.ORDER_REMINDERS);
     const blockers=[...connection.blockers,...(configured?[]:["runner_configuration_missing"])];
     return {ok:true,...connection,kind:"rating",ready:blockers.length===0,blockers,
      publicationAttempted:false};
   }catch{return {ok:false,status:409,reason:"secondary_readiness_unavailable"};}
 }
 if(event.kind==="admin_secondary_man_approval"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{
     const params={actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId};
     if(event.action==="status"){
       return {ok:true,...await readSecondaryManApproval(storage,params)};
     }
     if(event.action!=="set")return {ok:false,status:400,reason:"invalid_approval_action"};
     let proxyVersion,siteVersion;
     if(event.approved===false){
       // Revocation must succeed even if proxy/site verification has since failed.
       const previous=await readSecondaryManApproval(storage,params);
       if(previous.version<1)return {ok:false,status:409,reason:"no_approval_to_revoke"};
       proxyVersion=previous.proxyVersion;
       siteVersion=previous.siteVersion;
     }else{
       if(event.approved!==true)return {ok:false,status:400,reason:"invalid_approval_request"};
       const [proxy,site]=await Promise.all([proxyStatus(storage,params),readSiteStatus(storage,params)]);
       if(!proxy.configured||!site.configured||proxy.version<1||site.version<1||
          site.proxyReady!==true||proxy.proxyVerified!==true||proxy.ipVerified!==true)
         return {ok:false,status:409,reason:"proxy_and_site_not_ready"};
       const [login,browser]=await Promise.all([siteLoginStatus(storage,params),browserCheckStatus(storage,params)]);
       if(login.technicalReady!==true||login.siteIdentityVerified!==true||browser.status!=="verified"||
          browser.ipVerified!==true||browser.siteReachable!==true||
          browser.version!==proxy.version)
         return {ok:false,status:409,reason:"technical_checks_incomplete"};
       proxyVersion=proxy.version;
       siteVersion=site.version;
     }
     const result=await setSecondaryManApproval(storage,{...params,
       expectedVersion:event.expectedVersion,approved:event.approved,
       proxyVersion,siteVersion});
     // ADMIN confirms this connection; per-operation checks still guard submission.
     const {connection}=await readSecondaryConnection(storage,rawEnv,event.accountId,OWNER_ID);
     return {ok:true,...result,connectionReady:connection.ready,publicationAvailable:false};
   }catch(e){
     const message=String(e?.message||"");
     return {ok:false,status:/Forbidden|immutable/.test(message)?403:409,reason:
       message==="Approval version conflict"?"version_conflict":"approval_rejected"};
   }
 }
 if(event.kind==="admin_man_visibility"){
  if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
  try{
   if(event.action==="set")return {ok:true,...await changeManVisibility(storage,{
    actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId,
    visible:event.visible,expectedVersion:event.expectedVersion})};
   if(event.action==="status")return {ok:true,...await manVisibility(storage,event.accountId)};
   return {ok:false,status:400,reason:"invalid_action"};
  }catch(e){
   return {ok:false,status:409,reason:String(e?.message)==="Visibility version conflict"?"version_conflict":"visibility_change_rejected"};
  }
 }
 if(event.kind==="admin_man_registry"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   const inventory=ownerManRegistry(event.actorId,uid,OWNER_ID);
   const drafts=await readManSetupDrafts(storage,event.actorId,uid,OWNER_ID,MAN_ACCOUNTS);
   const staged=new Map(drafts.map(x=>[x.id,x.setup]));
   // Status comes only from private server storage. Do not expose credentials.
   // New men's diagnostic flags remain false until a trusted executor verifies them.
   const proxyEntries=await Promise.all(inventory.accounts.map(async x=>{
     if(x.id==="yan_first")return [x.id,null]; // Legacy account is read-only and outside this vault.
     try{
       const status=await proxyStatus(storage,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:x.id});
       return [x.id,{configured:status.configured,proxyVerified:status.proxyVerified,
         ipVerified:status.ipVerified,siteIdentityVerified:status.siteIdentityVerified,
         expectedIp:status.expectedIp,updatedAt:status.updatedAt}];
     }catch{return [x.id,null];}
   }));
   const proxyMap=new Map(proxyEntries);
   const readinessEntries=await Promise.all(inventory.accounts.map(async x=>{
     if(x.id==="yan_first")return [x.id,null];
     try{
       const {connection}=await readSecondaryConnection(storage,rawEnv,x.id,OWNER_ID);
       return [x.id,{...connection,connectionReady:connection.ready}];
     }catch{return [x.id,{technicalReady:false,siteIdentityVerified:false,canPublish:false}];}
   }));
   const approvalEntries=await Promise.all(inventory.accounts.map(async x=>{
     if(x.id==="yan_first")return [x.id,null];
     try{
       const params={actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:x.id};
       const [approval,proxy,site]=await Promise.all([
         readSecondaryManApproval(storage,params),proxyStatus(storage,params),readSiteStatus(storage,params)]);
       return [x.id,{version:approval.version,approved:
         approvalMatchesConfiguration(approval,x.id,proxy.version,site.version),
         recorded:approval.approved===true,publicationAvailable:false}];
     }catch{return [x.id,{version:0,approved:false,recorded:false,publicationAvailable:false}];}
   }));
   // Owner-only: decrypt the existing planning *technicalName* for the
   // catalogue. Do not include the website login, passwords, proxy or IP.
   // The privateDraftStatus function enforces actor/cabinet/owner identity.
   const technicalEntries=await Promise.all(inventory.accounts.map(async x=>{
     try{
       const row=await privateDraftStatus(storage,rawEnv,{
         actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:x.id
       });
       const email=row?.settings?.technicalName;
       return [x.id,typeof email==="string"&&
         /^[^\s@]{1,64}@[^\s@]{1,189}$/.test(email)?email:null];
     }catch{return [x.id,null];}
   }));
   const technicalMap=new Map(technicalEntries);
   const approvalMap=new Map(approvalEntries);
   const visibilityEntries=await Promise.all(MAN_ACCOUNTS.map(async man=>{
     try{return [man.id,await manVisibility(storage,man.id)];}
     catch{return [man.id,{accountId:man.id,visible:false,version:null}];}
   }));
   const visibilityMap=new Map(visibilityEntries);
   const readinessMap=new Map(readinessEntries);
   return {...inventory,accounts:inventory.accounts.map(x=>({
     ...x,technicalName:technicalMap.get(x.id)??null,setup:staged.get(x.id)??null,networkStatus:proxyMap.get(x.id)??null,
     readiness:readinessMap.get(x.id)??null,
     approval:approvalMap.get(x.id)??null,
     visibility:visibilityMap.get(x.id)??{visible:false,version:null},
     connection:x.id==="yan_first"?"legacy_active":(staged.get(x.id)?.stage||"not_configured")
   }))};
 }
 if(event.kind==="admin_man_setup_history"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{
     const items=await readManSetupHistory(storage,event.actorId,uid,OWNER_ID,event.accountId);
     return {ok:true,items};
   }catch{return {ok:false,status:400,reason:"invalid_account"};}
 }
 if(event.kind==="admin_man_setup_draft"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await changeManSetupDraft(storage,{
     actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
     accountId:event.accountId,expectedVersion:event.expectedVersion,
     action:event.setupAction,at:Date.now()
   });}catch{return {ok:false,status:409,reason:"draft_change_rejected"};}
 }
 if(event.kind==="admin_archive"){
  // This event is only constructed by the authenticated owner's private UI.
  // Public cabinet endpoints never accept this event kind from request bodies.
  if(event.actorId!==OWNER_ID)return {status:403,body:"Forbidden"};
  return {status:200,archive:await readPublicationArchive(storage,rawEnv.VISITORS_KV,uid)};
 }
 const client=uid===OWNER_ID?null:(await registry(env,{action:"get",userId:uid})).client;
 const engine=createCabinet(uid);
 env.__enqueueModerationNotice=async(ticket,profileId)=>{const outbox=await storage.get("moderation_outbox")||{};outbox[ticket]={ticket,profileId,userId:uid};await storage.put("moderation_outbox",outbox);await storage.setAlarm(Date.now()+60000);};
 if(event.kind==="review_moderation"){
  if(event.actorId!==OWNER_ID)return {ok:false,status:403};
  if(event.action==="approve"&&(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false"||uid!==OWNER_ID&&(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false")))return {ok:false,note:"Доступ или публикации отключены."};
  env.__cabinetAuthorized=uid;return engine.moderateReview(env,send,event);
 }
 if(event.kind==="mini_add"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  if(!["start","status","confirm"].includes(event.action))return {ok:false,status:400};
  return engine.miniAddProfile({env,action:event.action,url:event.url,nonce:event.nonce});
 }
 if(event.kind==="mini_delete"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  return engine.miniDeleteProfile(env,String(event.profileId||""));
 }
 if(event.kind==="mini_domain_recovery"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  return engine.miniDomainRecovery(env,String(event.profileId||""),event.action,event.url);
 }
 if(event.kind==="mini_secondary_draft"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
  }
  try{
   const profileId=String(event.profileId||"");
   if(!/^\d{1,9}$/.test(profileId))return {ok:false,status:400,reason:"invalid_profile"};
   if((await manVisibility(storage,event.accountId)).visible!==true)
    return {ok:false,status:403,reason:"man_hidden_from_clients"};
   const list=await env.VISITORS_KV.get("owner_anketa_library:"+uid,"json");
   const profileOwned=Array.isArray(list)&&list.some(v=>String(v)===profileId);
   if(["save","load"].includes(event.action)&&!profileOwned)return {ok:false,status:403,reason:"profile_not_saved"};
   const result=await secondaryDraftAction(storage,{
    accountId:event.accountId,profileId,userId:uid,
    kind:event.draftKind,action:event.action,
    text:event.text,ratings:event.ratings,
    profileOwned,authorAttested:event.authorAttested===true
   });
   if(result.ok&&event.draftKind==="review"&&event.action==="save"){
    const delivered=await ensureSecondaryReviewGroupNotice(storage,rawEnv,{
     userId:uid,accountId:event.accountId,profileId,kind:"review"
    });
    return {...result,moderationNotification:delivered.ok?"delivered_or_existing":"delivery_uncertain"};
   }
   return result;
  }catch{return {ok:false,status:409,reason:"secondary_draft_rejected"};}
 }
 if(event.kind==="admin_secondary_review_group_approve"){
  if(uid===OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
  try{
   const accountId=String(event.accountId||""),profileId=String(event.profileId||"");
   const i={userId:uid,accountId,profileId,kind:"review"};
   if(!await verifySecondaryReviewGroupDecision(storage,i,{
    version:event.draftVersion,messageId:event.messageId
   }))return {ok:false,status:409,reason:"outdated_moderation_card"};
   const draft=await storage.get(manStorageKey({
    userId:uid,accountId,profileId,scope:"review-draft"
   })+":review");
   if(draft?.version!==event.draftVersion||draft?.authorAttested!==true)
    return {ok:false,status:409,reason:"review_changed"};
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",new TextEncoder().encode(draft.text))),v=>v.toString(16).padStart(2,"0")).join("");
   return await approveSecondaryReviewForSubmission(storage,{
    identity:{...i,nonce:crypto.randomUUID().replace(/-/g,"").slice(0,12)},
    draftVersion:draft.version,expectedTextSha256:sha,moderatorApproved:true,at:Date.now()
   });
  }catch{return {ok:false,status:409,reason:"review_group_approval_unavailable"};}
 }
 if(event.kind==="admin_secondary_review_preview"||event.kind==="admin_secondary_review_approve"){
  // Constructed only by owner-authenticated admin Mini App API.
  if(event.actorId!==OWNER_ID)return {ok:false,status:403};
  try{
   const accountId=String(event.accountId||""),profileId=String(event.profileId||"");
   if(accountId==="yan_first"||!MAN_ACCOUNTS.some(m=>m.id===accountId)||
      !/^\d{1,9}$/.test(profileId))throw Error("Invalid review target");
   const draftKey=manStorageKey({userId:uid,accountId,profileId,
    scope:"review-draft"})+":review";
   const draft=await storage.get(draftKey);
   if(draft?.userId!==uid||draft.accountId!==accountId||
      draft.profileId!==profileId||draft.authorAttested!==true||
      typeof draft.text!=="string"||draft.text.length<10||draft.text.length>3000)
    throw Error("Review draft not ready");
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",new TextEncoder().encode(draft.text))),b=>b.toString(16).padStart(2,"0")).join("");
   if(event.kind==="admin_secondary_review_preview")
    return {ok:true,accountId,profileId,draftVersion:draft.version,
     approvedTextSha256:hash,text:draft.text,authorAttested:true};
   if(event.confirmExactText!==true||event.draftVersion!==draft.version||
      event.expectedTextSha256!==hash)throw Error("Owner did not confirm exact text");
   const identity={userId:uid,accountId,profileId,kind:"review",
    nonce:crypto.randomUUID().replace(/-/g,"").slice(0,12)};
   return await approveSecondaryReviewForSubmission(storage,{
    identity,draftVersion:draft.version,expectedTextSha256:hash,
    moderatorApproved:true,at:Date.now()
   });
  }catch{return {ok:false,status:409,reason:"review_approval_unavailable"};}
 }
 if(event.kind==="admin_secondary_operation_status"){
  // The actor is the ADMIN owner, while uid is the selected CLIENT's DO.
  // No balance adjustment, proof download, dispatch or publication is possible.
  if(event.actorId!==OWNER_ID)return {ok:false,status:403};
  try{
   return await readSecondaryOperationDiagnostics(storage,{
    userId:uid,accountId:event.accountId,
    profileId:String(event.profileId||""),
    kind:event.publicationKind,nonce:event.nonce
   });
  }catch{return {ok:false,status:400,reason:"operation_status_unavailable"};}
 }
 if(event.kind==="mini_review_action"){
  // Authenticated clients may explicitly confirm their already moderated
  // own author's review. No other action enters the secondary site publisher.
  if(event.accountId!=null&&event.accountId!=="yan_first"){
   if(uid!==OWNER_ID&&(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted"))return {ok:false,status:403};
   if(!["status","publish"].includes(event.action)||
      event.action==="publish"&&(event.confirmed!==true||
        rawEnv.CABINET_PUBLICATIONS_ENABLED==="false"))
    return {ok:false,status:409,reason:"explicit_review_approval_required"};
   try{
    const accountId=String(event.accountId),profileId=String(event.profileId||"");
    if((await manVisibility(storage,accountId)).visible!==true)
     return {ok:false,status:403,reason:"man_hidden_from_clients"};
    const library=await env.VISITORS_KV.get("owner_anketa_library:"+uid,"json");
    if(!Array.isArray(library)||!library.some(p=>String(p?.id??p)===profileId))
     return {ok:false,status:403,reason:"profile_not_saved"};
    const approvalKey=manStorageKey({userId:uid,accountId,profileId,scope:"moderation"})+":review";
    const approval=await storage.get(approvalKey);
    if(event.action==="status"){
     const draft=await storage.get(manStorageKey({
      userId:uid,accountId,profileId,scope:"review-draft"})+":review");
     if(draft?.authorAttested===true&&approval?.approved!==true)
      await ensureSecondaryReviewGroupNotice(storage,rawEnv,{
       userId:uid,accountId,profileId,kind:"review"
      }).catch(()=>null);
     const exactApproval=approval?.draftVersion===draft?.version&&draft?.authorAttested===true&&
      typeof draft.text==="string"&&approval.approvedTextSha256===Array.from(new Uint8Array(
       await crypto.subtle.digest("SHA-256",new TextEncoder().encode(draft.text))),
       b=>b.toString(16).padStart(2,"0")).join("");
     if(!exactApproval||approval?.approved!==true||approval.identity?.userId!==uid||
        approval.identity?.accountId!==accountId||
        approval.identity?.profileId!==profileId)
      return {ok:true,stage:draft?.authorAttested===true?"saved":"draft",
       publicationAvailable:false};
     const published=await secondaryPublicationOperationalStatus(storage,
      approval.identity,{proofKv:rawEnv.VISITORS_KV});
     const stage=published.published===true?"published":
      published.status==="attempted"?"waiting":
      published.status==="uncertain"||published.status==="reconciliation_required"?"unknown":
      published.status==="prepared"?"waiting":"approved";
     return {ok:true,stage,publicationAvailable:stage==="approved",
      accountId,profileId};
    }
    if(approval?.approved!==true||approval.identity?.userId!==uid||
       approval.identity?.accountId!==accountId||approval.identity?.profileId!==profileId)
     throw Error("Moderation missing");
    // Same sealed per-man account synchronization as secondary ratings.
    // Never share one man's plaintext login, proxy or authenticated session
    // with another man. Each client stores only ciphertext bound to accountId.
    if(uid!==OWNER_ID){
     const config=await cabinetRPC(rawEnv,OWNER_ID,{
      kind:"secondary_publication_account_snapshot",accountId});
     if(config?.ok!==true)
      return {ok:false,status:409,reason:"secondary_owner_account_not_ready"};
     await installSecondaryConnection(storage,accountId,config,{publicationKey:
      manStorageKey({userId:uid,accountId,profileId,scope:"publication"})+":review"});
    }
    return await launchApprovedSecondaryReview(storage,rawEnv,{
     identity:approval.identity,ownerConfirmed:true,at:Date.now()
    });
   }catch{return {ok:false,status:409,reason:"secondary_review_dispatch_unavailable"};}
  }
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  if(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false")return {ok:false,reason:"disabled"};
  return engine.miniReviewAction(env,String(event.profileId||""),event.action,event.text);
 }
 if(event.kind==="mini_review_draft"){
  // Legacy publisher is Yan First only. Never route an explicit secondary man into it.
  if(event.accountId!=null&&event.accountId!=="yan_first")return {ok:false,status:409,reason:"secondary_executor_not_connected"};
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  return engine.miniReviewDraft(env,String(event.profileId||""),event.action,event.text);
 }
 if(event.kind==="mini_rating_action"){
  // Legacy publisher is Yan First only. Never route an explicit secondary man into it.
  if(event.accountId!=null&&event.accountId!=="yan_first"){
   // Read-only operation status; publishing still requires a separate grant.
   if(uid!==OWNER_ID&&(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted"))
    return {ok:false,status:403};
   if(!["prepare","publish","status"].includes(event.action))
    return {ok:false,status:400,reason:"invalid_rating_action"};
   let failureStage="preflight";
   try{
    const accountId=String(event.accountId),profileId=String(event.profileId||"");
    if((await manVisibility(storage,accountId)).visible!==true)
     return {ok:false,status:403,reason:"man_hidden_from_clients"};
    const saved=await env.VISITORS_KV.get("owner_anketa_saved:"+uid+":"+profileId,"json");
    if(saved?.confirmed!==true||String(saved.profile?.id)!==profileId)
     return {ok:false,status:403,reason:"profile_not_saved"};
    const base=manStorageKey({userId:uid,accountId,profileId,scope:"publication"})+":rating";
    const row=await storage.get(base);
    const draft=await storage.get(manStorageKey({
     userId:uid,accountId,profileId,scope:"rating-draft"})+":rating");
    // A credit reservation may exist even when dispatch failed before
    // writing a publication record. Never create a second reservation.
    if(!row)await reconcileUnstartedSecondaryReservations(storage,env,{
     userId:uid,accountId,profileId,kind:"rating"
    });
    const claims=typeof storage.list==="function"?
     await storage.list({prefix:manStorageKey({
      userId:uid,accountId,profileId,scope:"operation"})+":rating:"}):new Map();
    const outstanding=[...claims.values()].some(x=>
     x&&["reserving","reserved","settling","reconciliation_required","completed"].includes(x.status));
    if(!row&&outstanding)
     return {ok:false,status:409,reason:"secondary_rating_reconciliation_required"};
    if(event.action==="prepare"){
     if(row)return {ok:false,status:409,reason:"already_published_or_pending"};
     const readySecrets=!!(rawEnv.DC_ACTIONS_TOKEN&&rawEnv.ANKETA_CALLBACK_TOKEN&&
      rawEnv.SECONDARY_CALLBACK_HMAC_KEY&&rawEnv.MAN_PROXY_ENCRYPTION_KEY&&
      rawEnv.MAN_SITE_ENCRYPTION_KEY&&rawEnv.VISITORS_KV&&rawEnv.ORDER_REMINDERS);
     if(!readySecrets)return {ok:false,status:409,reason:"secondary_runner_configuration_missing"};
     if(uid!==OWNER_ID){
      failureStage="owner_preflight";
      const owner=await cabinetRPC(rawEnv,OWNER_ID,{
       kind:"secondary_publication_account_snapshot",accountId});
      if(owner?.ok!==true)return {ok:false,status:409,reason:"secondary_owner_account_not_ready"};
      // Only encrypted, exact-account vault records are copied into this
      // client's Durable Object. Nothing is published or reserved by prepare.
      await installSecondaryConnection(storage,accountId,owner,{publicationKey:base});
     }
     failureStage="rating_validation";
     const candidate={userId:uid,accountId,profileId,kind:"rating",
      nonce:"000000000000"};
     try{await preflightSecondaryRating(storage,env,{identity:candidate});}
     catch(e){
      const reason=String(e?.message||"");
      return {ok:false,status:409,reason:
       reason==="Incomplete rating selections"?"incomplete_ratings":
       reason==="Rating selections changed"?"rating_selections_changed":
       reason==="Invalid stored rating draft"||reason==="Empty rating selection"?
        "not_ready":
       /^(?:rating_attempt_already_claimed|rating_saved_draft_mismatch|rating_saved_profile_mismatch|rating_proxy_not_verified|rating_site_binding_mismatch|rating_owner_approval_stale|rating_site_identity_stale)$/.test(reason)?
        reason:
       "secondary_rating_preflight_failed"};
     }
     // Yan First prepares its actual live website form before the confirm
     // button can appear. Use EXACTLY the same Chromium dryfill inspection,
     // restricted to this man's own sealed credentials and selected client.
     const dryIdentity={userId:uid,accountId,profileId,kind:"rating",
      nonce:"000000000000"};
     try{
      await requireFreshSecondaryRatingDryfill(storage,env,dryIdentity);
      return {ok:true,stage:"ready",publicationAvailable:true};
     }catch{
      const existing=await secondaryRatingDryfillStatus(storage,{identity:dryIdentity});
      if(existing.stage==="preparing"&&Date.now()-Number(existing.startedAt)<600000)
       return {ok:true,stage:"preparing"};
     }
     failureStage="browser_dryfill";
     return await startSecondaryRatingDryfill(storage,env,{
      identity:dryIdentity,at:Date.now(),
      dispatch:async args=>{
       const response=await fetch("https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/secondary-man-rating-dryfill.yml/dispatches",{
        method:"POST",headers:{
         Authorization:"Bearer "+rawEnv.DC_ACTIONS_TOKEN,
         Accept:"application/vnd.github+json",
         "X-GitHub-Api-Version":"2022-11-28",
         "Content-Type":"application/json","User-Agent":"dame-camelias-worker"
        },
        body:JSON.stringify({ref:"main",inputs:{
         account_id:args.accountId,user_id:args.userId,
         profile_id:args.profileId,nonce:args.nonce,site_host:args.siteHost
        }}),signal:AbortSignal.timeout(15000)
       });
       return {accepted:response.status===204};
      }
     });
    }
    if(event.action==="publish"){
     if(event.confirmed!==true||rawEnv.CABINET_PUBLICATIONS_ENABLED==="false")
      return {ok:false,status:409,reason:"explicit_rating_confirmation_required"};
     if(row)return {ok:false,status:409,reason:"already_published_or_pending"};
     const identity={userId:uid,accountId,profileId,kind:"rating",
      nonce:crypto.randomUUID().replace(/-/g,"").slice(0,12)};
     if(uid!==OWNER_ID){
      failureStage="owner_snapshot";
      const config=await cabinetRPC(rawEnv,OWNER_ID,{
       kind:"secondary_publication_account_snapshot",accountId});
      if(config?.ok!==true)throw Error("Owner account setup unavailable");
      // Each client's DO receives encrypted account records, never plaintext.
      // A later grant MUST re-check versions and approval against owner.
      await installSecondaryConnection(storage,accountId,config,{publicationKey:base});
     }
     try{
      await requireFreshSecondaryRatingDryfill(storage,env,{
       userId:uid,accountId,profileId,kind:"rating",nonce:"000000000000"
      });
     }catch{return {ok:false,status:409,reason:"secondary_site_check_not_verified"};}
     failureStage="launch";
     const launched=await launchApprovedSecondaryRating(storage,env,{
      identity,at:Date.now()
     });
     return launched.ok?{ok:true,stage:"publishing",nonce:identity.nonce}:
      {ok:false,status:409,reason:launched.status};
    }
    if(!row){
     const i={userId:uid,accountId,profileId,kind:"rating",nonce:"000000000000"};
     const browser=await secondaryRatingDryfillStatus(storage,{identity:i});
     if(browser.stage==="ready"){
      try{
       await requireFreshSecondaryRatingDryfill(storage,env,i);
       return {ok:true,stage:"ready"};
      }catch{return {ok:true,stage:"failed"};}
     }
     return {ok:true,stage:browser.stage};
    }
    const s=await secondaryPublicationOperationalStatus(storage,row.identity,{
     proofKv:rawEnv.VISITORS_KV
    });
    return {ok:true,stage:s.published?"published":
     s.requiresManualReconciliation?"unknown":
     row.status==="attempted"?"checking":
     row.status==="prepared"?"preparing":"unknown",
     nonce:row.identity.nonce};
   }catch(e){
    console.error("Secondary rating action failed",{
     action:event.action,stage:failureStage,errorType:e?.constructor?.name,
     // NEVER log proxy, site credentials, selected ratings or full error text.
     userScope:"per_client"
    });
    // Distinguish a failed pre-reservation validation from an ambiguous
    // reservation/dispatch. Never clear claims or initiate a retry here.
    if(failureStage==="launch"){
     try{
      const operationPrefix=manStorageKey({
       userId:uid,accountId:String(event.accountId),
       profileId:String(event.profileId||""),scope:"operation"})+":rating:";
      const publicationKey=manStorageKey({
       userId:uid,accountId:String(event.accountId),
       profileId:String(event.profileId||""),scope:"publication"})+":rating";
      const operationClaims=typeof storage.list==="function"?
       await storage.list({prefix:operationPrefix}):null;
      const publication=await storage.get(publicationKey);
      const held=operationClaims&&[...operationClaims.values()].some(x=>
       ["reserving","reserved","settling","reconciliation_required","completed"].includes(x?.status));
      if(operationClaims&&!held&&!publication)
       return {ok:false,status:409,reason:String(e?.message)==="rating_credit_empty"?"credits":
        "secondary_rating_preflight_failed"};
     }catch{
      // Failed reconciliation check: retain the conservative result.
     }
    }
    // Any credit claim or publication record may represent an external side
    // effect. Do not advise retry without a separate verified reconciliation.
    return {ok:false,status:409,reason:
     failureStage==="launch"?"secondary_rating_reconciliation_required":
     failureStage==="owner_snapshot"||failureStage==="owner_preflight"?
      "secondary_owner_account_not_ready":"secondary_rating_preflight_failed"};
   }

   if(!/^[a-f0-9]{12}$/.test(String(event.nonce||"")))
    return {ok:false,status:400,reason:"invalid_operation_nonce"};
   try{
    const result=await secondaryPublicationOperationalStatus(storage,{
     userId:uid,accountId:event.accountId,profileId:String(event.profileId||""),
     kind:"rating",nonce:event.nonce
    },{proofKv:rawEnv.VISITORS_KV});
    return {ok:true,...result};
   }catch{return {ok:false,status:409,reason:"secondary_result_unavailable"};}
  }
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  if(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false")return {ok:false,reason:"disabled"};
  return engine.miniRatingAction(env,String(event.profileId||""),event.action);
 }
 if(event.kind==="mini_rating_open"){
  // The secondary man reuses the original client form but saves under a
  // different user/account/profile namespace. No legacy publisher calls.
  if(event.accountId!=null&&event.accountId!=="yan_first"){
   if(uid!==OWNER_ID&&(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted"))return {ok:false,status:403};
   try{
    if(!await isSecondaryCabinetReady(storage,rawEnv,uid,event.accountId))
     return {ok:false,status:409,reason:"secondary_cabinet_unverified"};
    return await openSecondaryRatingForm(storage,env.VISITORS_KV,{userId:uid,accountId:event.accountId,profileId:String(event.profileId||"")});
   }catch(e){
    if(String(e?.message)==="Rating catalog not ready"){
     if(event.kind==="mini_rating_form")return {ok:false,status:409,reason:"not_ready"};
     const query={kind:"secondary_catalog_lookup_start",userId:uid,
      accountId:event.accountId,profileId:String(event.profileId||""),profileOwned:true};
     const result=await (uid===OWNER_ID?
      autoStartSecondaryCatalogLookup(storage,rawEnv,query):
      cabinetRPC(rawEnv,OWNER_ID,query)
     ).catch(()=>({ok:false,reason:"catalog_lookup_unavailable"}));
     return result.ok?{ok:true,stage:"loading"}:
      {ok:false,status:409,reason:result.reason||"catalog_lookup_unavailable"};
    }
    return {ok:false,status:409,reason:/catalog/i.test(String(e?.message))?
     "rating_catalog_not_ready":"secondary_rating_draft_rejected"};
   }
  }

  // Legacy publisher is Yan First only. Never route an explicit secondary man into it.
  if(event.accountId!=null&&event.accountId!=="yan_first")return {ok:false,status:409,reason:"secondary_executor_not_connected"};
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  if(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false")return {ok:false,reason:"disabled"};
  return engine.miniRatingOpen(env,String(event.profileId||""));
 }
 if(event.kind==="mini_rating_form"){
  // The secondary man reuses the original client form but saves under a
  // different user/account/profile namespace. No legacy publisher calls.
  if(event.accountId!=null&&event.accountId!=="yan_first"){
   if(uid!==OWNER_ID&&(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted"))return {ok:false,status:403};
   try{
    if(!await isSecondaryCabinetReady(storage,rawEnv,uid,event.accountId))
     return {ok:false,status:409,reason:"secondary_cabinet_unverified"};
    return await openSecondaryRatingForm(storage,env.VISITORS_KV,{userId:uid,accountId:event.accountId,profileId:String(event.profileId||"")});
   }catch(e){
    if(String(e?.message)==="Rating catalog not ready"){
     if(event.kind==="mini_rating_form")return {ok:false,status:409,reason:"not_ready"};
     const query={kind:"secondary_catalog_lookup_start",userId:uid,
      accountId:event.accountId,profileId:String(event.profileId||""),profileOwned:true};
     const result=await (uid===OWNER_ID?
      autoStartSecondaryCatalogLookup(storage,rawEnv,query):
      cabinetRPC(rawEnv,OWNER_ID,query)
     ).catch(()=>({ok:false,reason:"catalog_lookup_unavailable"}));
     return result.ok?{ok:true,stage:"loading"}:
      {ok:false,status:409,reason:result.reason||"catalog_lookup_unavailable"};
    }
    return {ok:false,status:409,reason:/catalog/i.test(String(e?.message))?
     "rating_catalog_not_ready":"secondary_rating_draft_rejected"};
   }
  }

  // Legacy publisher is Yan First only. Never route an explicit secondary man into it.
  if(event.accountId!=null&&event.accountId!=="yan_first")return {ok:false,status:409,reason:"secondary_executor_not_connected"};
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  return engine.miniRatingFormLoad(env,String(event.profileId||""));
 }
 if(event.kind==="mini_rating_save"){
  // The secondary man reuses the original client form but saves under a
  // different user/account/profile namespace. No legacy publisher calls.
  if(event.accountId!=null&&event.accountId!=="yan_first"){
   if(uid!==OWNER_ID&&(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted"))return {ok:false,status:403};
   try{
    if(!await isSecondaryCabinetReady(storage,rawEnv,uid,event.accountId))
     return {ok:false,status:409,reason:"secondary_cabinet_unverified"};
    return await saveSecondaryRatingForm(storage,env.VISITORS_KV,{userId:uid,accountId:event.accountId,profileId:String(event.profileId||""),selected:event.selected,metElsewhere:event.metElsewhere});
   }catch(e){return {ok:false,status:409,reason:/catalog/i.test(String(e?.message))?
     "rating_catalog_not_ready":"secondary_rating_draft_rejected"};}
  }

  // Legacy publisher is Yan First only. Never route an explicit secondary man into it.
  if(event.accountId!=null&&event.accountId!=="yan_first")return {ok:false,status:409,reason:"secondary_executor_not_connected"};
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  return engine.miniRatingDraftSave(env,String(event.profileId||""),event.selected,event.metElsewhere);
 }
 if(event.kind==="mini_proof"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  const id=String(event.profileId||""),kind=String(event.publicationKind||""),account=String(event.account||"");
  if(!/^\d{1,9}$/.test(id)||!["rating","review"].includes(kind)||!MAN_ACCOUNTS.some(man=>man.id===account))return {ok:false,status:400};
  const archive=await readPublicationArchive(storage,rawEnv.VISITORS_KV,uid);
  const entry=archive.items.find(item=>String(item.profileId)===id&&item.kind===kind&&item.account===account);
  if(entry?.fileId&&account!=="yan_first"&&entry.nonce){
   try{
    const result=await secondaryCompletedProof(storage,rawEnv,{userId:uid,accountId:account,profileId:id,kind,nonce:entry.nonce});
    return {ok:true,originalJpegBase64:result.original.base64};
   }catch{return {ok:false,status:404};}
  }
  return entry?.fileId?{ok:true,fileId:entry.fileId}:{ok:false,status:404};
 }
 if(event.kind==="mini_preview"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  // The read-only summary uses the existing publication archive and credit ledger.
  // No additional mutable publication state is introduced for the Mini App.
  let balance=null,archive={items:[]},finance=null,financeError=null;
  try{balance=await credits(env,uid,"status");}catch{}
  // Primary finance source is the atomic status ledger. The dedicated history endpoint
  // remains a compatibility fallback for already-deployed versions.
  if(balance?.ok&&Array.isArray(balance.events))finance=balance;
  if(!finance)try{finance=await creditHistory(env,uid);}catch(e){financeError="ledger_unavailable";console.error("Mini App finance report unavailable",String(e));}
  if(finance?.ok&&uid!==OWNER_ID){
   try{
    const registryEvents=await registry(env,{action:"history",userId:uid});
    finance.topups=Array.isArray(registryEvents?.events)?registryEvents.events:[];
   }catch(e){console.error("Finance top-up history unavailable",String(e));}
  }
  try{archive=await readPublicationArchive(storage,rawEnv.VISITORS_KV,uid);}catch{}
  const proofCounts=new Map();
  for(const item of archive.items||[]){
   const key=String(item.profileId),value=proofCounts.get(key)||{rating:0,review:0,total:0};
   if(item.kind==="rating"||item.kind==="review")value[item.kind]++;
   value.total++;proofCounts.set(key,value);
  }
  const ids=await env.VISITORS_KV.get("owner_anketa_library:"+uid,"json");
  const profiles=[];
  for(const id of [...new Set(Array.isArray(ids)?ids:[])].slice(0,80)){
   if(!/^\d{1,9}$/.test(String(id)))continue;
   const saved=await env.VISITORS_KV.get("owner_anketa_saved:"+uid+":"+id,"json");
   if(!saved||String(saved.profile?.id)!==String(id))continue;
   let photo="";
   const candidate=String(saved.profile.photoUrl||"");
   try{
    const url=new URL(candidate);
    if(url.protocol==="https:"&&(url.hostname==="dame-camelias.gptjjjgpt.workers.dev"&&url.pathname==="/api/anketa/photo/"+id||
     url.hostname==="cdn2.intimtur.com"))photo=url.href;
   }catch{}
   if(!photo&&/^[a-z0-9-]+\.intimcity\.rip$/.test(saved.host||""))
    photo="https://dame-camelias.gptjjjgpt.workers.dev/api/anketa/photo/"+id+"?site="+encodeURIComponent(saved.host);
   const statuses={};
   for(const kind of ["rating","review"]){
    const value=await env.VISITORS_KV.get("owner_anketa_publication_v1:"+kind+":"+id,"json").catch(()=>null);
    statuses[kind]=value?.status==="published"?"published":
      value?.status==="publishing"||value?.status==="needs_verification"?"checking":"unknown";
   }
   // A pending moderated review is not a published review and must not spend a credit.
   if(statuses.review==="unknown"){
    const ticket=await env.VISITORS_KV.get((uid===OWNER_ID?"":"cabinet_v3:"+uid+":")+"mini_review_ticket_v1:"+id,"json").catch(()=>null);
    if(ticket?.ticket){
     const moderation=await env.VISITORS_KV.get("cabinet_review_moderation:"+uid+":"+ticket.ticket,"json").catch(()=>null);
     if(moderation?.status!=="cancelled")statuses.review="moderation";
    }
   }
   // Archive-backed completed actions must never be displayed as publishable.
   for(const kind of ["rating","review"]){
    if((archive.items||[]).some(item=>String(item.profileId)===String(id)&&item.kind===kind&&item.account==="yan_first"))
     statuses[kind]="published";
   }
   let daily=null;
   try{
    const status=await dailyLimit(env,uid,id,"status");
    if(Number.isSafeInteger(status?.remaining)&&status.remaining>=0)
     daily={remaining:status.remaining};
   }catch{}
   // A display hint, not a publication permission. The original Telegram flow
   // remains the sole authority for reserving and publishing.
   const capabilities={};
   for(const kind of ["rating","review"]){
    const state=statuses[kind];
    const reason=state==="published"?"published":
      state==="checking"||state==="moderation"?"checking":
      balance?.available===0?"credits":
      !Number.isSafeInteger(balance?.available)?"unknown":
      daily?.remaining===0?"daily_limit":
      !Number.isSafeInteger(daily?.remaining)?"unknown":
      rawEnv.CABINET_PUBLICATIONS_ENABLED==="false"?"disabled":"check_in_bot";
    capabilities[kind]={state:reason,account:"yan_first"};
   }
   profiles.push({id:String(id),name:String(saved.profile.name||"").slice(0,80),
    age:Number.isInteger(saved.profile.age)?saved.profile.age:null,
    metro:String(saved.profile.metro||"").slice(0,100),photo,statuses,capabilities,daily,counts:proofCounts.get(String(id))||{rating:0,review:0,total:0}});
  }
  const allowed=new Set(profiles.map(p=>p.id));
  // Read-only legacy memory: show saved drafts and publication requests without
  // creating a second journal or exposing secrets and moderation payloads.
  const activities=[];
  for(const p of profiles){
   const pid=p.id;
   const ratingDraft=await env.VISITORS_KV.get("cabinet_rating_draft:"+uid+":"+pid,"json").catch(()=>null);
   if(ratingDraft&&ratingDraft.selected&&Object.keys(ratingDraft.selected).length)
    activities.push({id:pid,kind:"rating_draft",account:"yan_first",status:"saved",count:Object.keys(ratingDraft.selected).length});
   const reviewKey=(uid===OWNER_ID?"":"cabinet_v3:"+uid+":")+"owner_anketa_review_draft_v1:yan_first:"+pid;
   const reviewDraft=await env.VISITORS_KV.get(reviewKey,"json").catch(()=>null);
   if(typeof reviewDraft?.text==="string"&&reviewDraft.text.length>=10)
    activities.push({id:pid,kind:"review_draft",account:"yan_first",status:"saved",savedAt:reviewDraft.savedAt||null});
   for(const kind of ["rating","review"]){
    const status=p.statuses?.[kind];
    if(status==="checking")activities.push({id:pid,kind,account:"yan_first",status:"checking"});
   }
  }
  // Fast per-client status index, written alongside drafts. Legacy Михаил
  // records are also read directly until touched in the new index.
  const secondaryStatuses={};
  const [indexed,reviewIndexed]=await Promise.all([
   storage.get("secondary-rating-progress-v1:"+uid),
   storage.get("secondary-review-progress-v1:"+uid)
  ]);
  const candidates=[];
  for(const p of profiles){
   const pid=String(p.id);
   secondaryStatuses[pid]={};
   for(const man of MAN_ACCOUNTS.slice(1)){
    const mid=man.id;
    const row=indexed?.[pid+":"+mid];
    const reviewRow=reviewIndexed?.[pid+":"+mid];
    if(reviewRow?.accountId===mid&&reviewRow?.profileId===pid&&
       reviewRow.kind==="review"&&reviewRow.stage==="draft_saved"){
     secondaryStatuses[pid][mid]={review:"draft_saved"};
     activities.push({id:pid,kind:"review",account:mid,status:"draft_saved"});
    }
    if(row?.accountId!==mid||row?.profileId!==pid||
       !Number.isSafeInteger(row.count)||row.count<0)continue;
    const stage=row.stage==="draft_saved"?"draft_saved":"not_started";
    if(stage==="not_started")continue;
    secondaryStatuses[pid][mid]={...secondaryStatuses[pid][mid],rating:stage,ratingCount:row.count};
    activities.push({id:pid,kind:"rating",account:mid,status:stage,count:row.count});
   }
   // Backwards-compatible read of Михаил's already-saved draft, without
   // scanning all 29 accounts × 80 profiles on every cabinet refresh.
   if(!secondaryStatuses[pid].yan_second){
    const mid="yan_second",draftKey=manStorageKey({userId:uid,
      accountId:mid,profileId:pid,scope:"rating-draft"})+":rating";
    candidates.push({pid,mid,draftKey});
   }
  }
  await Promise.all(candidates.map(async ({pid,mid,draftKey})=>{
   const draft=await storage.get(draftKey);
   if(draft?.userId!==uid||draft?.accountId!==mid||
      draft?.profileId!==pid||draft?.kind!=="rating"||
      !draft.selected||typeof draft.selected!=="object")return;
   const count=Object.keys(draft.selected).length;
   if(!count)return;
   secondaryStatuses[pid][mid]={...secondaryStatuses[pid][mid],rating:"draft_saved",ratingCount:count};
   activities.push({id:pid,kind:"rating",account:mid,status:"draft_saved",count});
  }));
  // Refresh claimed publication stages only for known per-man drafts.
  // No account can inherit the publication status of Yan First.
  const activePairs=Object.entries(secondaryStatuses).flatMap(([pid,byMan])=>
   Object.entries(byMan).flatMap(([mid,state])=>
    ["rating","review"].filter(kind=>state[kind]).map(kind=>({pid,mid,kind}))));
  await Promise.all(activePairs.map(async ({pid,mid,kind})=>{
   try{
    const pubKey=manStorageKey({userId:uid,accountId:mid,
     profileId:pid,scope:"publication"})+":"+kind;
    const publication=await storage.get(pubKey);
    const identity=publication?.identity;
    if(identity?.userId!==uid||identity.accountId!==mid||
       identity.profileId!==pid||identity.kind!==kind||
       !/^[a-f0-9]{12}$/.test(identity.nonce||""))return;
    const result=await secondaryPublicationOperationalStatus(storage,identity,{
      proofKv:rawEnv.VISITORS_KV
    });
    const stage=({prepared:"prepared",attempted:"checking",published:"published",
     reconciliation_required:"reconciliation_required"})[result.status];
    if(!stage)return;
    secondaryStatuses[pid][mid][kind]=stage;
    for(const entry of activities)
     if(entry.id===pid&&entry.account===mid&&
        (entry.kind===kind||entry.kind===kind+"_draft"))entry.status=stage;
   }catch{ /* A failed status read must never produce a success badge. */ }
  }));
  await Promise.all((archive.items||[]).map(async item=>{
   if(item.account==="yan_first"||!allowed.has(String(item.profileId))||!item.nonce)return;
   const pid=String(item.profileId),mid=item.account;
   try{
    const result=await secondaryPublicationOperationalStatus(storage,{userId:uid,accountId:mid,
     profileId:pid,kind:item.kind,nonce:item.nonce},{proofKv:rawEnv.VISITORS_KV});
    secondaryStatuses[pid]??={};secondaryStatuses[pid][mid]??={};
    secondaryStatuses[pid][mid][item.kind]=result.published?"published":"reconciliation_required";
   }catch{ /* Never fabricate success for unavailable original evidence. */ }
  }));
  const history=(archive.items||[]).map(item=>({
   id:String(item.profileId),kind:item.kind,account:item.account,
   date:item.date,hasProof:!!item.fileId
  }));
  // Surface only the stage of the *existing* legacy operation, never its
  // text, nonce, draft, reservation identifiers or moderation payload.
  let workflow=null;
  try{
   const active=await env.VISITORS_KV.get("owner_anketa_state:"+uid,"json");
   const stage=String(active?.step||"");
   const pid=String(active?.profile?.id||active?.id||"");
   const permitted=new Set(["ratings_loading","ratings","ratings_agreed","audit_loading","dryfill_loading","prepublish_ready","publishing","proof_loading","review_input","review_preview","review_moderation","review_dispatch","review_recheck","review_result","publication_result"]);
   if(permitted.has(stage)&&allowed.has(pid)){
    workflow={profileId:pid,stage,account:active?.account==="yan_first"?"yan_first":null};
    // Read-only summary from the original rating draft. Never expose a save
    // token or claim a publication has occurred.
    if(["ratings","ratings_agreed","audit_loading","dryfill_loading","prepublish_ready"].includes(stage)&&Array.isArray(active.catalog)&&active.catalog.length<=120){
     const selections=Object.entries(active.selected||{}).filter(([key,value])=>
       /^(0|[1-9]\d{0,2})$/.test(key)&&typeof value==="string"&&Number(key)<active.catalog.length).slice(0,120);
     workflow.ratingDraft=selections.map(([key,value])=>({
       label:String(active.catalog[Number(key)]?.label||"").slice(0,90),
       value:value.slice(0,50)
     }));
     workflow.hasDraft=active.draftReady===true;
    }
   }
  }catch{}
  const visibility=await clientManVisibilityMap(storage,MAN_ACCOUNTS);
  // Verified 4/4 connection grants cabinet entry, NOT publication.
  // Read only private owner-controlled records; unavailable data fails closed.
  const connected=uid!==OWNER_ID?new Map():new Map(await Promise.all(MAN_ACCOUNTS.slice(1).map(async man=>{
   try{
    const {connection:c}=await readSecondaryConnection(storage,rawEnv,man.id,OWNER_ID);
    return [man.id,{...c,loginVerified:c.ready}];
   }catch{return [man.id,null];}
  })));
  let catalog=secondaryCabinetAvailability(connected);
  if(uid!==OWNER_ID){
   const remote=await cabinetRPC(rawEnv,OWNER_ID,{kind:"secondary_catalog_cabinet_list"})
    .catch(()=>({ok:false}));
   const allowed=new Set(remote?.ok===true&&Array.isArray(remote.readyIds)?remote.readyIds:[]);
   catalog=catalog.map(man=>({...man,cabinetReady:man.id==="yan_first"||allowed.has(man.id)}));
  }
  return {ok:true,men:catalog.map(man=>({...man,visible:visibility.get(man.id)===true})),profiles,secondaryStatuses,history,activities,workflow,finance:finance?.ok?finance:null,financeStatus:finance?.ok?"ready":financeError||"ledger_unavailable",balance:balance?{available:balance.available,reserved:balance.reserved,spent:balance.spent,remaining:balance.remaining}:null};
 }
 if(event.kind==="update"){
  let update=event.update;if(privateActor(update)!==uid)return {handled:true};
  let action=String(update.callback_query?.data||"");
  if(uid!==OWNER_ID){
   if(action.startsWith("clients:"))return {handled:true};
   const home=action==="owner_anketa:home"||action==="trial_cabinet:home";
   let command=String(update.message?.text||"").trim().split(/\s+/)[0].split("@")[0];
   const outside=action&&!/^(owner_anketa|trial_cabinet):/.test(action)||command.startsWith("/")&&command!=="/anketa";
   // Leaving the cabinet must work independently of access, session and balance.
   // Cancel only unsubmitted input; accepted operations and proofs remain intact.
   if(home||outside){
    await storage.delete("login_pending");
    const draft=await env.VISITORS_KV.get("owner_anketa_state:"+uid,"json");
    if(["number","review_input","review_preview","domain_recovery"].includes(draft?.step))await env.VISITORS_KV.delete("owner_anketa_state:"+uid);
    if(outside)return {handled:false};
    const handled=await engine.handleOwnerAnketa({...update,callback_query:{...update.callback_query,data:"owner_anketa:home"}},env,send);
    return {handled,home:handled};
   }
   if(rawEnv.CABINET_CLIENTS_ENABLED==="false"){
    const flow=await env.VISITORS_KV.get("owner_anketa_state:"+uid,"json");
    const selected=/^(owner_anketa|trial_cabinet):/.test(action)||update.message?.text==="/anketa"||/^https:\/\/[^ ]+\.intimcity\.rip\//.test(update.message?.text||"")||["number","review_input","review_preview"].includes(flow?.step);
    if(selected)await send(env,"sendMessage",{chat_id:uid,text:"🌷 Личный кабинет временно на обслуживании."});
    return {handled:selected};
   }
   if(!client?.active)return {handled:/^(owner_anketa|trial_cabinet):/.test(action)||update.message?.text==="/anketa"};
   // Even an already provisioned client cannot enter until signing.
   // Fail closed when agreement status is temporarily unavailable.
   if((await agreementStatus(env,uid)).status!=="accepted"){
    const requested=/^(owner_anketa|trial_cabinet):/.test(action)||update.message?.text==="/anketa";
    if(requested){
     if(update.callback_query)await send(env,"answerCallbackQuery",{callback_query_id:update.callback_query.id,text:"Сначала подпишите соглашение."}).catch(()=>{});
     await send(env,"sendMessage",{chat_id:uid,text:"🌹 DAME CAMELIAS\n\n📜 Для открытия раздела «Мои анкеты» сначала подпишите соглашение.",reply_markup:{inline_keyboard:[[{text:"📜 Соглашение",callback_data:"agreement:start"}],[{text:"🏠 В начало",callback_data:"home"}]]}});
    }
    return {handled:requested};
   }
   const loginSay=async text=>{
    const old=await storage.get("login_navigation");const sent=await send(env,"sendMessage",{chat_id:uid,text});
    if(Number.isSafeInteger(sent?.message_id)){
     await storage.put("login_navigation",sent.message_id);
     if(Number.isSafeInteger(old))await send(env,"deleteMessage",{chat_id:uid,message_id:old}).catch(()=>{});
    }
   };
   let session=await storage.get("client_session");
   if(!session&&uid===TRIAL_ID&&client.authVersion===1&&(await rawEnv.VISITORS_KV.get("trial_cabinet_v1:"+uid+":session","json"))?.verified===true){session={version:1};await storage.put("client_session",session);}
   let pending=await storage.get("login_pending");
   if(update.message?.text?.startsWith("/")&&update.message.text!=="/anketa"){
    await storage.delete("login_pending");pending=null;
   }
   if(!session||session.version!==client.authVersion){
    if(!/^(owner_anketa|trial_cabinet):/.test(action)&&update.message?.text!=="/anketa"&&!pending)return {handled:false};
    if(update.callback_query)await send(env,"answerCallbackQuery",{callback_query_id:update.callback_query.id});
    if(update.message?.text&&!update.message.text.startsWith("/")&&pending?.expires>Date.now()){
     await send(env,"deleteMessage",{chat_id:uid,message_id:update.message.message_id}).catch(()=>{});
     const result=await registry(env,{action:"login",userId:uid,pin:update.message.text.trim()});
     if(!result.ok){await loginSay(result.locked?"🔒 Вход заблокирован на 15 минут.":"🔐 Неверный код.");return {handled:true};}
     await storage.put("client_session",{version:result.client.authVersion});await storage.delete("login_pending");
     const loginMessage=await storage.get("login_navigation");
     if(Number.isSafeInteger(loginMessage))await send(env,"deleteMessage",{chat_id:uid,message_id:loginMessage}).catch(()=>{});
     await storage.delete("login_navigation");
     update={message:{from:{id:uid},chat:{id:uid,type:"private"},text:"/anketa"}};
     command="/anketa";
    }else{
     await storage.put("login_pending",{expires:Date.now()+600000});
     await loginSay("🔐 ЛИЧНЫЙ КАБИНЕТ\n\nВведите индивидуальный код доступа.");return {handled:true};
    }
   }
   env.__cabinetAuthorized=uid;
   if(uid===TRIAL_ID)await migrateTrial(storage,env);
   const flow=await env.VISITORS_KV.get("owner_anketa_state:"+uid,"json");
   const cabinetInput=/^(owner_anketa|trial_cabinet):/.test(action)||command==="/anketa"||/^https?:\/\/[a-z0-9-]+\.intimcity\.[a-z]{2,10}\//i.test(update.message?.text||"")||["number","review_input","review_preview","domain_recovery"].includes(flow?.step);
   if(!cabinetInput)return {handled:false};
   // Exhaustion affects client navigation only. Result/proof callbacks below
   // must still finish accepted work; reservations are not spent credits.
   let balance;
   try{balance=await credits(env,uid,"status");}
   catch{
    if(update.callback_query)await send(env,"answerCallbackQuery",{callback_query_id:update.callback_query.id});
    await send(env,"sendMessage",{chat_id:uid,text:"🌷 Сейчас не удалось проверить баланс. Попробуйте открыть кабинет позже."});
    return {handled:true};
   }
   const emptyProfile=/^owner_anketa:balance_empty:(\d{1,9})$/.exec(action);
   if(balance.available===0&&balance.reserved===0){
    if(update.callback_query)await send(env,"answerCallbackQuery",{callback_query_id:update.callback_query.id});
    await engine.showExhaustedCabinet(env,send,emptyProfile?.[1],balance);
    return {handled:true};
   }else if(emptyProfile){
    // A top-up takes effect on the next click, including an old zero-balance button.
    action="owner_anketa:saved:"+emptyProfile[1];
    update={...update,callback_query:{...update.callback_query,data:action}};
   }
  }
  const loadingEmoji=uid===OWNER_ID?selectedLoadingEmoji(update.message):null;
  if(loadingEmoji&&!(await storage.get("admin_pending"))&&(await env.VISITORS_KV.get("owner_cabinet_session:"+uid,"json"))?.authorized){
   const text="🌹 DAME CAMELIAS\n\n"+loadingEmoji.alt+" ЧАСЫ ОЖИДАНИЯ ПОДКЛЮЧЕНЫ\n\n💕 Этот эмодзи будет появляться в сообщениях, пока мы проверяем анкету или готовим результат.";
   try{
    await send(env,"sendMessage",{chat_id:uid,text,entities:[{type:"custom_emoji",offset:text.indexOf(loadingEmoji.alt),length:loadingEmoji.alt.length,custom_emoji_id:loadingEmoji.id}],reply_markup:{inline_keyboard:[[{text:"👑 Администратор",callback_data:"clients:menu"}],[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]]}});
   }catch(error){
    if(error.telegramCode!==400)throw error;
    await send(env,"sendMessage",{chat_id:uid,text:"🌹 DAME CAMELIAS\n\n⏳ Telegram пока не разрешил боту использовать эти премиум-часы. Проверьте Premium у аккаунта, которому принадлежит бот. Пока будут обычные часы.",reply_markup:{inline_keyboard:[[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]]}});return {handled:true};
   }
   await rawEnv.VISITORS_KV.put(LOADING_EMOJI_KEY,JSON.stringify(loadingEmoji));
   return {handled:true};
  }
  if(uid===OWNER_ID&&(String(update.callback_query?.data||"").startsWith("clients:")||await storage.get("admin_pending"))&&!(await env.VISITORS_KV.get("owner_cabinet_session:"+uid,"json"))?.authorized){
    await storage.delete("admin_pending");
    await engine.handleOwnerAnketa({message:{from:{id:uid},chat:{id:uid,type:"private"},text:"/anketa"}},env,send);return {handled:true};
  }
  const adminResult=await admin(update,env,storage,send);
  if(adminResult==="cabinet")update={...update,callback_query:{...update.callback_query,data:"owner_anketa:open"}};
  else if(adminResult)return {handled:true};
  action=String(update.callback_query?.data||"");
  if(action.startsWith("trial_cabinet:")){
   const next=action.replace("trial_cabinet:","owner_anketa:").replace(":profile:",":saved:").replace(":add",":new");
   update={...update,callback_query:{...update.callback_query,data:next}};action=next;
  }
  const selected=/^owner_anketa:saved:(\d{1,9})$/.exec(action);
  if(selected&&uid===TRIAL_ID){
   const record=await env.VISITORS_KV.get("owner_anketa_saved:"+uid+":"+selected[1],"json");
   const urls=await storage.get("legacy_urls")||{};
   if(!record&&urls[selected[1]])update={message:{from:{id:uid},chat:{id:uid,type:"private"},text:urls[selected[1]]}};
  }
  let active=await env.VISITORS_KV.get("owner_anketa_state:"+uid,"json");
  if(["publishing","review_dispatch","review_recheck","proof_loading"].includes(active?.step)&&Date.now()-Number(active.confirmedAt||active.agreedAt||0)>10*60000){
    // Preserve the immutable operation for authenticated late results while
    // allowing navigation to a different profile. Never dispatch it again.
    await env.VISITORS_KV.put("owner_anketa_state:"+uid,JSON.stringify({...active,step:"operation_stalled"}));
    active={...active,step:"operation_stalled"};
  }
  if(["publishing","review_dispatch","review_recheck","proof_loading","dryfill_loading"].includes(active?.step)&&action&&!/^(?:owner_anketa:(?:home|open|saved:\d+|account1:\d+|accounts:\d+))$/.test(action)){
   await send(env,"sendMessage",{chat_id:uid,text:"⏳ Предыдущая операция ещё выполняется. Дождитесь результата."});return {handled:true};
  }
  if(["publishing","review_dispatch","review_recheck","proof_loading","dryfill_loading"].includes(active?.step)&&update.message?.text&&!update.message.text.startsWith("/")){
   await send(env,"sendMessage",{chat_id:uid,text:"⏳ Предыдущая операция ещё выполняется. Дождитесь результата."});return {handled:true};
  }
  if(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false"&&/^owner_anketa:(?:publish_confirm|reviewfinal):/.test(action)){
   await send(env,"sendMessage",{chat_id:uid,text:"🌷 Публикации временно приостановлены. Черновик сохранён."});return {handled:true};
  }
  const handled=await engine.handleOwnerAnketa(update,env,send);
  return {handled,home:handled&&action==="owner_anketa:home"};
 }
 if(event.kind==="ratings"){
  const session=uid===OWNER_ID?await env.VISITORS_KV.get("owner_cabinet_session:"+uid,"json"):await storage.get("client_session");
  if(uid===OWNER_ID?!session?.authorized:session?.version!==client?.authVersion)return {status:403,body:"Cabinet authorization required"};
  if(uid!==OWNER_ID){
   const balance=await credits(env,uid,"status");
   if(balance.available===0&&balance.reserved===0)return {status:403,body:"Publication balance exhausted"};
  }
 }
 const finishing=event.kind==="result"||(event.kind==="review"&&new URL(event.url).searchParams.get("mode")==="review_proof");
 if(uid!==OWNER_ID&&(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false")&&!finishing)return {status:403,body:"Forbidden"};
 env.__cabinetAuthorized=uid;
 const request=new Request(event.url,{method:event.method,headers:event.headers,...(event.body!==null?{body:event.body}:{})});
 if(["result","dryfill","review","stage"].includes(event.kind)){
  let payload=null;try{payload=event.body?JSON.parse(event.body):null;}catch{}
  const operationNonce=String(payload?.nonce||new URL(event.url).searchParams.get("nonce")||"");
  if(/^[a-f0-9]{12}$/.test(operationNonce)){
    const active=await env.VISITORS_KV.get("owner_anketa_state:"+uid,"json");
    const key="cabinet_operation:"+uid+":"+operationNonce;
    const archived=await env.VISITORS_KV.get(key,"json");
    if(archived?.nonce===operationNonce&&active?.nonce!==operationNonce)env.__operationKey=key;
  }
 }
 if(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false"){
  let body=null;try{body=event.body?JSON.parse(event.body):null;}catch{}
  const mode=new URL(event.url).searchParams.get("mode");
  const current=await env.VISITORS_KV.get(env.__operationKey||"owner_anketa_state:"+uid,"json");
  if(event.kind==="review"&&mode==="review_publish"||event.kind==="stage"&&body?.type==="review_submit_boundary"||event.kind==="dryfill"&&current?.step==="publishing")return {status:503,body:"Publication paused"};
 }
 const methods={result:"handleAnketaLookupResult",dryfill:"ownerDryfillPayload",review:"ownerReviewPayload",stage:"ownerReviewStage",ratings:"ownerRatingFormApi"};
 if(!methods[event.kind])return {status:400,body:"Unknown operation"};
 const response=await engine[methods[event.kind]](request,env,send,verifyTelegram);
 return {status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)};
}

