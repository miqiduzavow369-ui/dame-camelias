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
import {readManSetupDrafts,changeManSetupDraft,readManSetupHistory} from "./man_setup_store.js";
import {proxyStatus,saveProxy} from "./man_proxy_vault.js";
import {readSiteStatus,saveSiteCredentials} from "./man_site_vault.js";
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
  if(!env.ANKETA_CALLBACK_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)return new Response("Forbidden",{status:403});
  body=request.method==="POST"?await request.clone().json().catch(()=>null):null;
  uid=String(body?.user_id||new URL(request.url).searchParams.get("user_id")||OWNER_ID);
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
 if(event.kind==="admin_man_site_status"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await readSiteStatus(storage,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:event.accountId});}
   catch{return {ok:false,status:400,reason:"invalid_account"};}
 }
 if(event.kind==="admin_man_site_save"){
   if(uid!==OWNER_ID||event.actorId!==OWNER_ID)return {ok:false,status:403};
   try{return await saveSiteCredentials(storage,rawEnv,{actorId:event.actorId,cabinetId:uid,ownerId:OWNER_ID,
     accountId:event.accountId,expectedVersion:event.expectedVersion,settings:event.settings,at:Date.now()});}
   catch(e){const message=String(e.message);return {ok:false,status:409,
     reason:message==="Site vault key not configured"?"site_vault_key_missing":
      message==="Verified proxy required"?"proxy_not_verified":"site_save_rejected"};}
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
   return {...inventory,accounts:inventory.accounts.map(x=>({
     ...x,setup:staged.get(x.id)??null,networkStatus:proxyMap.get(x.id)??null,
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
 if(event.kind==="mini_review_action"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  if(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false")return {ok:false,reason:"disabled"};
  return engine.miniReviewAction(env,String(event.profileId||""),event.action,event.text);
 }
 if(event.kind==="mini_review_draft"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  return engine.miniReviewDraft(env,String(event.profileId||""),event.action,event.text);
 }
 if(event.kind==="mini_rating_action"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  if(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false")return {ok:false,reason:"disabled"};
  return engine.miniRatingAction(env,String(event.profileId||""),event.action);
 }
 if(event.kind==="mini_rating_open"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  if(rawEnv.CABINET_PUBLICATIONS_ENABLED==="false")return {ok:false,reason:"disabled"};
  return engine.miniRatingOpen(env,String(event.profileId||""));
 }
 if(event.kind==="mini_rating_form"){
  if(uid!==OWNER_ID){
   if(!client?.active||rawEnv.CABINET_CLIENTS_ENABLED==="false"||
      (await agreementStatus(env,uid)).status!=="accepted")return {ok:false,status:403};
   // The HTTP endpoint validates signed Telegram initData; no legacy PIN session is needed.
  }
  return engine.miniRatingFormLoad(env,String(event.profileId||""));
 }
 if(event.kind==="mini_rating_save"){
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
  if(!/^\d{1,9}$/.test(id)||!["rating","review"].includes(kind)||!["yan_first","yan_second"].includes(account))return {ok:false,status:400};
  const archive=await readPublicationArchive(storage,rawEnv.VISITORS_KV,uid);
  const entry=archive.items.find(item=>String(item.profileId)===id&&item.kind===kind&&item.account===account);
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
    if((archive.items||[]).some(item=>String(item.profileId)===String(id)&&item.kind===kind))
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
  return {ok:true,profiles,history,activities,workflow,finance:finance?.ok?finance:null,financeStatus:finance?.ok?"ready":financeError||"ledger_unavailable",balance:balance?{available:balance.available,reserved:balance.reserved,spent:balance.spent,remaining:balance.remaining}:null};
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
