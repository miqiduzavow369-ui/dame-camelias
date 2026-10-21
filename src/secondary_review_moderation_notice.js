// Secondary men's review moderation: same Telegram group as Yan First.
// Saving is NOT moderation approval, a website submission or credit debit.
import {MODERATION_CHAT,MODERATOR_ID,moderationTelegram} from "./review_moderation.js";
import {manStorageKey} from "./man_account_isolation.js";
const esc=x=>String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const key=i=>manStorageKey({...i,scope:"moderation"})+":review-notification";
export function moderationCallback(i,version){
 return ["srmod","approve",i.userId,i.accountId,i.profileId,String(version)].join(":");
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
  if(prev?.version===draft.version&&["sending","delivered","uncertain"].includes(prev.status))
   return false;
  await tx.put(id,{version:draft.version,status:"sending",at});
  return true;
 });
 if(!claim)return {ok:true,already:true};
 try{
  if(!env.BOT_TOKEN)throw Error("Telegram token missing");
  const text=["🌹 <b>DAME CAMELIAS</b>","━━━━━━━━━━━━━━━━",
   "✍️ <b>НОВЫЙ ОТЗЫВ — СОГЛАСОВАНИЕ</b>",
   "🌹 <b>Анкета:</b> №"+esc(i.profileId),
   "👨‍💻 <b>Мужчина:</b> "+esc(i.accountId),
   "👤 <b>Клиентка:</b> "+esc(i.userId),"",
   "✍️ <b>ТЕКСТ ОТЗЫВА</b>",esc(draft.text).slice(0,3200),
   "","🔒 Публикации и списания пока нет."].join("\n");
  const result=await moderationTelegram(env,"sendMessage",{
   chat_id:MODERATION_CHAT,text,parse_mode:"HTML",
   reply_markup:{inline_keyboard:[[{text:"✅ Согласовать отзыв",
    callback_data:moderationCallback(i,draft.version)}]]}
  });
  if(!Number.isSafeInteger(result?.message_id))throw Error("Telegram message ID missing");
  await storage.transaction(async tx=>{
   const state=await tx.get(id);
   if(state?.version===draft.version&&state.status==="sending")
    await tx.put(id,{...state,status:"delivered",messageId:result.message_id,deliveredAt:Date.now()});
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
 const matches=/^srmod:approve:([1-9][0-9]{4,15}):(yan_second|yan_(?:0[3-9]|[12][0-9]|30)):([0-9]{1,9}):([1-9][0-9]{0,7})$/.exec(cb.data);
 let response="Заявка недействительна.";
 const allowed=matches&&String(cb.from?.id)===MODERATOR_ID&&
  String(cb.message?.chat?.id)===MODERATION_CHAT;
 if(allowed){
  const [,userId,accountId,profileId,v]=matches,version=Number(v);
  try{
   const checked=await cabinetRPC(env,userId,{
    kind:"admin_secondary_review_group_approve",actorId:MODERATOR_ID,
    accountId,profileId,draftVersion:version,
    messageId:cb.message.message_id});
   response=checked?.ok===true?"✅ Согласовано. Клиент может подтвердить публикацию.":"Не удалось согласовать: заявка устарела или изменена.";
   if(checked?.ok===true){
    await moderationTelegram(env,"editMessageReplyMarkup",{
     chat_id:MODERATION_CHAT,message_id:cb.message.message_id,
     reply_markup:{inline_keyboard:[]}
    }).catch(()=>{});
   }
  }catch{response="Ошибка проверки заявки. Публикация не запускалась.";}
 }
 await moderationTelegram(env,"answerCallbackQuery",{callback_query_id:cb.id,text:response,
  show_alert:true}).catch(()=>{});
 return true;
}
