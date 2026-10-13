// Owner-only questionnaire. Profile identity must come from a verified
// proxy-backed lookup service; never guess a name, age, or district.
const OWNER_ID = "5866034656";
const PREFIX = "owner_anketa_state:";
const ID_PATTERN = /^\d{1,9}$/;
const TTL_SECONDS = 1800;
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
  [{text:"➕ Ввести новую анкету",callback_data:"owner_anketa:new"}]
]);
function profileKeyboard(id){return buttons([
  [{text:"⭐ Оценки",callback_data:"owner_anketa:savedrating:"+id}],
  [{text:"✍️ Отзыв",callback_data:"owner_anketa:savedreview:"+id}],
  [{text:"🗑 Удалить анкету",callback_data:"owner_anketa:deleteask:"+id}],
  [{text:"⬅️ К моим анкетам",callback_data:"owner_anketa:open"}]
]);}
async function showLibrary(env,send){
  await cleanAnketaChat(env,send);
  const ids=await libraryGet(env);
  await say(env,send,ids.length?
    "🌹 МОИ АНКЕТЫ DAME CAMELIAS\n\n💕 Выберите сохранённую анкету — проверять её повторно не потребуется.\n\n✨ Или добавьте новую по актуальной ссылке.":
    "🌹 DAME CAMELIAS\n\n💕 Пока нет сохранённых анкет. Приглашаю добавить первую!",
    libraryKeyboard(ids));
}
async function showSaved(env,send,id) {
  const record=await savedGet(env,id);
  if(!record){await showLibrary(env,send);return;}
  await say(env,send,"🌹 АНКЕТА №"+id+"\n\n👤 "+record.profile.name+
    "\n🔗 "+record.profile.url+"\n\n💕 Что бы вы хотели подготовить?",
    profileKeyboard(id));
}
const CHAT_IDS_KEY="owner_anketa_chat_ids:"+OWNER_ID;
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
  let section="Основной перечень";
  return catalog.map(field=>{
    const label=String(field.label||"").trim(),low=label.toLowerCase();
    const group=String(field.group||"").trim(),g=group.toLowerCase();
    const nested=String(field.subgroup||"").trim().toLowerCase();
    if(/массаж/.test(g+" "+nested)||/^(классический|расслабляющий)$/.test(low))section="Массаж";
    else if(/бдсм|bdsm/.test(g+" "+nested)||low==="игры")section="БДСМ";
    else if(/^(другое|другие услуги|дополнительные услуги)$/.test(g)||/^(другое|другие услуги|дополнительные услуги)$/.test(low))section="Другое";
    else if(/основн|новая оценка/.test(g)) {
      // The generic form title is not a section boundary after Massage/BDSM.
      if(section==="Основной перечень")section="Основной перечень";
    }
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
  return {id,name:data.name.trim(),age:data.age,metro:data.metro.trim(),url:data.url};
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
  const ratingsLoading = current?.step === "ratings_loading" && data.mode === "ratings";
  if(!current || (!ratingsLoading && current.step!=="loading") || current.id!==id || current.nonce!==nonce)
    return new Response("Stale",{status:409});
  if(ratingsLoading) {
    const profile = current.profile;
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
    const next={step:"ratings",profile,host:current.host,nonce:current.previousNonce,catalog:orderedCatalog,selected:{}};
    await savedPut(env,{profile,host:current.host,catalog:orderedCatalog});
    await statePut(env,next);
    await say(env,send,"🌹 ВСЁ ГОТОВО!\n\n💕 Я подготовила для вас индивидуальную форму оценок анкеты "+profile.name+
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
  await say(env,send,"🌹 АНКЕТА НАЙДЕНА\n\n👤 "+found.name+
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
  await say(env,send,"🌹 ДОБРО ПОЖАЛОВАТЬ В DAME CAMELIAS!\n\n💕 Давайте найдём вашу анкету.\n\n🔗 Пришлите, пожалуйста, полную ссылку на анкету с актуальным доменом Intimcity одним сообщением.\n\n✨ Я бережно проверю данные и предложу дальнейшие шаги.");
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
  await say(env,send,"🌸 Минутку, пожалуйста!\n\n💕 Проверяю вашу анкету №"+id+"…\n✨ Скоро всё будет готово!");
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
    // Keep the supplied link in history for easy verification and retry.
    // Do not route a profile URL into the customer order conversation.
    await inspect(env,send,txt);
    return true;
  }
  const savedMenu=/^owner_anketa:saved:(\d{1,9})$/.exec(data);
  if(savedMenu){await showSaved(env,send,savedMenu[1]);return true;}
  const savedReview=/^owner_anketa:savedreview:(\d{1,9})$/.exec(data);
  if(savedReview){
    if(!await savedGet(env,savedReview[1])){await showLibrary(env,send);return true;}
    await say(env,send,"✍️ Раздел отзывов скоро появится.\n\n💕 Пока можно работать с оценками.",profileKeyboard(savedReview[1]));
    return true;
  }
  const savedRating=/^owner_anketa:savedrating:(\d{1,9})$/.exec(data);
  if(savedRating){
    const rec=await savedGet(env,savedRating[1]);
    if(!rec){await showLibrary(env,send);return true;}
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    if(rec.catalog?.length){
      await statePut(env,{step:"ratings",profile:rec.profile,host:rec.host,catalog:organizeCatalog(rec.catalog),selected:{},nonce});
      await say(env,send,"🌹 ВАША ФОРМА ГОТОВА!\n\n💎 Откройте сохранённый перечень услуг и отметьте нужное.\n💕 Все отметки начинаются с чистого листа.",
        buttons([[{text:"💎 Заполнить оценки",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+nonce}}],
        [{text:"⬅️ К анкете",callback_data:"owner_anketa:saved:"+savedRating[1]}]]));
      return true;
    }
    await statePut(env,{step:"ratings_loading",id:rec.profile.id,nonce,previousNonce:nonce,profile:rec.profile,host:rec.host});
    let started=false;
    try{started=(await dispatchLookup(env,rec.profile.id,nonce,"ratings",rec.host)).ok;}catch{}
    if(!started){await say(env,send,"🌷 Пока не получилось загрузить услуги. Попробуйте ещё раз позже.");return true;}
    await say(env,send,"🌸 Первый раз собираю доступные услуги этой анкеты. Это займёт немного времени.\n✨ В дальнейшем форма будет открываться сразу.");
    return true;
  }
  const deleteAsk=/^owner_anketa:deleteask:(\d{1,9})$/.exec(data);
  if(deleteAsk){
    if(!await savedGet(env,deleteAsk[1])){await showLibrary(env,send);return true;}
    await say(env,send,"🌷 Удалить анкету №"+deleteAsk[1]+" из вашего списка и хранилища DAME CAMELIAS?\n\nЭто действие нельзя отменить.",
      buttons([[{text:"🗑 Да, удалить",callback_data:"owner_anketa:deleteyes:"+deleteAsk[1]}],
        [{text:"↩️ Оставить анкету",callback_data:"owner_anketa:saved:"+deleteAsk[1]}]]));
    return true;
  }
  const deleteYes=/^owner_anketa:deleteyes:(\d{1,9})$/.exec(data);
  if(deleteYes){
    await savedDelete(env,deleteYes[1]);
    const currentState=await stateGet(env);
    if(String(currentState?.profile?.id||currentState?.id)===deleteYes[1])await env.VISITORS_KV.delete(PREFIX+OWNER_ID);
    await say(env,send,"🌷 Анкета №"+deleteYes[1]+" удалена из сохранённых данных.");
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
    if(!current || current.step!=="ratings" || current.nonce!==consent[1] || !current.draftReady) {
      await say(env,send,"🌷 Это подтверждение уже неактуально. Откройте форму оценок и проверьте выбор ещё раз.");
      return true;
    }
    await statePut(env,{...current,step:"ratings_agreed",agreedAt:Date.now()});
    await say(env,send,"🌹 СПАСИБО!\n\n💕 Ваш выбор для анкеты "+current.profile.name+
      " подтверждён и сохранён.\n\n✨ Никакие оценки на сайт не отправлялись.",
      buttons([NEW_NUMBER]));
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
      await statePut(env,{step:"ratings_loading",id:current.profile.id,nonce:lookupNonce,
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
  if(input.action==="load") return Response.json({
    profile:state.profile,selected:state.selected||{},catalog:organizeCatalog(state.catalog).map(x=>({
      label:x.label,group:x.group||"Оценки анкеты",subgroup:x.subgroup||"",
      options:x.options.filter(v=>!/^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(v))
    }))
  },{headers:{"Cache-Control":"no-store"}});
  if(input.action!=="save" || !input.selected || typeof input.selected!=="object" || Array.isArray(input.selected))
    return new Response("Invalid request",{status:400});
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
  await statePut(env,{...state,step:"ratings",selected:safe,draftReady:true,agreedAt:null});
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
    if(subgroup && subgroup!==lastSubgroup)sections.push("\n────────────\n✦ "+subgroup);
    lastSubgroup=subgroup;
    sections.push("• "+field.label+": "+(v==="5"?"5⭐":v));
  }
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
