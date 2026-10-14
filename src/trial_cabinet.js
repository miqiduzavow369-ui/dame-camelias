import { credits } from "./publication_credits.js";

// Independent trial cabinet. Existing owner state and publication routines remain untouched.
const USER_ID = "5627932577";
const KEY = "trial_cabinet_v1:" + USER_ID + ":";
const PIN_SHA256 = "edee29f882543b956620b26d0ee0e7e950399b1c4222f5de05e06425b4c995e9";
const PROFILE_URL = /^https:\/\/([a-z0-9-]+\.intimcity\.rip)\/indi\/anketa(\d{1,9})\.htm$/i;
const menu = {inline_keyboard:[
  [{text:"➕ Добавить анкету",callback_data:"trial_cabinet:add"}],
  [{text:"🔄 Обновить",callback_data:"trial_cabinet:open"}],
  [{text:"🏠 В начало",callback_data:"trial_cabinet:home"}]
]};
const get = (env,k) => env.VISITORS_KV.get(KEY+k,"json");
const put = (env,k,v,options) => env.VISITORS_KV.put(KEY+k,JSON.stringify(v),options);
async function matchesPin(value) {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  const digest = [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
  return digest===PIN_SHA256;
}
async function reply(env,send,text,keyboard) {
  return send(env,"sendMessage",{chat_id:USER_ID,text,...(keyboard?{reply_markup:keyboard}:{})});
}
export async function handleTrialCabinet(update,env,send) {
  const callback=update.callback_query;
  const msg=update.message;
  const from=callback?.from??msg?.from;
  const chat=callback?.message?.chat??msg?.chat;
  const action=String(callback?.data??"");
  const selected=action.startsWith("trial_cabinet:");
  const allowed=String(from?.id)===USER_ID&&String(chat?.id)===USER_ID&&chat?.type==="private";
  if(selected&&!allowed) {
    if(callback) await send(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"Недоступно"}).catch(()=>{});
    return true;
  }
  if(!allowed||!env.VISITORS_KV) return selected;
  let pending=await get(env,"pending");
  const locked=await get(env,"lock");
  if(locked?.until>Date.now()){
    if(selected||pending) await reply(env,send,"🔒 Вход временно заблокирован. Повторите через 15 минут.");
    return Boolean(selected||pending);
  }
  if(!selected&&!pending)return false;
  if(callback)await send(env,"answerCallbackQuery",{callback_query_id:callback.id}).catch(()=>{});
  if(action==="trial_cabinet:home"){
    await env.VISITORS_KV.delete(KEY+"pending");
    return "home";
  }
  const txt=String(msg?.text??"").trim();
  if(!(await get(env,"session"))?.verified){
    if(pending?.mode==="pin"&&msg?.text){
      if(pending.attempts>=4){
        await put(env,"lock",{until:Date.now()+15*60*1000},{expirationTtl:900});
        await env.VISITORS_KV.delete(KEY+"pending");
        await reply(env,send,"🔒 Лимит попыток. Повторите вход позже.");
        return true;
      }
      if(!(await matchesPin(txt))){
        if(pending.attempts>=3){
          await put(env,"lock",{until:Date.now()+15*60*1000},{expirationTtl:900});
          await env.VISITORS_KV.delete(KEY+"pending");
          await reply(env,send,"🔒 Лимит попыток. Повторите через 15 минут.");
          return true;
        }
        await put(env,"pending",{mode:"pin",attempts:pending.attempts+1},{expirationTtl:900});
        await reply(env,send,"🔐 Код не подошёл.");
        return true;
      }
      await put(env,"session",{verified:true});
      await env.VISITORS_KV.delete(KEY+"pending");
      pending=null;
    } else {
      await put(env,"pending",{mode:"pin",attempts:0},{expirationTtl:900});
      await reply(env,send,"🔐 МОИ АНКЕТЫ\n\nВведите индивидуальный код клиента.");
      return true;
    }
  }
  if(action==="trial_cabinet:add"){
    await put(env,"pending",{mode:"url"},{expirationTtl:1800});
    await reply(env,send,"🌹 Пришлите полную HTTPS-ссылку на анкету Intimcity.");
    return true;
  }
  if(pending?.mode==="url"&&msg?.text){
    const match=PROFILE_URL.exec(txt);
    if(!match){
      await reply(env,send,"🔗 Нужна корректная ссылка Intimcity без параметров.");
      return true;
    }
    const profiles=await get(env,"profiles")??[];
    if(!profiles.some(p=>p.id===match[2])){
      profiles.push({id:match[2],url:txt});
      await put(env,"profiles",profiles);
    }
    await env.VISITORS_KV.delete(KEY+"pending");
  }
  const profiles=await get(env,"profiles")??[];
  let remaining="недоступен";
  try {
    const balance=await credits(env,USER_ID,"status");
    remaining=String(balance.available??balance.remaining??balance.balance??"уточняется");
  }catch{}
  const listing=profiles.length?profiles.map(p=>"🌹 Анкета №"+p.id+"\n"+p.url).join("\n\n"):"Анкет пока нет.";
  await reply(env,send,"🌹 МОИ АНКЕТЫ\n\n💎 Баланс: "+remaining+"\n\n"+listing+"\n\nℹ️ Размещение публикаций в пробном кабинете пока недоступно.",menu);
  return true;
}
