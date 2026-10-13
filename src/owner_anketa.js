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
// Keep meaningful bot replies and found-profile cards in Telegram history.
// Only the transient progress message is updated; owner-entered IDs are cleaned up.
async function say(env, send, text, reply_markup) {
  return await send(env,"sendMessage",{chat_id:OWNER_ID,text,...(reply_markup?{reply_markup}:{})});
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
function validProfile(data, id) {
  if (!data || String(data.id) !== id || typeof data.name !== "string" ||
      !data.name.trim() || data.name.length > 100 ||
      !Number.isInteger(data.age) || data.age < 18 || data.age > 99 ||
      typeof data.metro !== "string" || data.metro.length > 100 ||
      data.url !== `https://a.intimcity.rip/indi/anketa${id}.htm`) return null;
  return {id,name:data.name.trim(),age:data.age,metro:data.metro.trim(),url:data.url};
}
async function dispatchLookup(env,id,nonce,mode="profile") {
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
    body:JSON.stringify({ref:"main",inputs:{profile_id:id,nonce,mode}}),
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
    const catalog = raw.slice(0,60).filter(x => x && typeof x.label === "string" && Array.isArray(x.options))
      .map(x => ({label:x.label.slice(0,90),options:x.options.filter(v=>typeof v==="string").slice(0,12).map(v=>v.slice(0,50))}));
    if(data.status!=="found" || !catalog.length || !data.profile || String(data.profile.id)!==id) {
      await statePut(env,{step:"chosen",profile,nonce:current.previousNonce});
      await say(env,send,"🌷 Сейчас не удалось загрузить категории оценок для анкеты №"+id+
        ".\n\n💕 Пожалуйста, попробуйте немного позже.",buttons([NEW_NUMBER]));
      return Response.json({ok:true,found:false});
    }
    const next={step:"ratings",profile,nonce:current.previousNonce,catalog,selected:{}};
    await statePut(env,next);
    await say(env,send,"🌹 ВСЁ ГОТОВО!\\n\\n💕 Я подготовила для вас индивидуальную форму оценок анкеты "+profile.name+
      ".\\n\\n✨ Откройте её, отметьте нужные пункты и нажмите «Готово». Все выбранные значения вернутся сюда на проверку.",
      buttons([[{text:"💎 Заполнить оценки",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+next.nonce}}],NEW_NUMBER]));
    return Response.json({ok:true,found:true});
  }
  const found=validProfile(data.profile,id);
  if(!found) {
    await statePut(env,{step:"number"});
    const empty = data.status === "not_found";
    await say(env,send,empty
      ? "🔎 АНКЕТА НЕ НАЙДЕНА\n\n📋 По номеру №"+id+" нет результатов поиска.\n\n🔓 Пожалуйста, включите анкету, если она отключена, или проверьте правильность введённого ID.\n\n🔄 Можете попробовать ещё раз."
      : "⚠️ Не удалось подтвердить анкету №"+id+
      " по данным Intimcity. Попробуй повторить или введи другой номер.",
      buttons([NEW_NUMBER]));
    return Response.json({ok:true,found:false});
  }
  const decision=crypto.randomUUID().replace(/-/g,"").slice(0,12);
  await statePut(env,{step:"confirm",profile:found,nonce:decision});
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
  await say(env,send,"⏳ Подождите, пожалуйста, минутку.\n🔎 Проверяю анкету №"+id+"…");
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
  const typedNumber=owner && Boolean(state) && Boolean(msg?.text) &&
    /^(?:№\s*)?\d{1,9}$/.test(txt);
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
  if (typedNumber) {
    // Only remove the owner's ID input while in the owner-only number entry step.
    // Never delete arbitrary messages in other conversations or flows.
    try { await send(env,"deleteMessage",{chat_id:OWNER_ID,message_id:msg.message_id}); } catch (_) {}
    await inspect(env,send,txt.replace(/^№\s*/,""));
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
    await statePut(env,{step:"chosen",profile:current.profile,nonce});
    await say(env,send,"✅ Анкета подтверждена: "+current.profile.name+
      ", №"+current.profile.id+"\nВыберите действие:",
      buttons([[{text:"⭐ Оценки",callback_data:"owner_anketa:rating:"+nonce}],
               [{text:"✍️ Отзыв",callback_data:"owner_anketa:review:"+nonce}],NEW_NUMBER]));
    return true;
  }
  const consent=/^owner_anketa:consent:([a-f0-9]{12})$/.exec(data);
  if(consent) {
    if(!current || current.step!=="ratings" || current.nonce!==consent[1] || !current.draftReady) {
      await say(env,send,"🌷 Это подтверждение уже неактуально. Откройте форму оценок и проверьте выбор ещё раз.");
      return true;
    }
    await statePut(env,{...current,step:"ratings_agreed",agreedAt:Date.now()});
    await say(env,send,"🌹 СПАСИБО!\\n\\n💕 Ваш выбор для анкеты "+current.profile.name+
      " подтверждён и сохранён.\\n\\n✨ Никакие оценки на сайт не отправлялись.",
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
        previousNonce:current.nonce,profile:current.profile});
      let launched=false;
      try { launched=(await dispatchLookup(env,current.profile.id,lookupNonce,"ratings")).ok; } catch {}
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
    profile:state.profile,selected:state.selected||{},catalog:state.catalog.map(x=>({
      label:x.label,
      options:x.options.filter(v=>!/^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(v))
    }))
  },{headers:{"Cache-Control":"no-store"}});
  if(input.action!=="save" || !input.selected || typeof input.selected!=="object" || Array.isArray(input.selected))
    return new Response("Invalid request",{status:400});
  const safe={};
  for(const [index,value] of Object.entries(input.selected)) {
    if(!/^(0|[1-9]\d?)$/.test(index)) return new Response("Invalid field",{status:400});
    const field=state.catalog[Number(index)];
    if(!field || typeof value!=="string" || !field.options.includes(value) ||
        /^\s*(?:не знаю|отказано|[1-4])\s*$/i.test(value)) return new Response("Invalid choice",{status:400});
    safe[index]=value;
  }
  await statePut(env,{...state,step:"ratings",selected:safe,draftReady:true,agreedAt:null});
  const selected=Object.entries(safe).sort((a,b)=>Number(a[0])-Number(b[0]))
    .map(([i,v])=>"• "+state.catalog[Number(i)].label+": "+(v==="5"?"5⭐":v));
  await say(env,send,"🌹 ВАШИ ОЦЕНКИ ГОТОВЫ\n\n👤 "+state.profile.name+
    "\n🆔 №"+state.profile.id+"\n\n"+(selected.join("\n")||"Пока ничего не выбрано")+
    "\n\n🌷 Пожалуйста, проверьте выбор. Это только черновик, оценки на сайт не отправлялись.",
    buttons([[{text:"✅ Согласна",callback_data:"owner_anketa:consent:"+state.nonce}],
      [{text:"✏️ Скорректировать анкету",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/anketa/ratings?key="+state.nonce}}],NEW_NUMBER]));
  return Response.json({ok:true});
}
