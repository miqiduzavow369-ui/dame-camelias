import {validWebApp} from "./telegram_auth.js";
import {createCabinet} from "./owner_anketa.js";
import {registry,OWNER_ID,TRIAL_ID,validId,pinRecord} from "./client_registry.js";
import {credits,adjustCredits} from "./publication_credits.js";
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
 const result=await response.json();if(!response.ok||!result.ok)throw Error("Telegram delivery failed");return result.result;
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
async function clearAdminNavigation(storage,env,send){
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
 const say=async(value,rows=[])=>{
  const previous=await storage.get("admin_navigation");
  const sent=await send(env,"sendMessage",{chat_id:uid,text:value,reply_markup:{inline_keyboard:[...rows,[{text:"👥 Клиенты",callback_data:"clients:list"}],[{text:"⬅️ В кабинет",callback_data:"clients:cancel"}]]}});
  if(Number.isSafeInteger(sent?.message_id)){
   await storage.put("admin_navigation",sent.message_id);
   if(Number.isSafeInteger(previous)&&previous!==sent.message_id)await send(env,"deleteMessage",{chat_id:uid,message_id:previous}).catch(()=>{});
  }
  return sent;
 };
 if(update.callback_query)await send(env,"answerCallbackQuery",{callback_query_id:update.callback_query.id});
 if(action==="clients:cancel"||action.startsWith("owner_anketa:")){await storage.delete("admin_pending");await clearAdminNavigation(storage,env,send);return action==="clients:cancel"?"cabinet":false;}
 if(action==="clients:add"){
  await storage.put("admin_pending",{mode:"id",expires:Date.now()+600000});await say("➕ ДОБАВИТЬ КЛИЕНТА\n\nПришлите Telegram ID клиента.");return true;
 }
 if(action==="clients:list"){
  await storage.delete("admin_pending");const result=await registry(env,{action:"list",actorId:uid});
  await say("👥 КЛИЕНТЫ\n\nВыберите клиента для управления.",result.clients.map(c=>[{text:(c.active?"🟢 ":"🔒 ")+c.id,callback_data:"clients:view:"+c.id}]));return true;
 }
 const view=/^clients:view:(\d{5,16})$/.exec(action);
 if(view){
  await storage.delete("admin_pending");const {client:c}=await registry(env,{action:"get",userId:view[1]});
  if(!c){await say("Клиент не найден.");return true;}
  const b=await credits(env,c.id,"status");
  await say("👤 "+c.id+"\n"+(c.active?"🟢 Доступ открыт":"🔒 Доступ приостановлен")+"\n💎 Доступно: "+b.available+" · использовано: "+b.spent+" · в резерве: "+b.reserved,[
    [{text:c.active?"⏸ Приостановить":"▶️ Восстановить",callback_data:"clients:"+(c.active?"suspend:":"resume:")+c.id}],
    [{text:"💎 Добавить публикации",callback_data:"clients:topup:"+c.id}],
    [{text:"⚖️ Изменить остаток",callback_data:"clients:balance:"+c.id}],
    [{text:"🔑 Изменить PIN",callback_data:"clients:pin:"+c.id}]
  ]);return true;
 }
 const select=/^clients:(suspend|resume|topup|pin|balance):(\d{5,16})$/.exec(action);
 if(select){
  const mode=select[1];
  await storage.put("admin_pending",{mode,userId:select[2],operation:nonce(),expires:Date.now()+600000});
  await say(mode==="balance"?"Какой доступный остаток установить? Использованные публикации сохранятся.":mode==="topup"?"Сколько публикаций добавить?":mode==="pin"?"Введите новый PIN: от 6 до 12 цифр.":"Подтвердите изменение доступа.",mode==="suspend"||mode==="resume"?[[{text:"✅ Подтвердить",callback_data:"clients:confirm:"+(await storage.get("admin_pending")).operation}]]:[]);return true;
 }
 if(!pending||pending.expires<Date.now()){await storage.delete("admin_pending");await say("Действие устарело. Откройте раздел заново.");return true;}
 if(action.startsWith("clients:confirm:")){
  if(action!=="clients:confirm:"+pending.operation)return true;
  if(!["create","suspend","resume","pin","topup","balance"].includes(pending.mode)||!pending.ready&&!["suspend","resume"].includes(pending.mode))return true;
  const result=pending.mode==="balance"?await adjustCredits(env,pending.userId,pending.target,pending.expected,pending.operation,uid):await registry(env,{action:pending.mode,actorId:uid,...pending});
  await storage.delete("admin_pending");await say(result.ok?"✅ Изменения сохранены.":"Не удалось выполнить действие: "+result.reason);return true;
 }
 if(!update.message?.text)return true;
 if(update.message.message_id)await send(env,"deleteMessage",{chat_id:uid,message_id:update.message.message_id}).catch(()=>{});
 if(pending.mode==="id"){
  if(!validId(text)||text===OWNER_ID){await say("Нужен корректный Telegram ID клиента.");return true;}
  await storage.put("admin_pending",{...pending,userId:text,mode:"create_pin"});await say("Назначьте PIN: от 6 до 12 цифр.");return true;
 }
 if(pending.mode==="create_pin"||pending.mode==="pin"){
  if(!/^\d{6,12}$/.test(text)){await say("PIN должен содержать от 6 до 12 цифр.");return true;}
  if(pending.mode==="pin"){
   await storage.put("admin_pending",{...pending,credential:await pinRecord(text),ready:true});
   await say("Изменить PIN клиента "+pending.userId+"?",[[{text:"✅ Сохранить",callback_data:"clients:confirm:"+pending.operation}]]);return true;
  }
  await storage.put("admin_pending",{...pending,credential:await pinRecord(text),mode:"create_grant"});await say("Сколько публикаций назначить клиенту?");return true;
 }
 if(pending.mode==="balance"){
  if(!/^\d{1,7}$/.test(text)||Number(text)>1000000){await say("Введите целое допустимое количество.");return true;}
  const balance=await credits(env,pending.userId,"status");
  await storage.put("admin_pending",{...pending,target:Number(text),expected:balance.available,ready:true});
  await say("Изменить доступный остаток клиента "+pending.userId+" с "+balance.available+" на "+text+"?",[[{text:"✅ Сохранить",callback_data:"clients:confirm:"+pending.operation}]]);return true;
 }
 if(pending.mode==="create_grant"||pending.mode==="topup"){
  if(!/^\d{1,7}$/.test(text)||Number(text)>1000000||pending.mode==="topup"&&Number(text)<1){await say("Введите целое допустимое количество.");return true;}
  const next={...pending,mode:pending.mode==="topup"?"topup":"create",operation:pending.operation||nonce(),ready:true,...(pending.mode==="topup"?{amount:Number(text)}:{grant:Number(text)})};
  await storage.put("admin_pending",next);await say("👤 Клиент "+pending.userId+"\n💎 Публикаций: "+text+"\n\nСохранить?",[[{text:"✅ Сохранить",callback_data:"clients:confirm:"+next.operation}]]);return true;
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
 const client=uid===OWNER_ID?null:(await registry(env,{action:"get",userId:uid})).client;
 const engine=createCabinet(uid);
 if(event.kind==="update"){
  let update=event.update;if(privateActor(update)!==uid)return {handled:true};
  let action=String(update.callback_query?.data||"");
  if(uid!==OWNER_ID){
   if(action.startsWith("clients:"))return {handled:true};
   if(rawEnv.CABINET_CLIENTS_ENABLED==="false"){
    const flow=await env.VISITORS_KV.get("owner_anketa_state:"+uid,"json");
    const selected=/^(owner_anketa|trial_cabinet):/.test(action)||update.message?.text==="/anketa"||/^https:\/\/[^ ]+\.intimcity\.rip\//.test(update.message?.text||"")||["number","review_input","review_preview"].includes(flow?.step);
    if(selected)await send(env,"sendMessage",{chat_id:uid,text:"🌷 Личный кабинет временно на обслуживании."});
    return {handled:selected};
   }
   if(!client?.active)return {handled:/^(owner_anketa|trial_cabinet):/.test(action)||update.message?.text==="/anketa"};
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
    }else{
     await storage.put("login_pending",{expires:Date.now()+600000});
     await loginSay("🔐 ЛИЧНЫЙ КАБИНЕТ\n\nВведите индивидуальный код доступа.");return {handled:true};
    }
   }
   env.__cabinetAuthorized=uid;
   if(uid===TRIAL_ID)await migrateTrial(storage,env);
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
    const text=String(update.message?.text||"");
    const flow=await env.VISITORS_KV.get("owner_anketa_state:"+uid,"json");
    const navigating=!!update.callback_query||text.startsWith("/")||/^https:\/\//.test(text)||["number","review_input","review_preview"].includes(flow?.step);
    if(navigating){
     if(update.callback_query)await send(env,"answerCallbackQuery",{callback_query_id:update.callback_query.id});
     await engine.showExhaustedCabinet(env,send,emptyProfile?.[1],balance);
     return {handled:true};
    }
   }else if(emptyProfile){
    // A top-up takes effect on the next click, including an old zero-balance button.
    action="owner_anketa:saved:"+emptyProfile[1];
    update={...update,callback_query:{...update.callback_query,data:action}};
   }
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
