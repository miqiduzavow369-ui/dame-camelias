export const MODERATOR_ID="5866034656";
export const MODERATION_CHAT="-1003900552612";
const validUid=x=>/^[1-9]\d{4,15}$/.test(String(x));
const validTicket=x=>/^[a-f0-9]{16}$/.test(String(x));
const escape=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
// Bound the escaped HTML itself, not the raw text: a review containing many
// ampersands would otherwise exceed Telegram's 4096-character message limit.
function escapeLimited(value,max){
 let result="";
 for(const char of String(value??"")){
  const encoded=escape(char);
  if(result.length+encoded.length>max-1)return result+"…";
  result+=encoded;
 }
 return result;
}
export async function moderationTelegram(env,method,data){
 const response=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
 const body=await response.json();if(!response.ok||!body.ok)throw Error("Moderation Telegram delivery failed");return body.result;
}
export async function moderationRPC(env,userId,ticket,event){
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("review-moderation:v1:"+userId+":"+ticket));
 const response=await object.fetch("https://moderation.internal/",{method:"POST",body:JSON.stringify({type:"review_moderation",userId:String(userId),ticket,event})});
 if(!response.ok)throw Error("Moderation unavailable");return response.json();
}
async function index(env,action,messageId,value){
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("review-moderation-index:v1"));
 const response=await object.fetch("https://moderation.internal/",{method:"POST",body:JSON.stringify({type:"review_moderation_index",action,messageId,value})});
 if(!response.ok)throw Error("Moderation index unavailable");return response.json();
}
export async function moderationIndex(storage,input){
 if(input.action==="history_put"){
  const entry=input.value;
  if(!validUid(entry?.userId)||!validTicket(entry?.ticket)||!["approved","rejected","published"].includes(entry.status))return {ok:false};
  const key="history:"+entry.userId+":"+entry.ticket;
  const previous=await storage.get(key);
  if(previous?.status==="published"&&entry.status==="approved")return {ok:true};
  await storage.put(key,entry);
  return {ok:true};
 }
 if(input.action==="history_list"){
  const entries=await storage.list({prefix:"history:"});
  return {ok:true,items:[...entries.values()].sort((a,b)=>(b.decidedAt||0)-(a.decidedAt||0))};
 }
 if(!Number.isSafeInteger(input.messageId)||input.messageId<=0)return {ok:false};
 const key="message:"+input.messageId;
 if(input.action==="put"&&validUid(input.value?.userId)&&validTicket(input.value?.ticket))await storage.put(key,input.value);
 return {ok:true,value:await storage.get(key)||null};
}
// Persistent, idempotent decision history in the already deployed moderation index DO.
function historyEntry(record){
 return {userId:record.userId,ticket:record.ticket,profileId:record.profileId,account:record.account,
  username:record.username||null,status:record.status==="cancelled"?"rejected":record.status==="published"?"published":"approved",
  text:record.text,originalText:record.originalText||record.text,corrected:(record.revisions||[]).length>0,
  createdAt:record.createdAt,decidedAt:record.decidedAt||Date.now(),publishedAt:record.publishedAt||null};
}
async function persistDecision(storage,env,record){
 const item=historyEntry(record);
 await storage.put("decision_journal_pending",item);
 try{
  const result=await index(env,"history_put",null,item);
  if(!result?.ok)throw Error("history_put_failed");
  await storage.delete("decision_journal_pending");
 }catch{await storage.setAlarm(Date.now()+60000);}
}
export async function moderationHistory(env){
 return index(env,"history_list",null,null);
}
async function callCabinet(env,userId,event){
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("cabinet-events:v1:"+userId));
 const response=await object.fetch("https://cabinet.internal/",{method:"POST",body:JSON.stringify({type:"cabinet_event",userId,event})});
 if(!response.ok)throw Error("Cabinet approval unavailable");return response.json();
}
function card(record){
 const titles={
  pending:"✍️ НОВЫЙ ОТЗЫВ",editing:"✏️ КОРРЕКТИРОВКА ТЕКСТА",
  approving:"⏳ ПОДГОТОВКА ПУБЛИКАЦИИ",approved:"⏳ ОЖИДАЕМ ПОДТВЕРЖДЕНИЕ",
  cancelled:"❌ ОТЗЫВ ОТКЛОНЁН",published:"✅ ОТЗЫВ ОПУБЛИКОВАН",
  delivery_unknown:"⏳ ПРОВЕРКА ДОСТАВКИ"
 };
 const date=at=>Number.isFinite(at)&&at>0?new Date(at).toLocaleString("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
 const label=titles[record.status]||"✍️ ОТЗЫВ";
 const account=record.account==="yan_first"?"Ян Первый":record.account;
 const name=record.username?"@"+record.username:"не указан";
 const history=Array.isArray(record.revisions)?record.revisions:[];
 const parts=[
  "🌹 <b>DAME CAMELIAS</b>",
  "━━━━━━━━━━━━━━━━",
  "<b>"+label+"</b>",
  "",
  "🎫 <b>Заявка:</b> "+escape(record.ticket.slice(0,8).toUpperCase()),
  "🌹 <b>Анкета:</b> №"+escape(record.profileId),
  "👨‍💻 <b>Мужчина:</b> "+escape(account),
  "👤 <b>Клиентка:</b> "+escape(record.userId),
  "💬 <b>Telegram:</b> "+escape(name),
  "🗓 <b>Получен:</b> "+date(record.createdAt)+" МСК",
  ...(record.decidedAt?["🕰 <b>Решение:</b> "+date(record.decidedAt)+" МСК"]:[]),
  "",
  "✍️ <b>"+(history.length?"ИТОГОВЫЙ ТЕКСТ":"ТЕКСТ ОТЗЫВА")+"</b>",
  escapeLimited(record.text,1800),
  ...(history.length?["","✏️ <b>Исправлений:</b> "+history.length,
   "<b>Исходный текст:</b> "+escapeLimited(record.originalText||history[0].text,400)]:[]),
  ...(record.status==="published"?["","📸 <b>Подтверждение:</b> "+(record.proofFileId?"сохранено в архиве":"ожидается")]:[]),
  ...(record.status==="cancelled"?["","🔒 <b>Публикация:</b> отменена, списания нет"]:[]),
  ...(record.note?["","ℹ️ "+escapeLimited(record.note,250)]:[])
 ];
 // Telegram messages have a 4096-character cap. Preserve the current review;
 // bound original text to avoid losing the moderation controls to an oversized card.
 const text=parts.join("\n");
 const action=name=>"reviewmod:"+name+":"+record.userId+":"+record.ticket+":"+record.version;
 const buttons=record.status==="pending"?[
  [{text:"✅ Опубликовать",callback_data:action("approve")}],
  [{text:"✏️ Скорректировать",callback_data:action("edit")}],
  [{text:"❌ Отклонить",callback_data:action("cancel")}]
 ]:record.status==="editing"?[
  [{text:"❌ Отклонить",callback_data:action("cancel")}]
 ]:[];
 return {chat_id:MODERATION_CHAT,text,parse_mode:"HTML",reply_markup:{inline_keyboard:buttons}};
}

async function refresh(env,send,record){
 try{await send(env,"editMessageText",{...card(record),message_id:record.messageId});}catch{ /* State, not a stale Telegram button, decides access. */ }
}
async function registerMessage(storage,env,record,id,register){
 try{await register(env,"put",id,{userId:record.userId,ticket:record.ticket});}
 catch{record.indexPending=[...new Set([...(record.indexPending||[]),id])];await storage.put("moderation",record);await storage.setAlarm(Date.now()+1000);}
}
export async function moderationEvent(storage,env,input,send=moderationTelegram,cabinet=callCabinet,register=index){
 const uid=String(input.userId),ticket=String(input.ticket),event=input.event||{};
 if(!validUid(uid)||!validTicket(ticket))return {ok:false};
 let record=await storage.get("moderation");
 if(event.action==="enqueue"){
  if(record)return {ok:record.status!=="delivery_unknown",already:true,status:record.status};
  if(!/^\d{1,9}$/.test(String(event.profileId))||event.account!=="yan_first"||typeof event.text!=="string"||event.text.length<10||event.text.length>3000)return {ok:false};
  record={userId:uid,ticket,profileId:String(event.profileId),account:event.account,text:event.text,username:/^[A-Za-z0-9_]{1,32}$/.test(event.username||"")?event.username:null,status:"delivery_unknown",version:1,createdAt:Date.now(),revisions:[]};
  await storage.put("moderation",record);
  const delivered=await send(env,"sendMessage",card({...record,status:"pending"}));
  if(!Number.isSafeInteger(delivered?.message_id))return {ok:false};
  record={...record,messageId:delivered.message_id,status:"pending",originalText:record.text};await storage.put("moderation",record);
  await registerMessage(storage,env,record,record.messageId,register);return {ok:true};
 }
 if(!record)return {ok:false};
 if(event.action==="published"){
  if(event.proofDelivered!==true||event.profileId!==record.profileId||!["approving","approved","published"].includes(record.status))return {ok:false};
  record.proofFileId=typeof event.proofFileId==="string"&&event.proofFileId.length<300?event.proofFileId:null;record.status="published";record.publishedAt=record.publishedAt||Date.now();await storage.put("moderation",record);
  await persistDecision(storage,env,record);await storage.setAlarm(Date.now()+1000);return {ok:true};
 }
 if(event.actorId!==MODERATOR_ID||String(event.chatId)!==MODERATION_CHAT)return {ok:false,forbidden:true};
 const editingReply=event.action==="replace";
 if(editingReply){
  if(record.status!=="editing"||![record.messageId,record.editPromptId].includes(event.replyTo)||typeof event.text!=="string"||event.text.trim().length<10||event.text.trim().length>3000)return {ok:false,note:"Ответьте на запрос корректировки текстом от 10 до 3000 символов."};
  record.revisions.push({text:record.text,at:Date.now(),actorId:MODERATOR_ID});record.text=event.text.trim();record.status="pending";record.version++;record.note=null;record.correctedAt=Date.now();
  const editPromptId=record.editPromptId;record.editPromptId=null;
  await storage.put("moderation",record);await refresh(env,send,record);
  if(Number.isSafeInteger(event.messageId))await send(env,"deleteMessage",{chat_id:MODERATION_CHAT,message_id:event.messageId}).catch(()=>{});
  if(editPromptId)await send(env,"deleteMessage",{chat_id:MODERATION_CHAT,message_id:editPromptId}).catch(()=>{});
  return launchApproval(storage,env,record,send,cabinet);

 }
 if(event.messageId!==record.messageId||event.version!==record.version||!["pending","editing"].includes(record.status))return {ok:false,note:"Эта кнопка уже обработана. Используйте актуальную заявку."};
 if(event.action==="edit"&&record.status==="pending"){
  record.status="editing";record.version++;await storage.put("moderation",record);await refresh(env,send,record);
  const prompt=await send(env,"sendMessage",{chat_id:MODERATION_CHAT,text:record.text,reply_parameters:{message_id:record.messageId},reply_markup:{force_reply:true,selective:true}});
  record.editPromptId=prompt.message_id;await storage.put("moderation",record);await registerMessage(storage,env,record,prompt.message_id,register);return {ok:true};
 }
 if(event.action==="cancel"){
  // Decision is durable before notifying the cabinet; never changes into approval.
  const editPromptId=record.editPromptId;record.editPromptId=null;record.status="cancelled";record.version++;record.decidedAt=Date.now();record.cancelPending=true;await storage.put("moderation",record);await persistDecision(storage,env,record);await refresh(env,send,record);
  if(editPromptId)await send(env,"deleteMessage",{chat_id:MODERATION_CHAT,message_id:editPromptId}).catch(()=>{});
  try{const result=await cabinet(env,uid,{kind:"review_moderation",actorId:MODERATOR_ID,action:"cancel",ticket});if(result.ok){record.cancelPending=false;await storage.put("moderation",record);}}catch{}
  if(record.cancelPending)await storage.setAlarm(Date.now()+1000);return {ok:true};
 }
 if(event.action!=="approve"||record.status!=="pending")return {ok:false};
 return launchApproval(storage,env,record,send,cabinet);
}
async function launchApproval(storage,env,record,send,cabinet){
 const uid=record.userId,ticket=record.ticket;
 if(env.CABINET_PUBLICATIONS_ENABLED==="false"||uid!==MODERATOR_ID&&env.CABINET_CLIENTS_ENABLED==="false")return {ok:false,note:"Публикации сейчас отключены."};
 record.status="approving";record.version++;record.decidedAt=Date.now();await storage.put("moderation",record);await refresh(env,send,record);
 let result;
 try{result=await cabinet(env,uid,{kind:"review_moderation",actorId:MODERATOR_ID,action:"approve",ticket,text:record.text});}
 catch{record.note="Результат запуска уточняется. Повторной автоматической отправки не будет.";await storage.put("moderation",record);await refresh(env,send,record);return {ok:false,note:record.note};}
 if(result.ok){record.status="approved";record.note=result.note||null;}else{record.status="pending";record.note=result.note||"Сейчас отправка недоступна. Проверьте доступ, баланс и лимит анкеты.";}
 await storage.put("moderation",record);if(result.ok)await persistDecision(storage,env,record);await refresh(env,send,record);return result;
}
export async function moderationAlarm(storage,env,send=moderationTelegram){
 const pending=await storage.get("decision_journal_pending");
 if(pending){
  try{const done=await index(env,"history_put",null,pending);if(!done?.ok)throw Error("history_pending");await storage.delete("decision_journal_pending");}
  catch{await storage.setAlarm(Date.now()+60000);}
 }

 const record=await storage.get("moderation");if(!record)return false;
 for(const id of [...(record.indexPending||[])]){try{await index(env,"put",id,{userId:record.userId,ticket:record.ticket});record.indexPending=record.indexPending.filter(x=>x!==id);}catch{}}
 if(record.cancelPending){try{const result=await callCabinet(env,record.userId,{kind:"review_moderation",actorId:MODERATOR_ID,action:"cancel",ticket:record.ticket});if(result.ok)record.cancelPending=false;}catch{}}
 await storage.put("moderation",record);
 if(record.cancelPending||record.indexPending?.length)await storage.setAlarm(Date.now()+60000);
 if(record.status!=="published"||record.notificationSent)return true;
 const link="https://t.me/c/"+MODERATION_CHAT.slice(4)+"/"+record.messageId;
 // Mark an attempt first: an ambiguous timeout must not create duplicate reports.
 if(record.notificationAttempted)return true;
 record.notificationAttempted=Date.now();await storage.put("moderation",record);
 try{await refresh(env,send,record);if(!record.proofFileId)return true;await send(env,"sendPhoto",{chat_id:MODERATION_CHAT,photo:record.proofFileId,caption:"✅ ОПУБЛИКОВАНО",reply_parameters:{message_id:record.messageId}});record.notificationSent=Date.now();await storage.put("moderation",record);}catch{ /* Retain the durable uncertain attempt; never repeat a publication. */ }
 return true;
}
export async function handleModeration(update,env,send=moderationTelegram){
 const callback=update.callback_query,message=update.message,chat=callback?.message?.chat||message?.chat,actor=callback?.from||message?.from;
 const match=/^reviewmod:(approve|cancel|edit):([1-9]\d{4,15}):([a-f0-9]{16}):(\d{1,6})$/.exec(callback?.data||"");
 if(callback?.data?.startsWith("reviewmod:")){
  if(!match||String(chat?.id)!==MODERATION_CHAT||String(actor?.id)!==MODERATOR_ID||actor?.is_bot){await send(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"Решение доступно только администратору.",show_alert:true});return true;}
  await send(env,"answerCallbackQuery",{callback_query_id:callback.id});
  const result=await moderationRPC(env,match[2],match[3],{action:match[1],actorId:MODERATOR_ID,chatId:MODERATION_CHAT,messageId:callback.message.message_id,version:Number(match[4])});
  if(!result.ok&&result.note)await send(env,"sendMessage",{chat_id:MODERATION_CHAT,text:"🌹 DAME CAMELIAS\n\n🌷 "+result.note,reply_parameters:{message_id:callback.message.message_id}});
  return true;
 }
 if(String(chat?.id)===MODERATION_CHAT&&String(actor?.id)===MODERATOR_ID&&!actor?.is_bot&&message?.reply_to_message&&typeof message.text==="string"){
  const found=await index(env,"get",message.reply_to_message.message_id);
  if(!found.value)return false;
  const result=await moderationRPC(env,found.value.userId,found.value.ticket,{action:"replace",actorId:MODERATOR_ID,chatId:MODERATION_CHAT,replyTo:message.reply_to_message.message_id,messageId:message.message_id,text:message.text});
  if(!result.ok&&result.note)await send(env,"sendMessage",{chat_id:MODERATION_CHAT,text:"🌷 "+result.note,reply_parameters:{message_id:message.message_id}});
  return true;
 }
 return false;
}
