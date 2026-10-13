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
async function lookup(env, id) {
  // The worker never contacts Intimcity directly, avoiding proxy bypass.
  // The proxy-backed service must independently verify the live profile.
  if (!env.ANKETA_LOOKUP_URL || !env.ANKETA_LOOKUP_TOKEN) return null;
  const endpoint = new URL(env.ANKETA_LOOKUP_URL);
  if (endpoint.protocol !== "https:") throw new Error("Invalid lookup endpoint");
  const response = await fetch(endpoint.href, {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+env.ANKETA_LOOKUP_TOKEN},
    body:JSON.stringify({profile_id:id}),
    signal:AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Lookup unavailable");
  return validProfile(await response.json(),id);
}
async function askNumber(env,send) {
  await statePut(env,{step:"number"});
  await say(env,send,"🔐 АНКЕТА\nОтправь номер анкеты одним сообщением, например: 750206");
}
async function inspect(env,send,id) {
  if (!ID_PATTERN.test(id)) {
    await say(env,send,"Введите номер анкеты цифрами, например 750206.");
    return;
  }
  await statePut(env,{step:"loading",id});
  let found;
  try { found = await lookup(env,id); }
  catch { found = null; }
  if (!found) {
    await statePut(env,{step:"number"});
    await say(env,send,"⚠️ Не удалось проверить данные анкеты №"+id+
      ". Ничего не подтверждено. Попробуй другой номер или повтори позже.",
      buttons([ [NEW_NUMBER] ]));
    return;
  }
  const nonce = crypto.randomUUID().slice(0,8);
  await statePut(env,{step:"confirm",profile:found,nonce});
  const location = found.metro ? "\n📍 м. "+found.metro : "";
  await say(env,send,"🌹 ПОДТВЕРЖДЕНИЕ АНКЕТЫ\n\n"+
    found.name+"\n🎂 "+found.age+" лет"+location+"\n🔢 №"+id+
    "\n🔗 "+found.url+"\n\nЭто нужная анкета?",
    buttons([[{text:"✅ Подтвердить анкету",callback_data:"owner_anketa:confirm:"+nonce}],
             NEW_NUMBER]));
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
  const typedNumber=owner && state?.step==="number" && ID_PATTERN.test(txt);
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
  const match=/^owner_anketa:(rating|review):([a-z0-9]{8})$/.exec(data);
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
