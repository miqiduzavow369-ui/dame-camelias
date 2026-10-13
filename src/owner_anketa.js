// Owner-only questionnaire. Profile identity must come from a verified
// proxy-backed lookup service; never guess a name, age, or district.
const OWNER_ID = "5866034656";
const PREFIX = "owner_anketa_state:";
const ID_PATTERN = /^\d{1,9}$/;
const TTL_SECONDS = 1800;
// Owner verified this live publication on 2026-10-13. Historical backfill:
// immutable even if the bot's chat or Cloudflare KV data are cleared.
const VERIFIED_FIRST_PUBLICATION = "652282";
const PUBLICATION_KEY = "owner_anketa_publication_v1:";
async function publicationStatus(env,id,kind) {
  if(!ID_PATTERN.test(String(id)) || !["rating","review"].includes(kind))return null;
  if(kind==="rating" && String(id)===VERIFIED_FIRST_PUBLICATION)
    return {status:"published",at:"2026-10-13",source:"owner-public-verification"};
  return await env.VISITORS_KV?.get(PUBLICATION_KEY+kind+":"+id,"json")||null;
}
async function recordPublication(env,id,kind,status,source) {
  if(!env.VISITORS_KV || !ID_PATTERN.test(String(id)) ||
      !["rating","review"].includes(kind) ||
      !["publishing","published","needs_verification"].includes(status))
    return false;
  const key=PUBLICATION_KEY+kind+":"+id;
  const before=await publicationStatus(env,id,kind);
  if(before?.status==="published" || (before && status==="publishing"))return false;
  await env.VISITORS_KV.put(key,JSON.stringify({
    status,source,at:new Date().toISOString()
  })); // no expiration: independent of chat, profile library, and 30-minute draft TTL
  return true;
}
async function ensureNoRepeat(env,id,kind,send) {
  const found=await publicationStatus(env,id,kind);
  if(!found)return false;
  await say(env,send,found.status==="published" ?
    "✅ "+(kind==="rating"?"Оценка опубликована":"Отзыв опубликован")+
    "\n\n🆔 Анкета №"+id+"\n🔒 Повторная публикация запрещена.":
    "🔒 Повторная публикация временно заблокирована\n\n🆔 Анкета №"+id+
    "\nРезультат предыдущей попытки ещё требует подтверждения.");
  return true;
}
const HOST_PATTERN = /^[a-z0-9-]+\.intimcity\.rip$/;
function parseProfileLink(input) {
  try {
    const url = new URL(String(input).trim());
    if (url.protocol!=="https:" || url.username || url.password || url.port || url.search || url.hash ||
        !HOST_PATTERN.test(url.hostname)) return null;
    const match = /^\/indi\/anketa(\d{1,9})\.htm$/.exec(url.pathname);
    return match ? {id:match[1],host:url.hostname} : null;
  } catch { return null; }
}

export function ownerAllowed(update) {
  const from = update.callback_query?.from ?? update.message?.from;
  const chat = update.callback_query?.message?.chat ?? update.message?.chat;
  return String(from?.id ?? "") === OWNER_ID &&
    String(chat?.id ?? "") === OWNER_ID && chat?.type === "private";
}
async function stateGet(env) {
  return env.VISITORS_KV ? await env.VISITORS_KV.get(PREFIX + OWNER_ID, "json") : null;
}
async function statePut(env, state) {
  if (!env.VISITORS_KV) return false;
  await env.VISITORS_KV.put(PREFIX + OWNER_ID, JSON.stringify(state),
    { expirationTtl: TTL_SECONDS });
  return true;
}
const ACCOUNT_SELECTION_KEY = "owner_anketa_selected_account:"+OWNER_ID;
const ACTIVE_ACCOUNT = "yan_first";
async function selectedAccount(env,id){
  const selected=await env.VISITORS_KV?.get(ACCOUNT_SELECTION_KEY,"json");
  return selected?.profileId===String(id) && selected?.account===ACTIVE_ACCOUNT &&
    Number(selected.expiresAt)>Date.now() ? ACTIVE_ACCOUNT : null;
}
async function chooseAccount(env,id){
  if(!env.VISITORS_KV || !ID_PATTERN.test(String(id)))return false;
  await env.VISITORS_KV.put(ACCOUNT_SELECTION_KEY,JSON.stringify({
    profileId:String(id),account:ACTIVE_ACCOUNT,expiresAt:Date.now()+30*60*1000
  }),{expirationTtl:1800});
  return true;
}
function accountPicker(id){
  return buttons([
    [{text:"👨‍💻 Ян Первый",callback_data:"owner_anketa:account1:"+id}],
    [{text:"🔒 Ян Второй (не подключён)",callback_data:"owner_anketa:account2:"+id}],
    [{text:"⬅️ К моим анкетам",callback_data:"owner_anketa:open"}]
  ]);
}
const LIBRARY_KEY = "owner_anketa_library:"+OWNER_ID;
const PROFILE_KEY = "owner_anketa_saved:"+OWNER_ID+":";
async function libraryGet(env) {
  const ids=await env.VISITORS_KV?.get(LIBRARY_KEY,"json");
  return Array.isArray(ids)?ids.filter(x=>ID_PATTERN.test(String(x))).slice(0,60):[];
}
async function savedGet(env,id) {
  if(!ID_PATTERN.test(String(id)))return null;
  return await env.VISITORS_KV?.get(PROFILE_KEY+id,"json")||null;
}
async function savedPut(env,record) {
  if(!env.VISITORS_KV||!record?.profile||!ID_PATTERN.test(String(record.profile.id)))return false;
  const id=String(record.profile.id);
  await env.VISITORS_KV.put(PROFILE_KEY+id,JSON.stringify({
    profile:record.profile,host:record.host,catalog:Array.isArray(record.catalog)?record.catalog:[],
    confirmed:true,updatedAt:Date.now()
  }));
  const ids=await libraryGet(env);
  if(!ids.includes(id))await env.VISITORS_KV.put(LIBRARY_KEY,JSON.stringify([...ids,id]));
  return true;
}
async function savedDelete(env,id) {
  const ids=await libraryGet(env);
  await env.VISITORS_KV.delete(PROFILE_KEY+id);
  await env.VISITORS_KV.put(LIBRARY_KEY,JSON.stringify(ids.filter(x=>x!==id)));
}
const libraryKeyboard=ids=>buttons([
  ...ids.map(id=>[{text:"🌹 АНКЕТА №"+id,callback_data:"owner_anketa:saved:"+id}]),
  [{text:"➕ Ввести новую анкету",callback_data:"owner_anketa:new"}],
  [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
]);
// v1 publication records belong exclusively to yan_first. Never copy their
// statuses to yan_second; its history will use account-scoped keys at rollout.
async function availabilitySummary(env,id,account){
  if(account!=="yan_first")return "⭐ Оценки — 🔒 НЕ ПОДКЛЮЧЁН\n✍️ Отзывы — 🔒 НЕ ПОДКЛЮЧЁН";
  // On storage errors never present an unknown slot as available.
  if(!env.VISITORS_KV)return "⭐ Оценки — ⚠️ СТАТУС НЕИЗВЕСТЕН\n✍️ Отзывы — ⚠️ СТАТУС НЕИЗВЕСТЕН";
  try{
    const [rating,review]=await Promise.all([
      publicationStatus(env,id,"rating"),publicationStatus(env,id,"review")
    ]);
    const label=status=>status?.status==="published"?"✅ ВЫ ОПУБЛИКОВАЛИ":
      status?"🔒 ТРЕБУЕТ ПРОВЕРКИ":"🟢 ДОСТУПНО";
    return "⭐ Оценки — "+label(rating)+"\n✍️ Отзывы — "+label(review);
  }catch{
    return "⭐ Оценки — ⚠️ СТАТУС НЕИЗВЕСТЕН\n✍️ Отзывы — ⚠️ СТАТУС НЕИЗВЕСТЕН";
  }
}
async function profileKeyboard(env,id){
  const rating=await publicationStatus(env,id,"rating");
  const review=await publicationStatus(env,id,"review");
  return buttons([
  [{text:rating?.status==="published"?"✅ Оценка опубликована":rating?"🔒 Оценка: проверка результата":"⭐ Оценки",callback_data:"owner_anketa:savedrating:"+id}],
  [{text:review?.status==="published"?"✅ Отзыв опубликован":review?"🔒 Отзыв: проверка результата":"✍️ Отзыв",callback_data:"owner_anketa:savedreview:"+id}],
  [{text:"🗑 Удалить анкету",callback_data:"owner_anketa:deleteask:"+id}],
  [{text:"⬅️ К моим анкетам",callback_data:"owner_anketa:open"}],
  [{text:"🏠 В начало",callback_data:"owner_anketa:home"}]
]);}
async function showLibrary(env,send){
  // Keep important audit and publication reports in the conversation.
  const ids=await libraryGet(env);
  await navigationSay(env,send,ids.length?
    "🌹 МОИ АНКЕТЫ DAME CAMELIAS\n\n💕 Выберите сохранённую анкету — проверять её повторно не потребуется.\n\n✨ Или добавьте новую по актуальной ссылке.":
    "🌹 DAME CAMELIAS\n\n💕 Пока нет сохранённых анкет. Приглашаю добавить первую!",
    libraryKeyboard(ids));
}
async function showSaved(env,send,id) {
  const record=await savedGet(env,id);
  if(!record){await showLibrary(env,send);return;}
  await navigationSay(env,send,"🌹 АНКЕТА №"+id+"\n\n👩‍🦰 "+record.profile.name+
    "\n\n👤 Выберите аккаунт Intimcity для работы с анкетой:",accountPicker(id));
}
const CHAT_IDS_KEY="owner_anketa_chat_ids:"+OWNER_ID;
const NAV_MESSAGE_KEY="owner_anketa_navigation:"+OWNER_ID;
// Navigation has one active message; audit, publication and result messages
// are sent through say() and are never removed by navigation cleanup.
async function navigationSay(env,send,text,reply_markup){
  const rows=Array.isArray(reply_markup?.inline_keyboard)?reply_markup.inline_keyboard:[];
  const hasHome=rows.some(row=>row.some(button=>button.callback_data==="owner_anketa:home"));
  const markup=buttons(hasHome?rows:[...rows,[{text:"🏠 В начало",callback_data:"owner_anketa:home"}]]);
  let previous=null;
  try{previous=await env.VISITORS_KV?.get(NAV_MESSAGE_KEY,"json");}catch{}
  if(Number.isSafeInteger(previous?.id)){
    try{const edited=await send(env,"editMessageText",{chat_id:OWNER_ID,message_id:previous.id,text,reply_markup:markup});
      if(edited)return edited;
    }catch(e){if(String(e).includes("message is not modified"))return {message_id:previous.id};}
  }
  const response=await say(env,send,text,markup);
  const id=response?.message_id;
  if(!Number.isSafeInteger(id)||!env.VISITORS_KV)return response;
  try{await env.VISITORS_KV.put(NAV_MESSAGE_KEY,JSON.stringify({id,at:Date.now()}),{expirationTtl:172800});}catch{}
  if(Number.isSafeInteger(previous?.id)&&previous.id!==id&&Date.now()-Number(previous.at)<47*3600000){
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:previous.id});}catch{}
  }
  return response;
}
async function trackAnketaMessage(env,id){
  if(!env.VISITORS_KV || !Number.isSafeInteger(id) || id<=0)return;
  try{
    const list=(await env.VISITORS_KV.get(CHAT_IDS_KEY,"json"))||[];
    const recent=Array.isArray(list)?list.filter(x=>Number.isSafeInteger(x.id) && Date.now()-x.at<47*3600000 && x.id!==id):[];
    recent.push({id,at:Date.now()});
    await env.VISITORS_KV.put(CHAT_IDS_KEY,JSON.stringify(recent.slice(-150)),{expirationTtl:172800});
  }catch(e){console.error("Owner anketa message tracking unavailable",e);}
}
async function cleanAnketaChat(env,send){
  if(!env.VISITORS_KV)return;
  let list=[];
  try{list=await env.VISITORS_KV.get(CHAT_IDS_KEY,"json")||[];}catch{return;}
  if(!Array.isArray(list))return;
  // Telegram normally allows deleting private chat messages only within 48 hours.
  // Never delete messages from other bot sections or from other chats.
  const ids=[...new Set(list.filter(x=>Number.isSafeInteger(x.id)&&Date.now()-x.at<47*3600000).map(x=>x.id))];
  const failed=[];
  for(const id of ids){
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:id});}
    catch{failed.push({id,at:Date.now()});}
  }
  try{await env.VISITORS_KV.delete(CHAT_IDS_KEY);}catch{}
}
function buttons(rows) { return {inline_keyboard:rows}; }
const NEW_NUMBER = [{text:"🔄 Ввести другую анкету",callback_data:"owner_anketa:change"}];
// Keep meaningful bot replies and found-profile cards in Telegram history.
// Only the transient progress message is updated; owner-entered IDs are cleaned up.
async function say(env, send, text, reply_markup) {
  const response=await send(env,"sendMessage",{chat_id:OWNER_ID,text,...(reply_markup?{reply_markup}:{})});
  await trackAnketaMessage(env,response?.message_id);
  return response;
}
// One-screen editable draft. No Telegram action here publishes ratings.
function ratingMenu(state) {
  const selected=state.selected||{};
  const rows=[];
  state.catalog.forEach((field,i)=>{
    const chosen=selected[i];
    const display=chosen===undefined?"":" · "+chosen;
    rows.push([{text:(chosen===undefined?"◯ ":"🔘 ")+field.label.slice(0,32)+display.slice(0,15),
      callback_data:"owner_anketa:toggle:"+i+":"+state.nonce}]);
    if(chosen===undefined) return;
    const alternatives=field.options.filter(v=>v && v.toLowerCase()!=="не знаю" && !/^[1-4]$/.test(v));
    if(alternatives.length<2) return;
    rows.push(alternatives.slice(0,4).map(v=>({
      text:(chosen===v?"🔘 ":"◯ ")+v.slice(0,18),
      callback_data:"owner_anketa:option:"+i+":"+field.options.indexOf(v)+":"+state.nonce
    })));
  });
  rows.push([{text:"📋 Посмотреть выбор",callback_data:"owner_anketa:preview:"+state.nonce}]);
  rows.push([{text:"🧹 Сбросить отметки",callback_data:"owner_anketa:reset:"+state.nonce}]);
  rows.push(NEW_NUMBER);
  return buttons(rows);
}
function ratingSummary(state) {
  const count=Object.keys(state.selected||{}).length;
  return "🌹 ОЦЕНКИ АНКЕТЫ\n\n👤 "+state.profile.name+
    "\n⭐ Отмечено: "+count+" из "+state.catalog.length+
    "\n\n💕 Нажмите ◯, чтобы отметить категорию. Повторное нажатие снимет отметку."+
    "\n✨ Для вариантов с текстом можно выбрать значение отдельно.\n\n🌷 Пока это только черновик.";
}
function ratingSubgroup(field) {
  const label=String(field.label||"").toLowerCase().trim();
  const group=String(field.group||"").toLowerCase().trim();
  // Use explicit site headings first. These two labels only fill in the
  // site's nested captions when its HTML does not expose a heading.
  if (/массаж/.test(group)) return "Массаж";
  if (/бдсм|bdsm/.test(group)) return "БДСМ";
  if (/^(классический|расслабляющий)$/.test(label)) return "Массаж";
  if (label==="игры") return "БДСМ";
  return "";
}
// Build contiguous site-style service complexes without sorting any fields.
// The category changes only when a source heading or distinctive first item appears.
function organizeCatalog(catalog) {
  // Section transitions follow the approved owner report sample.
  // Never sort the criteria: retain their original website order.
  let section="Основной перечень";
  const stages=["Основной перечень","Секс","Массаж","БДСМ","Другое"];
  const stageIndex=name=>stages.indexOf(name);
  return catalog.map(field=>{
    const label=String(field.label||"").trim();
    const low=label.toLowerCase();
    const siteGroup=String(field.group||"").toLowerCase();
    const sourceSubgroup=String(field.subgroup||"").toLowerCase();
    let next=null;
    if(low==="классический секс")next="Секс";
    else if(/^(классический|расслабляющий)$/.test(low) ||
      /массаж/.test(siteGroup))next="Массаж";
    else if(low==="игры" || /(?:бдсм|bdsm)/.test(siteGroup))next="БДСМ";
    else if(low==="окончание в рот" ||
      /^(?:другое|другие услуги|дополнительные услуги)$/.test(siteGroup))next="Другое";
    // Explicit field boundaries win over previously cached heuristic subgroups.
    // Unambiguous source section captions are a fallback for other profiles.
    else if(/^(?:массаж|бдсм|другое)$/.test(sourceSubgroup))
      next=sourceSubgroup==="секс"?"Секс":sourceSubgroup==="массаж"?"Массаж":
        sourceSubgroup==="бдсм"?"БДСМ":"Другое";
    if(next && stageIndex(next)>stageIndex(section))section=next;
    return {...field,label:/^isFair$/i.test(label)?"Фото соответствует":label,
      group:"Оценки анкеты",subgroup:section};
  });
}

function validProfile(data, id, host) {
  if (!data || String(data.id) !== id || typeof data.name !== "string" ||
      !data.name.trim() || data.name.length > 100 ||
      !Number.isInteger(data.age) || data.age < 18 || data.age > 99 ||
      typeof data.metro !== "string" || data.metro.length > 100 ||
      data.url !== `https://${host}/indi/anketa${id}.htm`) return null;
  let photoUrl="";
  if(typeof data.photoUrl==="string" && data.photoUrl.length<1600){
    try{
      const u=new URL(data.photoUrl);
      if(u.protocol==="https:" && u.hostname===host && !u.username && !u.password && !u.port &&
          /\\.(?:jpg|jpeg|png|webp)$/i.test(u.pathname))photoUrl=u.href;
    }catch{}
  }
  return {id,name:data.name.trim(),age:data.age,metro:data.metro.trim(),url:data.url,photoUrl};
}
async function dispatchLookup(env,id,nonce,mode="profile",siteHost="a.intimcity.rip") {
  if (!env.DC_ACTIONS_TOKEN) return {ok:false,reason:"Отсутствует DC_ACTIONS_TOKEN в Cloudflare"};
  if (!env.ANKETA_CALLBACK_TOKEN) return {ok:false,reason:"Отсутствует ANKETA_CALLBACK_TOKEN в Cloudflare"};
  const response=await fetch(
    "https://api.github.com/repos/miqiduzavow369-ui/dame-camelias/actions/workflows/intimcity-profile-lookup.yml/dispatches",
    {method:"POST",headers:{
      "Authorization":"Bearer "+env.DC_ACTIONS_TOKEN,
      "Accept":"application/vnd.github+json",
      "User-Agent":"dame-camelias-worker",
      "X-GitHub-Api-Version":"2022-11-28",
      "Content-Type":"application/json"},
    body:JSON.stringify({ref:"main",inputs:{profile_id:id,nonce,mode,site_host:siteHost}}),
    signal:AbortSignal.timeout(15000)});
  if(response.status===204) return {ok:true};
  const descriptions={401:"GitHub отклонил токен (401)",403:"GitHub запретил запуск: проверь Actions Write и срок токена (403)",404:"GitHub не нашёл workflow или у токена нет доступа к репозиторию (404)",422:"GitHub не принял параметры запуска (422)",429:"GitHub ограничил число запросов (429)"};
  return {ok:false,reason:descriptions[response.status]||("GitHub HTTP "+response.status)};
}
export async function ownerDryfillPayload(request,env) {
  if (!env.ANKETA_CALLBACK_TOKEN ||
      request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)
    return new Response("Forbidden",{status:403});
  const url=new URL(request.url);
  const id=url.searchParams.get("profile_id")||"";
  const nonce=url.searchParams.get("nonce")||"";
  if(!ID_PATTERN.test(id)||!/^[a-f0-9]{12}$/.test(nonce))
    return new Response("Invalid request",{status:400});
  const state=await stateGet(env);
  const publication=state?.step==="publishing" && state?.nonce===nonce &&
    state?.dispatchPending===true;
  if(!state || (!publication && state.step!=="dryfill_loading") || String(state.id)!==id ||
      state.nonce!==nonce || !state.profile || String(state.profile.id)!==id ||
      Date.now()-Number(state.agreedAt||0)>20*60*1000)
    return new Response("Stale",{status:409});
  if(publication){
    // Consume the grant before the external submission attempt. Never auto-retry.
    await statePut(env,{...state,dispatchPending:false,submissionStartedAt:Date.now()});
  }
  const selections=Object.keys(state.selected||{}).map(Number).sort((a,b)=>a-b).map(i=>({
    index:i,label:state.catalog?.[i]?.label,value:state.selected[i]
  }));
  if(selections.length===0 || selections.length>120 ||
      selections.some(x=>!Number.isInteger(x.index)||!x.label||typeof x.value!=="string"))
    return new Response("Invalid state",{status:409});
  return Response.json({selections,metElsewhere:state.metElsewhere===true},
    {headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
export async function handleAnketaLookupResult(request,env,send) {
  if (!env.ANKETA_CALLBACK_TOKEN ||
      request.headers.get("Authorization")!=="Bearer "+env.ANKETA_CALLBACK_TOKEN)
    return new Response("Forbidden",{status:403,headers:{"X-DC-Callback-Handler":"reached"}});
  let data;
  try {data=await request.json();}catch{return new Response("Invalid JSON",{status:400});}
  const id=String(data.profile_id??""),nonce=String(data.nonce??"");
  if(!ID_PATTERN.test(id)||!/^[a-f0-9]{12}$/.test(nonce))
    return new Response("Invalid request",{status:400});
  const current=await stateGet(env);
  const publishLoading=current?.step==="publishing" && data.mode==="publish";
  if(publishLoading){
    const attempt=data.publication||{};
    const wasStarted=current.submissionStartedAt>0;
    if(current.id!==id || current.nonce!==nonce || !wasStarted)
      return new Response("Stale",{status:409});
    // A visible success alert alone is not proof of a matching public entry.
    // The screenshot verifier (#57) will set "published" only after matching
    // the exact profile and delivering the screenshot to Telegram.
    await recordPublication(env,id,"rating","needs_verification",
      attempt.confirmed===true?"site-ack-awaiting-screenshot":
      attempt.attempted===true?"submission-unconfirmed":"submission-not-proven");
    const next={...current,step:"publication_result",publicationReport:{
      attempted:attempt.attempted===true,
      confirmed:attempt.confirmed===true,
      confirmedBy:typeof attempt.confirmedBy==="string"?attempt.confirmedBy.slice(0,70):"",
      at:Date.now()},readyAt:null,dispatchPending:false};
    await statePut(env,next);
    const title=attempt.confirmed===true?"✅ ПУБЛИКАЦИЯ ПОДТВЕРЖДЕНА":
       attempt.attempted===true||!data.publication?"⚠️ РЕЗУЛЬТАТ ПУБЛИКАЦИИ НЕ ПОДТВЕРЖДЁН":
       "❌ ПУБЛИКАЦИЯ НЕ ВЫПОЛНЕНА";
    await say(env,send,title+"\n\n🆔 Анкета №"+id+
      "\n🌷 Повторной отправки не будет."+
      ((attempt.attempted===true||!data.publication)&&attempt.confirmed!==true?
       "\nПожалуйста, проверьте результат на Intimcity вручную.":""));
    return Response.json({ok:true});
  }
  const dryfillLoading = current?.step === "dryfill_loading" && data.mode === "dryfill";
  const auditLoading = current?.step === "audit_loading" && data.mode === "mapping";
  const ratingsLoading = current?.step === "ratings_loading" && data.mode === "ratings";
  if(!current || (!ratingsLoading && !auditLoading && !dryfillLoading && current.step!=="loading") || current.id!==id || current.nonce!==nonce)
    return new Response("Stale",{status:409});
  if(dryfillLoading){
    const restored={...current,step:"ratings_agreed",nonce:current.previousNonce};
    delete restored.previousNonce;
    delete restored.id;
    await statePut(env,restored);
    const report=data.dryfill;
    const ratedTotal=Object.keys(current.selected||{}).length;
    const total=ratedTotal+(current.metElsewhere===true?1:0);
    const extraOk=current.metElsewhere!==true || (report?.extraFlag?.ok===true && report.extraFlag.count===1);
    const finalAuditOk=report?.finalAudit?.ok===true &&
      Object.values(report.finalAudit.checks||{}).length===6 &&
      Object.values(report.finalAudit.checks).every(v=>v===true);
    const ok=data.status==="found" && data.profile && String(data.profile.id)===id &&
      report && report.applied===ratedTotal && report.verified===ratedTotal && extraOk &&
      Array.isArray(report.results) && report.results.length===ratedTotal &&
      report.results.every(x=>x.ok===true);
    const misses=Array.isArray(report?.results)?
      report.results.filter(x=>!x.ok).map(x=>"• "+String(x.label||"Пункт").slice(0,90)): [];
    if(!extraOk)misses.push("• Встречался по другой анкете — не найдено однозначное поле сайта");
    if(!finalAuditOk)misses.push("• Финальная проверка отправляемых полей формы не пройдена");
    if(current.prepublish){
      if(ok && finalAuditOk){
        const finalState={...restored,step:"prepublish_ready",prepublish:true,readyAt:Date.now()};
        await statePut(env,finalState);
        await say(env,send,"✅ ВСЁ ГОТОВО К ПУБЛИКАЦИИ\n\n👤 "+current.profile.name+
          "\n🆔 Анкета №"+id+"\n✅ Проверен доступ через ваш прокси\n✅ Анкета найдена и подтверждена"+
          "\n✅ Все выбранные поля проверены: "+total+" из "+total+
          "\n\n🌷 Ничего на сайт не отправлялось.\n\n💎 Вы точно хотите опубликовать выбранные оценки?",
          buttons([[{text:"✅ Да, опубликовать",callback_data:"owner_anketa:publish_confirm:"+current.previousNonce}],
            [{text:"❌ Отмена",callback_data:"owner_anketa:publish_cancel:"+current.previousNonce}]]));
      }else{
        await say(env,send,"⚠️ ПОДГОТОВКА НЕ ПРОШЛА\n\n🆔 Анкета №"+id+
          "\n✅ Проверено в браузере: "+((Number(report?.verified)||0)+(report?.extraFlag?.ok===true?1:0))+" из "+total+
          (misses.length?"\n\nПроверьте:\n"+misses.slice(0,20).join("\n"):"")+
          "\n\n🌷 Публикация не предлагалась. На сайт ничего не отправлялось.");
      }
      return Response.json({ok:true,prepublish:!!ok});
    }
    await say(env,send,(ok?"✅ ТЕСТ ЗАПОЛНЕНИЯ ПРОЙДЕН":"⚠️ ТЕСТ ЗАПОЛНЕНИЯ НЕ ПРОЙДЕН")+
      "\n\n🆔 Анкета №"+id+
      "\n📋 Выбрано пунктов: "+total+
      "\n✅ Проверено в браузере: "+((Number(report?.verified)||0)+(report?.extraFlag?.ok===true?1:0))+
      (misses.length?"\n\nНе совпали:\n"+misses.slice(0,30).join("\n"):"")+
      (current.metElsewhere===true?"\n\n☑️ Галочка «Встречался по другой анкете»: "+(extraOk?"проверена":"не сопоставлена"):"")+
      "\n\n🌷 Значения проверены только во временном браузере. Форма на Intimcity не отправлялась.",
      buttons([[{text:"⭐ Открыть оценки",callback_data:"owner_anketa:savedrating:"+id}],
        [{text:"⬅️ К анкете",callback_data:"owner_anketa:saved:"+id}]]));
    return Response.json({ok:true,dryfill:ok});
  }
  if(auditLoading) {
    const selected=current.selected||{};
    const restored={step:"ratings_agreed",account:current.account,profile:current.profile,host:current.host,
      nonce:current.previousNonce,catalog:current.catalog,selected,
      metElsewhere:current.metElsewhere===true,draftReady:true,agreedAt:current.agreedAt};
    await statePut(env,restored);
    const raw=Array.isArray(data.catalog)?data.catalog:[];
    if(data.status!=="found" || !data.profile || String(data.profile.id)!==id || !raw.length){
      await say(env,send,"⚠️ Проверка полей анкеты №"+id+" не удалась. На сайте ничего не изменено.");
      return Response.json({ok:true,audit:false});
    }
    const normalized=t=>String(t||"").trim().toLowerCase().replace(/\s+/g," ");
    const source=organizeCatalog(raw);
    const wanted=Object.keys(selected).map(Number).sort((a,b)=>a-b);
    let matched=0;
    const misses=[];
    for(const i of wanted){
      const local=current.catalog[i],remote=source[i],value=selected[i];
      const choices=remote?.options||[];
      const index=choices.findIndex(x=>normalized(x)===normalized(value));
      const control=remote?.control;
      const unique=control && ["radio","select"].includes(control.type) &&
        (control.name||control.id) &&
        source.filter(x=>x.control?.type===control.type &&
          (x.control.name||x.control.id)===(control.name||control.id)).length===1;
      if(local && remote && normalized(local.label)===normalized(remote.label) &&
          index>=0 && unique && typeof control.values?.[index]==="string"){
        matched++;
      } else misses.push("• "+(local?.label||("Пункт "+(i+1)))+" — нет однозначного соответствия");
    }
    // The extra flag has no proven site control mapping yet.
    if(current.metElsewhere===true)misses.push("• Встречался по другой анкете — элемент сайта не сопоставлен");
    const extras=current.metElsewhere===true?1:0;
    const total=wanted.length+extras;
    await say(env,send,"🔎 ПРОВЕРКА ПОЛЕЙ САЙТА\n\n🆔 Анкета №"+id+
      "\n✅ Совпали: "+matched+" из "+total+
      "\n⚠️ Требуют проверки: "+(total-matched)+
      (misses.length?"\n\n"+misses.slice(0,25).join("\n"):"")+
      "\n\n🌷 Режим только чтения. Ни одно поле на сайте не изменено и ничего не опубликовано.",
      buttons([[{text:"⭐ Открыть оценки",callback_data:"owner_anketa:savedrating:"+id}],
        [{text:"⬅️ К анкете",callback_data:"owner_anketa:saved:"+id}]]));
    return Response.json({ok:true,audit:true,matched,total});
  }
  if(ratingsLoading) {
    // The lookup can bring a new verified thumbnail. Preserve the original
    // identity if lookup has no photo, but never silently discard a new one.
    const refreshed=validProfile(data.profile,id,current.host);
    const profile = refreshed ? {...current.profile,...refreshed,
      photoUrl:refreshed.photoUrl || current.profile?.photoUrl || ""} : current.profile;
    const raw = Array.isArray(data.catalog) ? data.catalog : [];
    const catalog = raw.slice(0,120).filter(x => x && typeof x.label === "string" && Array.isArray(x.options))
      .map(x => ({label:x.label.slice(0,90),group:typeof x.group==="string" ? x.group.slice(0,90) : "Оценки анкеты",subgroup:ratingSubgroup(x),options:x.options.filter(v=>typeof v==="string").slice(0,20).map(v=>v.slice(0,50))}));
    if(data.status!=="found" || !catalog.length || !data.profile || String(data.profile.id)!==id) {
      await statePut(env,{step:"chosen",profile,nonce:current.previousNonce,host:current.host});
      await say(env,send,"🌷 Сейчас не удалось загрузить категории оценок для анкеты №"+id+
        ".\n\n💕 Пожалуйста, попробуйте немного позже.",buttons([NEW_NUMBER]));
      return Response.json({ok:true,found:false});
    }
    const orderedCatalog=organizeCatalog(catalog);
    if(current.account!==ACTIVE_ACCOUNT || !await selectedAccount(env,id)){
      await say(env,send,"🌷 Выбор аккаунта устарел. Откройте анкету и выберите 👨‍💻 Ян Первый.");return Response.json({ok:false},{status:409});
    }
    const next={step:"ratings",account:current.account,profile,host:current.host,nonce:current.previousNonce,catalog:orderedCatalog,selected:{}};
    await savedPut(env,{profile,host:current.host,catalog:orderedCatalog});
    await statePut(env,next);
    await navigationSay(env,send,"🌹 ВСЁ ГОТОВО!\n\n💕 Я подготовила для вас индивидуальную форму оценок анкеты "+profile.name+
      ".\n\n✨ Откройте её, отметьте нужные пункты и нажмите «Готово». Все выбранные значения вернутся сюда на проверку.",
      buttons([[{text:"💎 Заполнить оценки",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+next.nonce}}],NEW_NUMBER]));
    return Response.json({ok:true,found:true});
  }
  const found=validProfile(data.profile,id,current.host);
  if(!found) {
    await statePut(env,{step:"number"});
    const empty = data.status === "not_found";
    await say(env,send,empty
      ? "🔎 АНКЕТА НЕ НАЙДЕНА\n\n📋 По номеру №"+id+" нет результатов поиска.\n\n🔓 Пожалуйста, включите анкету, если она отключена, или проверьте правильность введённого ID.\n\n🔄 Можете попробовать ещё раз."
      : "🌷 НЕБОЛЬШАЯ ЗАМИНКА\n\n💕 Сейчас не получилось завершить проверку анкеты №"+id+
      ". Это может быть временная техническая ошибка, а не проблема с вашим номером.\n\n✨ Пожалуйста, попробуйте ещё раз чуть позже.",
      buttons([NEW_NUMBER]));
    return Response.json({ok:true,found:false});
  }
  const decision=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  await statePut(env,{step:"confirm",profile:found,host:current.host,nonce:decision});
  const location=found.metro?"\n📍 м. "+found.metro:"";
  await navigationSay(env,send,"🌹 АНКЕТА НАЙДЕНА\n\n👤 "+found.name+
    "\n🎂 Возраст: "+found.age+" лет"+location+"\n🆔 Номер анкеты: №"+id+"\n🔗 "+
    found.url+"\n\n✅ Это нужная анкета?",
    buttons([[{text:"✅ Подтвердить анкету",callback_data:"owner_anketa:confirm:"+decision}],
      NEW_NUMBER]));
  return Response.json({ok:true,found:true});
}
async function askNumber(env,send) {
  if (!await statePut(env,{step:"number"})) {
    await say(env,send,"⚠️ Хранилище состояния не настроено. Ввод анкеты сейчас недоступен.");
    return;
  }
  await navigationSay(env,send,"🌹 ДОБРО ПОЖАЛОВАТЬ В DAME CAMELIAS!\n\n💕 Давайте найдём вашу анкету.\n\n🔗 Пришлите, пожалуйста, полную ссылку на анкету с актуальным доменом Intimcity одним сообщением.\n\n✨ Я бережно проверю данные и предложу дальнейшие шаги.");
}
async function inspect(env,send,urlText) {
  const link=parseProfileLink(urlText);
  if (!link) {
    await say(env,send,"🌷 Кажется, ссылка указана не полностью.\n\n💕 Пришлите, пожалуйста, прямую ссылку на вашу анкету с актуальным доменом Intimcity. Я помогу продолжить.");
    return;
  }
  const {id,host}=link;
  const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  if(!await statePut(env,{step:"loading",id,host,nonce})) {
    await say(env,send,"⚠️ Хранилище недоступно.");
    return;
  }
  let dispatched;
  try {dispatched=await dispatchLookup(env,id,nonce,"profile",host);}
  catch {dispatched={ok:false,reason:"Не удалось связаться с GitHub API"};}
  if(!dispatched?.ok) {
    await statePut(env,{step:"number"});
    await say(env,send,"🌷 Не получилось начать проверку анкеты.\n\n💕 Пожалуйста, попробуйте ещё раз чуть позже.\n\nТехническая информация: "+dispatched.reason);
    return;
  }
  await navigationSay(env,send,"🌸 Минутку, пожалуйста!\n\n💕 Проверяю вашу анкету №"+id+"…\n✨ Скоро всё будет готово!");
}
export async function handleOwnerAnketa(update,env,send) {
  const cb=update.callback_query;
  const msg=update.message;
  const data=String(cb?.data ?? "");
  const txt=String(msg?.text ?? "").trim();
  const command=txt.split(/\s+/)[0].split("@")[0];
  const owner=ownerAllowed(update);
  const ownerAction=data.startsWith("owner_anketa:") || command==="/anketa";
  const state=owner && !ownerAction ? await stateGet(env) : null;
  // Intimcity profile links take priority over general order free-text routing,
  // including when the previous owner prompt came from an older Worker version.
  const isProfileLink=owner && Boolean(msg?.text) && Boolean(parseProfileLink(txt));
  const typedLink=owner && Boolean(msg?.text) &&
    (isProfileLink || (state?.step==="number" && /^https?:\/\//i.test(txt)));
  if (!ownerAction && !typedLink) return false;
  if (!owner) {
    if(cb) await send(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Недоступно"});
    return true;
  }
  if(cb) await send(env,"answerCallbackQuery",{callback_query_id:cb.id});
  if (data==="owner_anketa:home") {await showLibrary(env,send);return true;}
  if (data==="owner_anketa:open" ||
      (command==="/anketa" && txt.split(/\s+/).length===1)) {
    await showLibrary(env,send); return true;
  }
  if (data==="owner_anketa:new" || data==="owner_anketa:change") {await askNumber(env,send);return true;}
  if (command==="/anketa") {
    const url=txt.split(/\s+/)[1] ?? "";
    await inspect(env,send,url); return true;
  }
  if (typedLink) {
    await trackAnketaMessage(env,msg?.message_id);
    // Remove the submitted URL when it has been processed; state retains the profile.
    // Do not route a profile URL into the customer order conversation.
    await inspect(env,send,txt);
    try{await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:msg.message_id});}catch{}
    return true;
  }
  const savedMenu=/^owner_anketa:saved:(\d{1,9})$/.exec(data);
  if(savedMenu){await showSaved(env,send,savedMenu[1]);return true;}
  const account1=/^owner_anketa:account1:(\d{1,9})$/.exec(data);
  if(account1){
    const rec=await savedGet(env,account1[1]);
    if(!rec){await showLibrary(env,send);return true;}
    if(!await chooseAccount(env,account1[1])){
      await say(env,send,"⚠️ Не удалось сохранить выбор аккаунта. Попробуйте ещё раз.");return true;
    }
    const summary=await availabilitySummary(env,account1[1],ACTIVE_ACCOUNT);
    await navigationSay(env,send,"👨‍💻 ЯН ПЕРВЫЙ\n🌹 Анкета №"+account1[1]+
      "\n\nДля данной анкеты доступны:\n\n"+summary+
      "\n\n💕 Выберите действие:",await profileKeyboard(env,account1[1]));
    return true;
  }
  const account2=/^owner_anketa:account2:(\d{1,9})$/.exec(data);
  if(account2){
    await navigationSay(env,send,"🔒 ЯН ВТОРОЙ\n🌹 Анкета №"+account2[1]+
      "\n\nДля данной анкеты доступны:\n\n"+await availabilitySummary(env,account2[1],"yan_second")+
      "\n\n🔒 Аккаунт пока не подключён.\n\n💕 Выберите действие:",accountPicker(account2[1]));
    return true;
  }
  const savedReview=/^owner_anketa:savedreview:(\d{1,9})$/.exec(data);
  if(savedReview){
    if(!await selectedAccount(env,savedReview[1])){
      await showSaved(env,send,savedReview[1]);return true;
    }
    if(await ensureNoRepeat(env,savedReview[1],"review",send))return true;
    if(!await savedGet(env,savedReview[1])){await showLibrary(env,send);return true;}
    await say(env,send,"✍️ Раздел отзывов скоро появится.\n\n💕 Пока можно работать с оценками.",await profileKeyboard(env,savedReview[1]));
    return true;
  }
  const savedRating=/^owner_anketa:savedrating:(\d{1,9})$/.exec(data);
  if(savedRating){
    if(!await selectedAccount(env,savedRating[1])){
      await showSaved(env,send,savedRating[1]);return true;
    }
    if(await ensureNoRepeat(env,savedRating[1],"rating",send))return true;
    const rec=await savedGet(env,savedRating[1]);
    if(!rec){await showLibrary(env,send);return true;}
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    if(rec.catalog?.length){
      await statePut(env,{step:"ratings",account:ACTIVE_ACCOUNT,profile:rec.profile,host:rec.host,catalog:organizeCatalog(rec.catalog),selected:{},nonce});
      await navigationSay(env,send,"🌹 ВАША ФОРМА ГОТОВА!\n\n💎 Откройте сохранённый перечень услуг и отметьте нужное.\n💕 Все отметки начинаются с чистого листа.",
        buttons([[{text:"💎 Заполнить оценки",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+nonce}}],
        [{text:"⬅️ К анкете",callback_data:"owner_anketa:saved:"+savedRating[1]}]]));
      return true;
    }
    await statePut(env,{step:"ratings_loading",account:ACTIVE_ACCOUNT,id:rec.profile.id,nonce,previousNonce:nonce,profile:rec.profile,host:rec.host});
    let started=false;
    try{started=(await dispatchLookup(env,rec.profile.id,nonce,"ratings",rec.host)).ok;}catch{}
    if(!started){await say(env,send,"🌷 Пока не получилось загрузить услуги. Попробуйте ещё раз позже.");return true;}
    await navigationSay(env,send,"🌸 Первый раз собираю доступные услуги этой анкеты. Это займёт немного времени.\n✨ В дальнейшем форма будет открываться сразу.");
    return true;
  }
  const deleteAsk=/^owner_anketa:deleteask:(\d{1,9})$/.exec(data);
  if(deleteAsk){
    if(!await savedGet(env,deleteAsk[1])){await showLibrary(env,send);return true;}
    await navigationSay(env,send,"🌷 Удалить анкету №"+deleteAsk[1]+" из вашего списка и хранилища DAME CAMELIAS?\n\nЭто действие нельзя отменить.",
      buttons([[{text:"🗑 Да, удалить",callback_data:"owner_anketa:deleteyes:"+deleteAsk[1]}],
        [{text:"↩️ Оставить анкету",callback_data:"owner_anketa:saved:"+deleteAsk[1]}]]));
    return true;
  }
  const deleteYes=/^owner_anketa:deleteyes:(\d{1,9})$/.exec(data);
  if(deleteYes){
    await savedDelete(env,deleteYes[1]);
    const currentState=await stateGet(env);
    if(String(currentState?.profile?.id||currentState?.id)===deleteYes[1])await env.VISITORS_KV.delete(PREFIX+OWNER_ID);
    await showLibrary(env,send);
    return true;
  }
  const current=await stateGet(env);
  if(data.startsWith("owner_anketa:confirm:")) {
    const nonce=data.slice("owner_anketa:confirm:".length);
    if(current && ["chosen","ratings"].includes(current.step) && current.nonce===nonce) {
      await say(env,send,"✅ Анкета "+current.profile.name+" уже подтверждена. 🌹\n\n💕 Продолжим работу с ней?",
        buttons([[{text:"⭐ Оценки",callback_data:"owner_anketa:rating:"+nonce}],
                 [{text:"✍️ Отзыв",callback_data:"owner_anketa:review:"+nonce}],NEW_NUMBER]));
      return true;
    }
    if(!current || current.step!=="confirm" || current.nonce!==nonce) {
      await say(env,send,"⏳ Подтверждение устарело. Нажми 🔐 АНКЕТА и введи номер заново.");
      return true;
    }
    const prior=await savedGet(env,current.profile.id);
    await savedPut(env,{profile:current.profile,host:current.host,catalog:prior?.catalog||[]});
    await statePut(env,{step:"chosen",profile:current.profile,host:current.host,nonce});
    await showSaved(env,send,current.profile.id);
    return true;
  }
  const consent=/^owner_anketa:consent:([a-f0-9]{12})$/.exec(data);
  if(consent) {
    if(current?.account!==ACTIVE_ACCOUNT || !await selectedAccount(env,current.profile?.id)){
      await say(env,send,"🌷 Сначала выберите 👨‍💻 Ян Первый в меню анкеты.");return true;
    }
    if(current?.profile?.id && await ensureNoRepeat(env,current.profile.id,"rating",send))return true;
    if(!current || current.step!=="ratings" || current.nonce!==consent[1] || !current.draftReady) {
      await say(env,send,"🌷 Это подтверждение уже неактуально. Откройте форму оценок и проверьте выбор ещё раз.");
      return true;
    }
    const picks=Object.keys(current.selected||{}).map(Number).sort((a,b)=>a-b).map(i=>({
      index:i,label:current.catalog[i]?.label,value:current.selected[i]
    }));
    const approved={...current,step:"ratings_agreed",agreedAt:Date.now()};
    if(!picks.length || picks.length>120 || picks.some(x=>!x.label||typeof x.value!=="string")){
      await statePut(env,approved);
      await say(env,send,"⚠️ Подготовка остановлена: не удалось проверить перечень оценок. Ничего не опубликовано.");
      return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const pending={...approved,step:"dryfill_loading",id:current.profile.id,previousNonce:current.nonce,
      nonce,prepublish:true};
    if(!await statePut(env,pending)){
      await say(env,send,"⚠️ Не удалось сохранить подготовку. Ничего не опубликовано.");return true;
    }
    await say(env,send,"🌹 ПОДГОТОВКА К ПУБЛИКАЦИИ\n\n💎 Ваши оценки приняты.\n\n🔐 Проверяю правильность заполнения всех выбранных полей.\n🌏 Нахожу вашу анкету через поиск по району. \n\n⏳ Пожалуйста, подождите немного.\n\n🌷 Пока ничего на сайт не отправляется.");
    let started=false;
    try{started=(await dispatchLookup(env,pending.id,nonce,"dryfill",current.host)).ok;}catch{}
    if(!started){
      await statePut(env,approved);
      await say(env,send,"⚠️ Не удалось запустить подготовку. Ничего не опубликовано.");
    }
    return true;
  }
  const publishConfirm=/^owner_anketa:publish_confirm:([a-f0-9]{12})$/.exec(data);
  if(publishConfirm){
    if(current?.account!==ACTIVE_ACCOUNT || !await selectedAccount(env,current.profile?.id)){
      await say(env,send,"🌷 Для публикации нужно заново выбрать 👨‍💻 Ян Первый и подготовить оценки.");return true;
    }
    if(current?.profile?.id && await ensureNoRepeat(env,current.profile.id,"rating",send))return true;
    if(!current || current.step!=="prepublish_ready" || current.nonce!==publishConfirm[1] ||
        !current.readyAt || Date.now()-current.readyAt>15*60*1000){
      await say(env,send,"🌷 Подтверждение устарело. Проверьте оценки повторно.");return true;
    }
    // Permanent per-profile guard before the external submission is dispatched.
    if(!await recordPublication(env,current.profile.id,"rating","publishing","owner-confirmation")){
      await say(env,send,"🔒 Публикация уже была начата или завершена. Повтор запрещён.");
      return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const pending={...current,step:"publishing",id:current.profile.id,
      nonce,previousNonce:current.nonce,readyAt:null,
      confirmedAt:Date.now(),dispatchPending:true};
    if(!await statePut(env,pending)){
      await say(env,send,"⚠️ Не удалось сохранить подтверждение. Ничего не опубликовано.");
      return true;
    }
    await say(env,send,"🌹 ПУБЛИКАЦИЯ ЗАПУЩЕНА\n\n🆔 Анкета №"+pending.id+
      "\n⏳ Отправляю оценки через ваш прокси. Повторно нажимать кнопку не нужно.");
    let launched=false;
    try{launched=(await dispatchLookup(env,pending.id,nonce,"publish",current.host)).ok;}catch{}
    if(!launched){
      // Dispatch may have succeeded despite a transport timeout. Do not restore
      // the ready-to-publish state or trigger a second attempt.
      await say(env,send,"⚠️ GitHub не подтвердил запуск. Автоматического повтора не будет. Проверьте GitHub Actions.");
    }
    return true;
  }
  const publishCancel=/^owner_anketa:publish_cancel:([a-f0-9]{12})$/.exec(data);
  if(publishCancel){
    if(current?.step==="prepublish_ready" && current.nonce===publishCancel[1]){
      await statePut(env,{...current,step:"ratings_agreed",prepublish:false,readyAt:null});
      await say(env,send,"❌ Подготовка отменена. Ничего не опубликовано.");
    }
    return true;
  }
  const dryfill=/^owner_anketa:dryfill:([a-f0-9]{12})$/.exec(data);
  if(dryfill){
    if(current?.profile?.id && await ensureNoRepeat(env,current.profile.id,"rating",send))return true;
    if(!current || current.step!=="ratings_agreed" || current.nonce!==dryfill[1] ||
        !Object.keys(current.selected||{}).length){
      await say(env,send,"🌷 Для теста подтвердите новый отчёт оценок.");return true;
    }
    const picks=Object.keys(current.selected).map(Number).sort((a,b)=>a-b).map(i=>({
      index:i,label:current.catalog[i]?.label,value:current.selected[i]
    }));
    if(picks.some(x=>!x.label||typeof x.value!=="string")||picks.length>120){
      await say(env,send,"⚠️ Некорректный перечень выбранных полей.");return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const pending={...current,step:"dryfill_loading",id:current.profile.id,previousNonce:current.nonce,nonce};
    await statePut(env,pending);
    let started=false;
    try{started=(await dispatchLookup(env,pending.id,nonce,"dryfill",current.host)).ok;}catch{}
    if(!started){
      await statePut(env,current);
      await say(env,send,"🌷 Тестовый запуск не удался. Ничего не опубликовано.");return true;
    }
    await say(env,send,"🧪 Проверяю выбранные поля анкеты №"+pending.id+
      " во временном браузере.\n\n🌷 Отправка формы на Intimcity отключена.");
    return true;
  }
  const audit=/^owner_anketa:audit:([a-f0-9]{12})$/.exec(data);
  if(audit){
    if(current?.profile?.id && await ensureNoRepeat(env,current.profile.id,"rating",send))return true;
    if(!current || current.step!=="ratings_agreed" || current.nonce!==audit[1] ||
        !Object.keys(current.selected||{}).length){
      await say(env,send,"🌷 Сначала подтвердите новый отчёт с оценками.");return true;
    }
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const pending={...current,step:"audit_loading",id:current.profile.id,
      previousNonce:current.nonce,nonce};
    await statePut(env,pending);
    let started=false;
    try{started=(await dispatchLookup(env,pending.id,nonce,"mapping",current.host)).ok;}catch{}
    if(!started){
      await statePut(env,current);
      await say(env,send,"🌷 Не удалось запустить проверку. Оценки на сайт не отправлялись.");
      return true;
    }
    await say(env,send,"🔎 Проверяю технические поля Intimcity для анкеты №"+pending.id+
      ".\n\n🌷 Это только диагностика — оценок на сайте не будет.");
    return true;
  }
  const toggle=/^owner_anketa:toggle:(\d+):([a-f0-9]{12})$/.exec(data);
  if(toggle) {
    const i=Number(toggle[1]);
    if(current?.step!=="ratings"||current.nonce!==toggle[2]||!current.catalog[i]) return true;
    const chosen={...(current.selected||{})};
    const options=current.catalog[i].options.filter(v=>v.toLowerCase()!=="не знаю");
    if(chosen[i]!==undefined) delete chosen[i];
    else chosen[i]=options.includes("5")?"5":(options[0]||"");
    const next={...current,selected:chosen};
    await statePut(env,next);
    if(cb?.message?.message_id) {
      try {
        await send(env,"editMessageText",{chat_id:OWNER_ID,message_id:cb.message.message_id,
          text:ratingSummary(next),reply_markup:ratingMenu(next)});
        return true;
      } catch {}
    }
    await say(env,send,ratingSummary(next),ratingMenu(next));
    return true;
  }
  const option=/^owner_anketa:option:(\d+):(\d+):([a-f0-9]{12})$/.exec(data);
  if(option && current?.step==="ratings" && current.nonce===option[3]) {
    const i=Number(option[1]),j=Number(option[2]),value=current.catalog[i]?.options[j];
    if(!value || value.toLowerCase()==="не знаю") return true;
    const next={...current,selected:{...(current.selected||{}),[i]:value}};
    await statePut(env,next);
    try {
      await send(env,"editMessageText",{chat_id:OWNER_ID,message_id:cb.message.message_id,
        text:ratingSummary(next),reply_markup:ratingMenu(next)});
    } catch { await say(env,send,ratingSummary(next),ratingMenu(next)); }
    return true;
  }
  const preview=/^owner_anketa:preview:([a-f0-9]{12})$/.exec(data);
  if(preview && current?.step==="ratings" && preview[1]===current.nonce) {
    const lines=current.catalog.map((f,i)=>"• "+f.label+": "+(current.selected?.[i]??"Не знаю"));
    await say(env,send,"💎 ВАШ ЧЕРНОВИК\n\n"+lines.join("\n")+
      "\n\n🌷 Ничего не опубликовано.",buttons([[{text:"⬅️ К выбору",callback_data:"owner_anketa:criteria:"+current.nonce}],NEW_NUMBER]));
    return true;
  }
  const reset=/^owner_anketa:reset:([a-f0-9]{12})$/.exec(data);
  if(reset&&current?.step==="ratings"&&reset[1]===current.nonce) {
    const next={...current,selected:{}};
    await statePut(env,next);
    await say(env,send,ratingSummary(next),ratingMenu(next));
    return true;
  }
  const chosenCriterion=/^owner_anketa:criterion:(\d+):([a-f0-9]{12})$/.exec(data);
  if(chosenCriterion) {
    const index=Number(chosenCriterion[1]);
    if(current?.step!=="ratings" || current.nonce!==chosenCriterion[2] || !current.catalog[index]) {
      await say(env,send,"⏳ Эти данные уже устарели. Пожалуйста, выберите анкету заново.");
      return true;
    }
    const item=current.catalog[index];
    await say(env,send,"⭐ "+item.label+"\n\n💖 Доступные варианты:\n"+
      item.options.map((v,i)=>(i+1)+". "+v).join("\n")+
      "\n\n🌷 Это информация с сайта. Пока ничего не отправляем.",
      buttons([[{text:"⬅️ К списку оценок",callback_data:"owner_anketa:criteria:"+current.nonce}],NEW_NUMBER]));
    return true;
  }
  if(data.startsWith("owner_anketa:criteria:")) {
    const nonce=data.slice("owner_anketa:criteria:".length);
    if(current?.step!=="ratings" || current.nonce!==nonce) return true;
    await say(env,send,"🌹 Доступные категории оценок для "+current.profile.name+":",
      ratingMenu(current));
    return true;
  }
  const match=/^owner_anketa:(rating|review):([a-f0-9]{12})$/.exec(data);
  if(match) {
    if(!current?.profile?.id || !await selectedAccount(env,current.profile.id) ||
       current.account!==ACTIVE_ACCOUNT){
      if(current?.profile?.id)await showSaved(env,send,current.profile.id);
      else await showLibrary(env,send);
      return true;
    }
    if(current?.step==="ratings" && current.nonce===match[2]) {
      if(match[1]==="rating") await say(env,send,ratingSummary(current),ratingMenu(current));
      else await say(env,send,"✍️ Раздел отзывов пока подготавливается.\n\n💕 Спасибо за терпение!");
      return true;
    }
    if(!current || current.step!=="chosen" || current.nonce!==match[2]) {
      await say(env,send,"⏳ Сначала подтвердите анкету."); return true;
    }
    if(match[1]==="rating") {
      const lookupNonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
      await statePut(env,{step:"ratings_loading",account:ACTIVE_ACCOUNT,id:current.profile.id,nonce:lookupNonce,
        previousNonce:current.nonce,profile:current.profile,host:current.host});
      let launched=false;
      try { launched=(await dispatchLookup(env,current.profile.id,lookupNonce,"ratings",current.host)).ok; } catch {}
      if(!launched) {
        await statePut(env,current);
        await say(env,send,"🌷 Не удалось начать загрузку оценок. Попробуйте ещё раз немного позже.");
        return true;
      }
      await say(env,send,"🌸 Минутку, пожалуйста!\n\n💕 Проверяю доступные категории оценок для анкеты "+current.profile.name+".\n✨ Скоро всё будет готово!");
      return true;
    }
    await say(env,send,"✍️ Раздел отзывов пока подготавливается.\n\n💕 Спасибо за терпение!");
    return true;
  }
  return ownerAction;
}

export async function ownerRatingFormApi(request, env, send, verifyTelegram) {
  if (Number(request.headers.get("content-length")||0)>30000) return new Response("Too large",{status:413});
  let input;
  try { input=await request.json(); } catch {return new Response("Invalid JSON",{status:400});}
  if (!await verifyTelegram(input.initData,env.BOT_TOKEN,3600)) return new Response("Forbidden",{status:403});
  let user;
  try {user=JSON.parse(new URLSearchParams(input.initData).get("user")||"null");}catch{}
  if(String(user?.id)!==OWNER_ID) return new Response("Forbidden",{status:403});
  const state=await stateGet(env);
  if(!state || !["ratings","ratings_agreed"].includes(state.step) || state.nonce!==input.key) return Response.json({error:"expired"},{status:409});
  const existingRating=await publicationStatus(env,state.profile?.id,"rating");
  if(existingRating)return Response.json({error:"already_published_or_pending"},{status:409});
  if(state.account!==ACTIVE_ACCOUNT ||
      !await selectedAccount(env,state.profile?.id))
    return Response.json({error:"account_not_selected"},{status:409});
  if(input.action==="load") return Response.json({
    profile:state.profile,selected:state.selected||{},metElsewhere:state.metElsewhere===true,catalog:organizeCatalog(state.catalog).map(x=>({
      label:x.label,group:x.group||"Оценки анкеты",subgroup:x.subgroup||"",
      options:x.options.filter(v=>!/^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(v))
    }))
  },{headers:{"Cache-Control":"no-store"}});
  if(input.action!=="save" || !input.selected || typeof input.selected!=="object" || Array.isArray(input.selected))
    return new Response("Invalid request",{status:400});
  if(input.metElsewhere!==undefined && typeof input.metElsewhere!=="boolean")return new Response("Invalid checkbox",{status:400});
  const metElsewhere=input.metElsewhere===true;
  const safe={};
  const photoIndices=new Set(state.catalog.map((f,i)=>/^(?:isFair|Фото соответствует)$/i.test(String(f.label||"").trim())?i:-1).filter(i=>i>=0));
  for(const [index,value] of Object.entries(input.selected)) {
    if(photoIndices.has(Number(index)) && value!=="Фото соответствует")
      return new Response("Invalid photo value",{status:400});
    if(!/^(0|[1-9]\d{0,2})$/.test(index)) return new Response("Invalid field",{status:400});
    const field=state.catalog[Number(index)];
    if(!field || typeof value!=="string" || !field.options.includes(value) ||
        /^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(value)) return new Response("Invalid choice",{status:400});
    safe[index]=value;
  }
  // The owner-only photo correspondence answer is fixed and never editable.
  for(const i of photoIndices){
    if(!state.catalog[i].options.includes("Фото соответствует"))
      return new Response("Unavailable photo option",{status:409});
    safe[i]="Фото соответствует";
  }
  await statePut(env,{...state,step:"ratings",selected:safe,metElsewhere,draftReady:true,agreedAt:null});
  // Preserve source field order and group headings in the Telegram review.
  const selected=Object.entries(safe).sort((a,b)=>Number(a[0])-Number(b[0]));
  const orderedFields=organizeCatalog(state.catalog);
  const sections=[];
  let lastGroup="";
  let lastSubgroup="";
  for(const [i,v] of selected){
    const field=orderedFields[Number(i)];
    const group=field.group||"Оценки анкеты";
    if(group!==lastGroup){sections.push("\n━━━━━━━━━━━━\n💎 "+group);lastGroup=group;lastSubgroup="";}
    const subgroup=field.subgroup||"";
    if(subgroup && subgroup!==lastSubgroup)sections.push("\n"+subgroup+"\n────────────");
    lastSubgroup=subgroup;
    sections.push(field.label==="Фото соответствует" && v==="Фото соответствует" ? "• Фото соответствует" : "• "+field.label+": "+(v==="5"?"5⭐":v));
  }
  if(metElsewhere)sections.push("\n☑️ Встречался по другой анкете");
  const intro="🌹 ВАШИ ОЦЕНКИ ГОТОВЫ\n\n👤 "+state.profile.name+
    "\n🆔 №"+state.profile.id+"\n";
  const footer="\n🌷 Пожалуйста, проверьте выбор. Это только черновик, оценки на сайт не отправлялись.";
  const textLines=sections.length?sections:["\nПока ничего не выбрано"];
  const pages=[];let page=intro;
  for(const line of textLines){
    if(page.length+line.length+2>3400){pages.push(page);page="🌹 ПРОДОЛЖЕНИЕ ОЦЕНОК\n";}
    page+="\n"+line;
  }
  pages.push(page+footer);
  for(let n=0;n<pages.length;n++){
    await say(env,send,pages[n],n===pages.length-1?buttons([
      [{text:"✅ Согласна",callback_data:"owner_anketa:consent:"+state.nonce}],
      [{text:"✏️ Скорректировать анкету",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+state.nonce}}],NEW_NUMBER]):undefined);
  }
  return Response.json({ok:true});
}
