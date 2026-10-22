// Secondary review moderation uses the same decisions as Yan First, with an
// account-bound draft, approval and publication. No primary records are touched.
import {MODERATION_CHAT,MODERATOR_ID,moderationTelegram} from "./review_moderation.js";
import {manStorageKey} from "./man_account_isolation.js";
import {MAN_ACCOUNTS} from "./man_accounts.js";
import {approveSecondaryReviewForSubmission} from "./secondary_man_review_launch.js";
export const secondaryReviewNoticeKey=i=>manStorageKey({...i,scope:"moderation"})+":review-notification";
const draftKey=i=>manStorageKey({...i,scope:"review-draft"})+":review";
const publicationKey=i=>manStorageKey({...i,scope:"publication"})+":review";
const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function limited(x,max){let out="";for(const ch of String(x??"")){const bit=esc(ch);if(out.length+bit.length>max-1)return out+"…";out+=bit;}return out;}
export function moderationCallback(i,version,action="approve"){
 return ["srmod",action,i.userId,i.accountId,i.profileId,String(version)].join(":");
}
export function secondaryModerationButtons(i,version,status="delivered"){
 const actions=status==="delivered"?[["approve","✅ Опубликовать"],["edit","✏️ Скорректировать"],["cancel","❌ Отклонить"]]:status==="editing"?[["cancel","❌ Отклонить"]]:[];
 return {inline_keyboard:actions.map(([action,text])=>[{text,callback_data:moderationCallback(i,version,action)}])};
}
function card(i,row,draft){
 const label=({delivered:"✍️ НОВЫЙ ОТЗЫВ",editing:"✏️ КОРРЕКТИРОВКА ТЕКСТА",approving:"⏳ ПОДГОТОВКА ПУБЛИКАЦИИ",approved:"⏳ ОЖИДАЕМ ПОДТВЕРЖДЕНИЕ",cancelled:"❌ ОТЗЫВ ОТКЛОНЁН",published:"✅ ОТЗЫВ ОПУБЛИКОВАН",uncertain:"⏳ ПРОВЕРКА ДОСТАВКИ"})[row.status]||"✍️ ОТЗЫВ";
 const text=["🌹 <b>DAME CAMELIAS</b>","━━━━━━━━━━━━━━━━","<b>"+label+"</b>","",
  "🌹 <b>Анкета:</b> №"+esc(i.profileId),"👨‍💻 <b>Мужчина:</b> "+esc(MAN_ACCOUNTS.find(m=>m.id===i.accountId)?.name||i.accountId),
  "👤 <b>Клиентка:</b> "+esc(i.userId),"","✍️ <b>"+(draft.revisions?.length?"ИТОГОВЫЙ ТЕКСТ":"ТЕКСТ ОТЗЫВА")+"</b>",limited(draft.text,1800),
  ...(draft.revisions?.length?["","✏️ <b>Исправлений:</b> "+draft.revisions.length,"<b>Исходный текст:</b> "+limited(draft.originalText,400)]:[]),
  "",row.status==="cancelled"?"🔒 Публикация отменена, списания нет.":row.status==="published"?"📸 Подтверждение сохранено в архиве. Отзыв ожидает модерации сайта (обычно 1–10 дней).":
   ["approved","approving"].includes(row.status)?"⏳ Ожидаем подтверждение отправки. Повторная публикация заблокирована.":"🔒 Публикации и списания пока нет.",
  ...(row.note?["ℹ️ "+limited(row.note,200)]:[])].join("\n");
 return {chat_id:MODERATION_CHAT,text,parse_mode:"HTML",reply_markup:secondaryModerationButtons(i,row.version,row.status)};
}
async function messageIndex(env,action,messageId,value){
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("review-moderation-index:v1"));
 const response=await object.fetch("https://moderation.internal/",{method:"POST",body:JSON.stringify({type:"review_moderation_index",action,messageId,value})});
 if(!response.ok)throw Error("Moderation index unavailable");return response.json();
}
async function register(env,i,row,messageId){
 const result=await messageIndex(env,"put",messageId,{userId:i.userId,ticket:"0000000000000000",secondary:{...i,version:row.version,messageId:row.messageId}});
 if(!result.ok)throw Error("Moderation index unavailable");
}
export async function refreshSecondaryReviewCard(storage,env,i,remaining=3){
 const [row,draft]=await Promise.all([storage.get(secondaryReviewNoticeKey(i)),storage.get(draftKey(i))]);
 if(!Number.isSafeInteger(row?.messageId)||!draft)return {ok:false};
 try{
  await moderationTelegram(env,"editMessageText",{...card(i,row,draft),message_id:row.messageId});
  const same=await storage.transaction(async tx=>{const current=await tx.get(secondaryReviewNoticeKey(i));if(current?.version!==row.version||current.status!==row.status)return false;await tx.put(secondaryReviewNoticeKey(i),{...current,controlsVersion:2});return true;});
  // A result callback may complete while Telegram is editing an older card.
  // Finish with the latest durable state, never overwrite published with waiting.
  if(!same&&remaining>0)return refreshSecondaryReviewCard(storage,env,i,remaining-1);
  return {ok:same,messageId:row.messageId,status:row.status};
 }catch{return {ok:false,messageId:row.messageId,status:row.status};}
}
export async function ensureSecondaryReviewGroupNotice(storage,env,i,{existingOnly=false}={}){
 const draft=await storage.get(draftKey(i));
 if(!draft||draft.authorAttested!==true||draft.userId!==i.userId||draft.accountId!==i.accountId||draft.profileId!==i.profileId||typeof draft.text!=="string"||draft.text.length<10||draft.text.length>3000)return {ok:false};
 const id=secondaryReviewNoticeKey(i),at=Date.now();
 const claim=await storage.transaction(async tx=>{
  const prev=await tx.get(id);
  if(prev?.version===draft.version)return false;
  if(existingOnly||prev&&["sending","uncertain","editing","approving","approved","published"].includes(prev.status))return false;
  await tx.put(id,{version:draft.version,status:"sending",at});return true;
 });
 if(!claim){
  const prior=await storage.get(id);
  if(!prior)return {ok:false,reason:"existing_notice_required"};
  if(Number.isSafeInteger(prior.messageId)&&prior.version===draft.version&&prior.controlsVersion!==2)
   return {...await refreshSecondaryReviewCard(storage,env,i),already:true};
  return {ok:true,already:true,messageId:prior.messageId,status:prior.status};
 }
 try{
  if(!env.BOT_TOKEN)throw Error("Telegram token missing");
  const row={version:draft.version,status:"delivered",at};
  const result=await moderationTelegram(env,"sendMessage",card(i,row,draft));
  if(!Number.isSafeInteger(result?.message_id))throw Error("Telegram message ID missing");
  await storage.transaction(async tx=>{const state=await tx.get(id);if(state?.version===draft.version&&state.status==="sending")await tx.put(id,{...row,messageId:result.message_id,deliveredAt:Date.now(),controlsVersion:2});});
  return {ok:true,notified:true};
 }catch{
  await storage.transaction(async tx=>{const state=await tx.get(id);if(state?.version===draft.version&&state.status==="sending")await tx.put(id,{...state,status:"uncertain",at:Date.now()});});
  return {ok:false,reason:"secondary_review_group_delivery_uncertain"};
 }
}
export async function verifySecondaryReviewGroupDecision(storage,i,{version,messageId}){
 const row=await storage.get(secondaryReviewNoticeKey(i));
 return ["delivered","editing"].includes(row?.status)&&row.version===version&&row.messageId===messageId;
}
// Called exclusively by the owner-authenticated Telegram handler in the private DO.
export async function secondaryReviewGroupDecision(storage,env,i,event,launch){
 const action=event.action;
 if(!["approve","edit","cancel","replace"].includes(action))return {ok:false};
 const result=await storage.transaction(async tx=>{
  const [row,draft,pub]=await Promise.all([tx.get(secondaryReviewNoticeKey(i)),tx.get(draftKey(i)),tx.get(publicationKey(i))]);
  if(pub||row?.version!==event.draftVersion||draft?.version!==row.version||draft.authorAttested!==true||row.messageId!==event.messageId||
    (action==="replace"?row.status!=="editing"||![row.promptId,row.messageId].includes(event.promptId):action==="approve"?row.status!=="delivered":!["delivered","editing"].includes(row.status)))return {ok:false,status:409,reason:"outdated_moderation_card"};
  let nextDraft=draft,next={...row,status:action==="edit"?"editing":action==="cancel"?"cancelled":"approving",decidedAt:Date.now(),controlsVersion:0};
  if(action==="replace"){
   const text=String(event.text||"").trim();if(text.length<10||text.length>3000)return {ok:false,status:400};
   nextDraft={...draft,text,version:draft.version+1,originalText:draft.originalText||draft.text,revisions:[...(draft.revisions||[]),{text:draft.text,replacementText:text,actorId:MODERATOR_ID,at:Date.now()}]};
   next.version=nextDraft.version;await tx.put(draftKey(i),nextDraft);
  }
  await tx.put(secondaryReviewNoticeKey(i),next);
  return {ok:true,row:next,draft:nextDraft};
 });
 if(!result.ok)return result;
 const {row,draft}=result;
 if(action==="edit"){
  try{
   await register(env,i,row,row.messageId);
   if(!row.promptId){
    const prompt=await moderationTelegram(env,"sendMessage",{chat_id:MODERATION_CHAT,text:draft.text,reply_parameters:{message_id:row.messageId},reply_markup:{force_reply:true,selective:true}});
    await storage.transaction(async tx=>{const current=await tx.get(secondaryReviewNoticeKey(i));if(current?.status==="editing"&&current.version===row.version)await tx.put(secondaryReviewNoticeKey(i),{...current,promptId:prompt.message_id});});
    await register(env,i,row,prompt.message_id);
   }
  }catch{await refreshSecondaryReviewCard(storage,env,i);return {ok:false,reason:"correction_prompt_unavailable"};}
 }else if(action!=="cancel"){
  try{
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(draft.text))),b=>b.toString(16).padStart(2,"0")).join("");
   await approveSecondaryReviewForSubmission(storage,{identity:{...i,nonce:crypto.randomUUID().replace(/-/g,"").slice(0,12)},draftVersion:draft.version,expectedTextSha256:hash,moderatorApproved:true,at:Date.now()});
   const dispatched=await launch();
   if(dispatched?.dispatchAccepted!==true)throw Error("Publication not accepted");
   await storage.transaction(async tx=>{const current=await tx.get(secondaryReviewNoticeKey(i));if(current?.status==="approving")await tx.put(secondaryReviewNoticeKey(i),{...current,status:"approved",controlsVersion:0});});
  }catch{
   // A prepared/attempted operation remains locked; never resubmit on timeout.
   const pub=await storage.get(publicationKey(i));
   const approval=await storage.get(manStorageKey({...i,scope:"moderation"})+":review");
   const ledger=approval?.identity?await storage.get(manStorageKey({...i,scope:"operation"})+":review:"+approval.identity.nonce+":ledger"):null;
   const locked=!!pub||ledger&&ledger.status!=="reserve_rejected";
   await storage.transaction(async tx=>{const current=await tx.get(secondaryReviewNoticeKey(i));if(current?.status==="approving")await tx.put(secondaryReviewNoticeKey(i),{...current,status:locked?"uncertain":"delivered",note:locked?"Требуется проверка результата. Повторная отправка запрещена.":"Публикация не запущена. Проверьте подключение и доступность кредитов.",controlsVersion:0});});
   await refreshSecondaryReviewCard(storage,env,i);return {ok:false,reason:locked?"publication_requires_reconciliation":"review_launch_blocked"};
  }
 }
 await refreshSecondaryReviewCard(storage,env,i);
 if(action!=="edit"&&row.promptId)await moderationTelegram(env,"deleteMessage",{chat_id:MODERATION_CHAT,message_id:row.promptId}).catch(()=>{});
 return {ok:true,status:action==="cancel"?"cancelled":action==="edit"?"editing":"approved"};
}
export async function markSecondaryReviewPublished(storage,env,i){
 if(i.kind!=="review")return;
 await storage.transaction(async tx=>{const row=await tx.get(secondaryReviewNoticeKey(i));if(row&&row.status!=="published")await tx.put(secondaryReviewNoticeKey(i),{...row,status:"published",publishedAt:Date.now(),controlsVersion:0});});
 const row=await storage.get(secondaryReviewNoticeKey(i));
 if(row?.controlsVersion!==2)await refreshSecondaryReviewCard(storage,env,i);
}
export async function handleSecondaryReviewGroupCallback(update,env,cabinetRPC){
 const cb=update?.callback_query;
 if(!cb||typeof cb.data!=="string"||!cb.data.startsWith("srmod:"))return false;
 const match=/^srmod:(approve|edit|cancel):([1-9][0-9]{4,15}):(yan_second|yan_(?:0[3-9]|[12][0-9]|30)):([0-9]{1,9}):([1-9][0-9]{0,7})$/.exec(cb.data);
 let response="Заявка недействительна.";
 if(match&&String(cb.from?.id)===MODERATOR_ID&&String(cb.message?.chat?.id)===MODERATION_CHAT){
  const [,action,userId,accountId,profileId,v]=match;
  try{
   const result=await cabinetRPC(env,userId,{kind:"admin_secondary_review_group_decision",actorId:MODERATOR_ID,action,accountId,profileId,draftVersion:Number(v),messageId:cb.message.message_id});
   response=result?.ok?({approve:"✅ Отзыв передан на публикацию",edit:"✏️ Ответьте на запрос исправленным текстом",cancel:"❌ Отзыв отклонён, списания нет"})[action]:"Заявка уже обработана или публикация заблокирована. Проверьте статус карточки.";
  }catch{response="⏳ Проверяем решение. Повторно отправлять отзыв не нужно.";}
 }
 await moderationTelegram(env,"answerCallbackQuery",{callback_query_id:cb.id,text:response,show_alert:true}).catch(()=>{});return true;
}
export async function handleSecondaryReviewCorrection(update,env,cabinetRPC){
 const msg=update?.message,reply=msg?.reply_to_message;
 if(!Number.isSafeInteger(reply?.message_id)||String(msg?.from?.id)!==MODERATOR_ID||String(msg?.chat?.id)!==MODERATION_CHAT)return false;
 let route;try{route=(await messageIndex(env,"get",reply.message_id)).value?.secondary;}catch{return false;}
 if(!route)return false;
 const text=String(msg.text||"").trim();
 if(text.length<10||text.length>3000){await moderationTelegram(env,"sendMessage",{chat_id:MODERATION_CHAT,text:"⚠️ Укажите текст от 10 до 3000 символов.",reply_parameters:{message_id:msg.message_id}}).catch(()=>{});return true;}
 const result=await cabinetRPC(env,route.userId,{kind:"admin_secondary_review_group_decision",actorId:MODERATOR_ID,action:"replace",accountId:route.accountId,profileId:route.profileId,draftVersion:route.version,messageId:route.messageId,promptId:reply.message_id,text}).catch(()=>({ok:false}));
 if(result?.ok)await moderationTelegram(env,"deleteMessage",{chat_id:MODERATION_CHAT,message_id:msg.message_id}).catch(()=>{});
 else await moderationTelegram(env,"sendMessage",{chat_id:MODERATION_CHAT,text:"⚠️ Исправление не принято. Проверьте состояние заявки.",reply_parameters:{message_id:msg.message_id}}).catch(()=>{});
 return true;
}
