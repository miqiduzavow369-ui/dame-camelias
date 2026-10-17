import {registry,OWNER_ID} from "./client_registry.js";
export const AGREEMENT_VERSION="2026-10-15-v1";
export const AGREEMENT_SECTIONS=[
 {title:"Общие правила публикации отзывов",body:"Уважаемые девушки! Для поддержания честной конкуренции и уважительной атмосферы на сайте действуют единые правила публикации отзывов и оценок.\nЗапрещается использовать отзывы для дискредитации других девушек"},
 {title:"Запрет на оскорбления и негатив\nв адрес конкуренток",body:"Запрещается оставлять оскорбительные, провокационные и унизительные комментарии в адрес других девушек, в том числе под собственной анкетой.\nТакже запрещается намеренно публиковать негативные отзывы и занижать оценки под анкетами конкуренток с целью ухудшения их репутации."},
 {title:"Требования к содержанию отзывов",body:"В текстах отзывов запрещается:\n\n• Злоупотреблять нецензурной лексикой.\n\n• Использовать эмодзи и смайлики.\n\n• Писать рекламные заявления вроде «Я лучшая на сайте», «Лучше меня никого нет» и подобные."},
 {title:"Ограничения на отзывы и оценки",body:"Разрешается оставлять не более одного отзыва и одной оценки на одну анкету в течение суток.\nОграничение действует независимо от количества используемых аккаунтов."},
 {title:"Модерация и корректировка отзывов",body:"Все поступающие отзывы проходят обязательную проверку администрацией бота перед публикацией на сайте.\nАдминистрация оставляет за собой право корректировать, сокращать или отклонять отзывы, нарушающие установленные правила.\nПри корректировке сохраняется первоначальный смысл допустимой части отзыва. Отправка отзыва не гарантирует его публикацию."},
 {title:"Ответственность за нарушение правил",body:"За нарушение перечисленных требований администрация вправе вынести предупреждение, удалить отзыв или временно ограничить доступ к кабинету.\nПри грубых или систематических нарушениях возможна бессрочная блокировка личного кабинета и доступа к боту без возврата денежных средств за оставшийся оплаченное количество публикации.\n\nПросим соблюдать правила и уважительно относиться к другим участницам площадки."}
];
const validUid=x=>/^[1-9]\d{4,15}$/.test(String(x));
const escape=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const date=value=>new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(value));
const section=s=>"<b>"+escape(s.title)+"</b>\n\n"+escape(s.body);
async function telegram(env,method,data){
 const response=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...data,...(["sendMessage"].includes(method)?{protect_content:String(data.chat_id)!==OWNER_ID}:{})}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(!response.ok||!result.ok)throw Error("Agreement Telegram delivery failed");return result.result;
}
export async function agreementRPC(env,userId,event){
 const uid=String(userId);if(!validUid(uid))throw Error("Invalid agreement identity");
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("agreement:v1:"+uid));
 const response=await object.fetch("https://agreement.internal/",{method:"POST",body:JSON.stringify({type:"agreement",userId:uid,event})});
 if(!response.ok)throw Error("Agreement unavailable");return response.json();
}
export async function agreementStatus(env,uid){try{return await agreementRPC(env,uid,{action:"status"});}catch{return {status:"unknown"};}}
export const agreementLabel=result=>result.status==="accepted"?"✅ Соглашение подписано":result.status==="declined"?"❌ Отказалась от соглашения":result.status==="unknown"?"⏳ Статус соглашения недоступен":"➖ Соглашение ещё не принято";
export function signedAgreement(record){
 return "🌹 <b>DAME CAMELIAS</b>\n\n📜 <b>ПОДПИСАННОЕ СОГЛАШЕНИЕ</b>\n\n"+record.sections.map(section).join("\n\n━━━━━━━━━━━━\n\n")+"\n\n━━━━━━━━━━━━\n\n🆔 <b>Подписан ID:</b> "+escape(record.userId)+"\n📅 <b>Дата согласия:</b> "+escape(date(record.acceptedAt))+" (Москва)";
}
export async function agreementEvent(storage,env,input,send=telegram,now=Date.now()){
 const uid=String(input.userId),event=input.event||{};if(!validUid(uid))return {handled:true};
 const accepted=await storage.get("accepted");
 if(event.action==="view")return accepted?{status:"accepted",version:accepted.version,acceptedAt:accepted.acceptedAt,userId:uid,sections:accepted.sections||AGREEMENT_SECTIONS}:{status:"not_accepted"};
 if(event.action==="status")return accepted?{status:"accepted",version:accepted.version,acceptedAt:accepted.acceptedAt}:{status:await storage.get("declinedAt")?"declined":"not_accepted"};
 let flow=await storage.get("flow"),navigation=await storage.get("navigation");
 const remove=async id=>{if(Number.isSafeInteger(id)&&id>0)await send(env,"deleteMessage",{chat_id:uid,message_id:id}).catch(()=>{});};
 const close=async()=>{await remove(navigation?.id);await storage.delete("navigation");await storage.delete("flow");};
 const say=async(text,rows)=>{
  const payload={chat_id:uid,text,parse_mode:"HTML",reply_markup:{inline_keyboard:rows}};
  if(navigation?.id){try{const edited=await send(env,"editMessageText",{...payload,message_id:navigation.id});if(edited)return;}catch{}}
  const result=await send(env,"sendMessage",payload);
  if(Number.isSafeInteger(result?.message_id)){await remove(navigation?.id);navigation={id:result.message_id};await storage.put("navigation",navigation);}
 };
 const screen=async()=>{
  const s=AGREEMENT_SECTIONS[flow.step],last=flow.step===AGREEMENT_SECTIONS.length-1;
  const suffix=flow.token+":"+flow.step;
  await say("🌹 <b>DAME CAMELIAS</b>\n\n📜 <b>СОГЛАШЕНИЕ · "+(flow.step+1)+" / 6</b>\n\n"+section(s),[[{text:last?"✅ Принимаю соглашение":"✅ Согласна",callback_data:"agreement:"+(last?"accept:":"yes:")+suffix}],[{text:"❌ Не согласна",callback_data:"agreement:no:"+suffix}]]);
 };
 if(event.action==="leave"){await close();return {handled:false};}
 if(event.action==="back"){
  await close();const {client}=uid===OWNER_ID?{client:{active:true}}:await registry(env,{action:"get",userId:uid});
  return client?.active?{handled:true,cabinet:true}:{handled:true,home:true};
 }
 if(event.action==="signed"){
  const {client}=uid===OWNER_ID?{client:{active:true}}:await registry(env,{action:"get",userId:uid});
  if(!accepted||!client?.active){await close();return {handled:true,home:true};}
  await storage.delete("flow");await say(signedAgreement(accepted),[[{text:"🌹 Вернуться к анкетам",callback_data:"agreement:back"}]]);
  if(event.sourceMessageId!==navigation?.id)await remove(event.sourceMessageId);return {handled:true};
 }
 if(event.action==="start"){
  flow={step:0,token:crypto.randomUUID().replace(/-/g,"").slice(0,16)};await storage.put("flow",flow);await screen();
  if(event.sourceMessageId!==navigation?.id)await remove(event.sourceMessageId);return {handled:true};
 }
 if(!flow||flow.token!==event.token||event.sourceMessageId!==navigation?.id)return {handled:true};
 if(event.action==="no"){
  if(!accepted)await storage.put("declinedAt",now);
  await close();return {handled:true,home:true};
 }
 if(event.step!==flow.step){await screen();return {handled:true};}
 if(event.action==="yes"&&flow.step<AGREEMENT_SECTIONS.length-1){flow={...flow,step:flow.step+1};await storage.put("flow",flow);await screen();return {handled:true};}
 if(event.action==="accept"&&flow.step===AGREEMENT_SECTIONS.length-1){
  if(!accepted)await storage.put("accepted",{userId:uid,acceptedAt:now,version:AGREEMENT_VERSION,sections:structuredClone(AGREEMENT_SECTIONS)});
  await close();return {handled:true,home:true};
 }
 return {handled:true};
}
export async function handleAgreement(update,env,send=telegram){
 const cb=update.callback_query,action=cb?.data||"",actor=cb?.from,chat=cb?.message?.chat;
 if(!action.startsWith("agreement:")){
  if(action==="home"&&actor&&!actor.is_bot&&chat?.type==="private"&&String(chat.id)===String(actor.id))await agreementRPC(env,actor.id,{action:"leave"});
  return false;
 }
 if(!actor||actor.is_bot||chat?.type!=="private"||String(chat.id)!==String(actor.id)||!validUid(actor.id)){await send(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Откройте соглашение в личном чате с ботом."});return {handled:true};}
 await send(env,"answerCallbackQuery",{callback_query_id:cb.id});
 const simple=/^agreement:(start|signed|back)$/.exec(action),step=/^agreement:(yes|no|accept):([a-f0-9]{16}):([0-5])$/.exec(action);
 if(!simple&&!step)return {handled:true};
 return agreementRPC(env,actor.id,{action:simple?.[1]||step[1],...(step?{token:step[2],step:Number(step[3])}:{}),sourceMessageId:cb.message.message_id});
}
