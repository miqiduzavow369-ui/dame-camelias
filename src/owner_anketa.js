// Owner-only questionnaire. Profile identity must come from a verified
// proxy-backed lookup service; never guess a name, age, or district.
const OWNER_ID = "5866034656";
const PREFIX = "owner_anketa_state:";
const ID_PATTERN = /^\d{1,9}$/;
const TTL_SECONDS = 1800;

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
function buttons(rows) { return {inline_keyboard:rows}; }
const NEW_NUMBER = [{text:"🔄 Ввести другую анкету",callback_data:"owner_anketa:change"}];
async function say(env, send, text, reply_markup) {
  await send(env, "sendMessage", {chat_id:OWNER_ID,text, ...(reply_markup?{reply_markup}:{})});
}
function validProfile(data, id) {
  if (!data || String(data.id) !== id || typeof data.name !== "string" ||
      !data.name.trim() || data.name.length > 100 ||
      !Number.isInteger(data.age) || data.age < 18 || data.age > 99 ||
      typeof data.metro !== "string" || data.metro.length > 100 ||
      data.url !== `https://a.intimcity.rip/indi/anketa${id}.htm`) return null;
  return {id,name:data.name.trim(),age:data.age,metro:data.metro.trim(),url:data.url};
}
async function dispatchLookup(env,id,nonce) {
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
    body:JSON.stringify({ref:"main",inputs:{profile_id:id,nonce}}),
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
  if(!current||current.step!=="loading"||current.id!==id||current.nonce!==nonce)
    return new Response("Stale",{status:409});
  const found=validProfile(data.profile,id);
  if(!found) {
    await statePut(env,{step:"number"});
    await say(env,send,"⚠️ Не удалось подтвердить анкету №"+id+
      " по данным Intimcity. Попробуй повторить или введи другой номер.",
      buttons([NEW_NUMBER]));
    return Response.json({ok:true,found:false});
  }
  const decision=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  await statePut(env,{step:"confirm",profile:found,nonce:decision});
  const location=found.metro?"\\n📍 м. "+found.metro:"";
  await say(env,send,"🌹 ПОДТВЕРЖДЕНИЕ АНКЕТЫ\\n\\n"+found.name+
    "\\n🎂 "+found.age+" лет"+location+"\\n🔢 №"+id+"\\n🔗 "+
    found.url+"\\n\\nЭто нужная анкета?",
    buttons([[{text:"✅ Подтвердить анкету",callback_data:"owner_anketa:confirm:"+decision}],
      NEW_NUMBER]));
  return Response.json({ok:true,found:true});
}
async function askNumber(env,send) {
  if (!await statePut(env,{step:"number"})) {
    await say(env,send,"⚠️ Хранилище состояния не настроено. Ввод анкеты сейчас недоступен.");
    return;
  }
  await say(env,send,"🔐 АНКЕТА\nОтправь номер анкеты одним сообщением, например: 750206");
}
async function inspect(env,send,id) {
  if (!ID_PATTERN.test(id)) {
    await say(env,send,"Введите номер анкеты цифрами, например 750206.");
    return;
  }
  const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  if(!await statePut(env,{step:"loading",id,nonce})) {
    await say(env,send,"⚠️ Хранилище недоступно.");
    return;
  }
  let dispatched;
  try {dispatched=await dispatchLookup(env,id,nonce);}
  catch {dispatched={ok:false,reason:"Не удалось связаться с GitHub API"};}
  if(!dispatched?.ok) {
    await statePut(env,{step:"number"});
    await say(env,send,"⚠️ Автоматическая проверка не запущена.\nПричина: "+dispatched.reason);
    return;
  }
  await say(env,send,"🔎 Проверяю анкету №"+id+
    " на Intimcity через прокси. Как только получу имя, возраст и метро, пришлю подтверждение.");
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
  const typedNumber=owner && state?.step==="number" && Boolean(msg?.text);
  if (!ownerAction && !typedNumber) return false;
  if (!owner) {
    if(cb) await send(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Недоступно"});
    return true;
  }
  if(cb) await send(env,"answerCallbackQuery",{callback_query_id:cb.id});
  if (data==="owner_anketa:open" || data==="owner_anketa:change" ||
      (command==="/anketa" && txt.split(/\s+/).length===1)) {
    await askNumber(env,send); return true;
  }
  if (command==="/anketa") {
    const id=txt.split(/\s+/)[1] ?? "";
    await inspect(env,send,id); return true;
  }
  if (typedNumber) { await inspect(env,send,txt); return true; }
  const current=await stateGet(env);
  if(data.startsWith("owner_anketa:confirm:")) {
    const nonce=data.slice("owner_anketa:confirm:".length);
    if(!current || current.step!=="confirm" || current.nonce!==nonce) {
      await say(env,send,"⏳ Подтверждение устарело. Нажми 🔐 АНКЕТА и введи номер заново.");
      return true;
    }
    await statePut(env,{step:"chosen",profile:current.profile,nonce});
    await say(env,send,"✅ Анкета подтверждена: "+current.profile.name+
      ", №"+current.profile.id+"\nВыберите действие:",
      buttons([[{text:"⭐ Оценки",callback_data:"owner_anketa:rating:"+nonce}],
               [{text:"✍️ Отзыв",callback_data:"owner_anketa:review:"+nonce}],NEW_NUMBER]));
    return true;
  }
  const match=/^owner_anketa:(rating|review):([a-f0-9]{12})$/.exec(data);
  if(match) {
    if(!current || current.step!=="chosen" || current.nonce!==match[2]) {
      await say(env,send,"⏳ Сначала подтвердите анкету."); return true;
    }
    await say(env,send,"🔒 Анкета №"+current.profile.id+"\n"+
      (match[1]==="rating"?"⭐ Оценки":"✍️ Отзыв")+
      "\nФорма пока не подключена. Публикации отключены.");
    return true;
  }
  return ownerAction;
}
