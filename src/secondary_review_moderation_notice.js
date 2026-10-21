// Secondary men's review moderation: same Telegram group as Yan First.
// Saving is NOT moderation approval, a website submission or credit debit.
import {MODERATION_CHAT,MODERATOR_ID,moderationTelegram} from "./review_moderation.js";
import {manStorageKey} from "./man_account_isolation.js";
const esc=x=>String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function escLimited(x,max){let out="";for(const ch of String(x)){const bit=esc(ch);if(out.length+bit.length>max-1)return out+"…";out+=bit;}return out;}
export const secondaryReviewNoticeKey=i=>manStorageKey({...i,scope:"moderation"})+":review-notification";
const key=secondaryReviewNoticeKey;
export function moderationCallback(i,version,action="approve"){
 return ["srmod",action,i.userId,i.accountId,i.profileId,String(version)].join(":");
}
export function secondaryModerationButtons(i,version,status="delivered"){
 if(status!=="delivered")return {inline_keyboard:[]};
 return {inline_keyboard:[
  [{text:"✅ Опубликовать",callback_data:moderationCallback(i,version,"approve")}],
  [{text:"✏️ Скорректировать",callback_data:moderationCallback(i,version,"edit")}],
  [{text:"❌ Отклонить",callback_data:moderationCallback(i,version,"cancel")}]
 ]};
}

export async function ensureSecondaryReviewGroupNotice(storage,env,i){
 const draft=await storage.get(manStorageKey({...i,scope:"review-draft"})+":review");
 if(!draft||draft.authorAttested!==true||draft.userId!==i.userId||
    draft.accountId!==i.accountId||draft.profileId!==i.profileId||
    typeof draft.text!=="string"||draft.text.length<10||draft.text.length>3000)
  return {ok:false,reason:"secondary_review_draft_missing"};
 const id=key(i),at=Date.now();
 const claim=await storage.transaction(async tx=>{
  const prev=await tx.get(id);
  if(prev?.version===draft.version&&["sending","delivered","uncertain","editing","approved","cancelled","corrected"].includes(prev.status))
   return false;
  await tx.put(id,{version:draft.version,status:"sending",at});
  return true;
 });
 if(!claim){
  const prior=await storage.get(id);
  if(prior?.status==="delivered"&&prior.version===draft.version&&
     Number.isSafeInteger(prior.messageId)&&!prior.controlsUpdated){
   try{
    await moderationTelegram(env,"editMessageReplyMarkup",{
     chat_id:MODERATION_CHAT,message_id:prior.messageId,
     reply_markup:secondaryModerationButtons(i,draft.version)
    });
    await storage.put(id,{...prior,controlsUpdated:true});
   }catch{return {ok:false,reason:"secondary_review_controls_update_unavailable"};}
  }
  return {ok:true,already:true};
 }
 try{
  if(!env.BOT_TOKEN)throw Error("Telegram token missing");
  const text=["🌹 <b>DAME CAMELIAS</b>","━━━━━━━━━━━━━━━━",
   "✍️ <b>НОВЫЙ ОТЗЫВ — СОГЛАСОВАНИЕ</b>",
   "🌹 <b>Анкета:</b> №"+esc(i.profileId),
   "👨‍💻 <b>Мужчина:</b> "+esc(i.accountId),
   "👤 <b>Клиентка:</b> "+esc(i.userId),"",
   "✍️ <b>ТЕКСТ ОТЗЫВА</b>",escLimited(draft.text,3100),
   "","🔒 Публикации и списания пока нет."].join("\n");
  const result=await moderationTelegram(env,"sendMessage",{
   chat_id:MODERATION_CHAT,text,parse_mode:"HTML",
   reply_markup:secondaryModerationButtons(i,draft.version)
  });
  if(!Number.isSafeInteger(result?.message_id))throw Error("Telegram message ID missing");
  await storage.transaction(async tx=>{
   const state=await tx.get(id);
   if(state?.version===draft.version&&state.status==="sending")
    await tx.put(id,{...state,status:"delivered",messageId:result.message_id,deliveredAt:Date.now(),controlsUpdated:true});
  });
  return {ok:true,notified:true};
 }catch{
  // Network error could mean Telegram delivered without acknowledging.
  // Avoid blind retries and keep exact draft and a diagnosable state.
  await storage.transaction(async tx=>{
   const state=await tx.get(id);
   if(state?.version===draft.version&&state.status==="sending")
    await tx.put(id,{...state,status:"uncertain",at:Date.now()});
  });
  return {ok:false,reason:"secondary_review_group_delivery_uncertain"};
 }
}
export async function verifySecondaryReviewGroupDecision(storage,i,{version,messageId}){
 const row=await storage.get(key(i));
 return row?.status==="delivered"&&row.version===version&&row.messageId===messageId;
}
export async function handleSecondaryReviewGroupCallback(update,env,cabinetRPC){
 const cb=update?.callback_query;
 if(!cb||typeof cb.data!=="string"||!cb.data.startsWith("srmod:"))return false;
 const matches=/^srmod:(approve|edit|cancel):([1-9][0-9]{4,15}):(yan_second|yan_(?:0[3-9]|[12][0-9]|30)):([0-9]{1,9}):([1-9][0-9]{0,7})$/.exec(cb.data);
 let response="Заявка недействительна.";
 const allowed=matches&&String(cb.from?.id)===MODERATOR_ID&&
  String(cb.message?.chat?.id)===MODERATION_CHAT;
 if(allowed){
  const [,action,userId,accountId,profileId,v]=matches,version=Number(v);
  try{
   const checked=await cabinetRPC(env,userId,{
    kind:"admin_secondary_review_group_decision",actorId:MODERATOR_ID,
    action,accountId,profileId,draftVersion:version,
    messageId:cb.message.message_id});
   response=checked?.ok===true?
    ({approve:"✅ Отзыв согласован",edit:"✏️ Ответьте новым текстом на запрос корректировки",
      cancel:"✅ Заявка отклонена"})[action]:
    "Заявка уже обработана или текст изменён.";
   if(checked?.ok===true){
    if(action==="edit"){
     const prompt=await moderationTelegram(env,"sendMessage",{
      chat_id:MODERATION_CHAT,
      text:"✏️ Ответьте на это сообщение исправленным текстом (10–3000 символов).\n"+
       "srmod-edit:"+userId+":"+accountId+":"+profileId+":"+version,
      reply_parameters:{message_id:cb.message.message_id},
      reply_markup:{force_reply:true,selective:true}
     });
     await cabinetRPC(env,userId,{
      kind:"admin_secondary_review_group_prompt",actorId:MODERATOR_ID,
      accountId,profileId,draftVersion:version,messageId:cb.message.message_id,
      promptId:prompt.message_id
     });
    }else{
     await moderationTelegram(env,"editMessageReplyMarkup",{
      chat_id:MODERATION_CHAT,message_id:cb.message.message_id,
      reply_markup:{inline_keyboard:[]}
     }).catch(()=>{});
     await moderationTelegram(env,"sendMessage",{
      chat_id:MODERATION_CHAT,
      text:action==="cancel"?"❌ Отзыв отклонён. Публикации и списания нет.":"✅ Отзыв согласован. Ожидается подтверждение отправки.",
      reply_parameters:{message_id:cb.message.message_id}
     }).catch(()=>{});
    }
   }
  }catch{response="Ошибка проверки заявки. Публикация не запускалась.";}
 }
 await moderationTelegram(env,"answerCallbackQuery",{callback_query_id:cb.id,text:response,
  show_alert:true}).catch(()=>{});
 return true;
}

/** Like Yan First: moderator corrects by replying to a forced-reply prompt.
 * An edited author's review needs their fresh attestation before publication. */
export async function handleSecondaryReviewCorrection(update,env,cabinetRPC){
 const msg=update?.message,reply=msg?.reply_to_message;
 const match=/^✏️[^\n]*\nsrmod-edit:([1-9][0-9]{4,15}):(yan_second|yan_(?:0[3-9]|[12][0-9]|30)):([0-9]{1,9}):([1-9][0-9]{0,7})$/.exec(reply?.text||"");
 if(!match||String(msg.chat?.id)!==MODERATION_CHAT||
   String(msg.from?.id)!==MODERATOR_ID)return false;
 const [,userId,accountId,profileId,v]=match,text=String(msg.text||"").trim();
 if(text.length<10||text.length>3000){
  await moderationTelegram(env,"sendMessage",{
   chat_id:MODERATION_CHAT,text:"⚠️ Укажите текст от 10 до 3000 символов.",
   reply_parameters:{message_id:msg.message_id}
  }).catch(()=>{});
  return true;
 }
 const result=await cabinetRPC(env,userId,{
  kind:"admin_secondary_review_group_replace",actorId:MODERATOR_ID,
  accountId,profileId,draftVersion:Number(v),promptId:reply.message_id,
  text
 }).catch(()=>({ok:false}));
 await moderationTelegram(env,"sendMessage",{
  chat_id:MODERATION_CHAT,
  text:result?.ok?"✅ Исправленный текст сохранён. Автор должен подтвердить его перед публикацией.":
    "⚠️ Исправление не принято: заявка уже обработана.",
  reply_parameters:{message_id:msg.message_id}
 }).catch(()=>{});
 return true;
}
