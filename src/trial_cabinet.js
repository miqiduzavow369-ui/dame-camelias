import { credits } from "./publication_credits.js";

// Independent trial cabinet. Existing owner state and publication routines remain untouched.
const USER_ID = "5627932577";
const KEY = "trial_cabinet_v1:" + USER_ID + ":";
const PIN_SHA256 = "edee29f882543b956620b26d0ee0e7e950399b1c4222f5de05e06425b4c995e9";
const PROFILE_URL = /^https:\/\/([a-z0-9-]+\.intimcity\.rip)\/indi\/anketa(\d{1,9})\.htm$/i;
const PREMIUM="https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/balance_cards/";
const menu = {inline_keyboard:[
  [{text:"➕ Ввести новую анкету",callback_data:"trial_cabinet:add"}],
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
async function navigateText(env,send,text,keyboard){
  const previous=await get(env,"navigation").catch(()=>null);
  const sent=await reply(env,send,text,keyboard);
  if(Number.isSafeInteger(sent?.message_id)){
    await put(env,"navigation",{id:sent.message_id,at:Date.now()});
    if(Number.isSafeInteger(previous?.id)&&previous.id!==sent.message_id)
      await send(env,"deleteMessage",{chat_id:USER_ID,message_id:previous.id}).catch(()=>{});
  }
  return sent;
}
async function cabinetPage(env,send,text,remaining,buttons){
  const previous=await get(env,"navigation").catch(()=>null);
  let sent=null;
  const count=Number(remaining);
  if(Number.isInteger(count)&&count>=0&&count<=20&&env.BOT_TOKEN){
    try{
      const url=PREMIUM+"balance_"+String(count).padStart(2,"0")+".png";
      const img=await fetch(url,{signal:AbortSignal.timeout(8000)});
      if(!img.ok)throw Error("card fetch");
      const bytes=await img.arrayBuffer();
      const header=new Uint8Array(bytes.slice(0,4));
      if(bytes.byteLength<100||bytes.byteLength>500000||header.join(",")!=="137,80,78,71")throw Error("card png");
      const form=new FormData();
      form.set("chat_id",USER_ID);
      form.set("caption",text.slice(0,1000));
      form.set("protect_content","true");
      form.set("reply_markup",JSON.stringify(buttons));
      form.set("photo",new Blob([bytes],{type:"image/png"}),"balance.png");
      const result=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/sendPhoto",{method:"POST",body:form,signal:AbortSignal.timeout(12000)});
      const body=await result.json();
      if(!result.ok||!body.ok||!body.result?.message_id)throw Error("telegram photo");
      sent=body.result;
    }catch(e){console.error("Trial premium card fallback",String(e).slice(0,80));}
  }
  if(!sent)return navigateText(env,send,"🌹 DAME CAMELIAS\n\n🔐 ЛИЧНЫЙ КАБИНЕТ\n\n"+text,buttons);
  if(Number.isSafeInteger(sent?.message_id)){
    await put(env,"navigation",{id:sent.message_id,at:Date.now()});
    if(Number.isSafeInteger(previous?.id)&&previous.id!==sent.message_id)
      await send(env,"deleteMessage",{chat_id:USER_ID,message_id:previous.id}).catch(()=>{});
  }
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
    const nav=await get(env,"navigation").catch(()=>null);
    if(Number.isSafeInteger(nav?.id))await send(env,"deleteMessage",{chat_id:USER_ID,message_id:nav.id}).catch(()=>{});
    await env.VISITORS_KV.delete(KEY+"navigation");
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
  if(action.startsWith("trial_cabinet:profile:")){
    const id=action.slice("trial_cabinet:profile:".length);
    const profiles=await get(env,"profiles")??[];
    if(profiles.some(p=>p.id===id))await navigateText(env,send,"🌹 АНКЕТА №"+id+"\n\n⏳ Анкета сохранена, но ещё не проверена. После подключения проверки здесь появится карточка анкеты и доступные действия.",{inline_keyboard:[[{text:"🌹 Мои анкеты",callback_data:"trial_cabinet:open"}],[{text:"🏠 В начало",callback_data:"trial_cabinet:home"}]]});
    return true;
  }
  if(action==="trial_cabinet:add"){
    await put(env,"pending",{mode:"url"},{expirationTtl:1800});
    await navigateText(env,send,"🌹 Пришлите полную HTTPS-ссылку на анкету Intimcity.");
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
  
  const rows=[...profiles.map(p=>[{text:"🌹 АНКЕТА №"+p.id,callback_data:"trial_cabinet:profile:"+p.id}]),...menu.inline_keyboard];
  await cabinetPage(env,send,"🆔 Telegram ID: "+USER_ID+"\n\n💕 Выберите сохранённую анкету\n✨ Или добавьте новую по актуальной ссылке.",remaining,{inline_keyboard:rows});
  return true;
}
