// Owner-only client registry foundation. Provisioning is deliberately
// separate from credits and publishing until the multi-user engine is ready.
const OWNER="5866034656";
const ROOT="dc_client_registry_v1:";
const FLOW=ROOT+"owner_flow";
const REGISTRY=ROOT+"records";
const keyboard=rows=>({inline_keyboard:rows.map(([text,cmd])=>[{text,callback_data:"client_admin:"+cmd}])});
const menu=keyboard([["➕ Добавить клиента","add"],["👥 Список клиентов","list"],["🏠 В начало","home"]]);
const confirm=keyboard([["✅ Сохранить","confirm"],["❌ Отмена","cancel"]]);
const get=(env,key)=>env.VISITORS_KV.get(key,"json");
const put=(env,key,value)=>env.VISITORS_KV.put(key,JSON.stringify(value));
async function say(env,send,text,markup=menu){return send(env,"sendMessage",{chat_id:OWNER,text,reply_markup:markup});}
function userId(s){return /^\d{5,16}$/.test(s)&&s!==OWNER;}
export async function handleClientAdmin(update,env,send){
 const cb=update.callback_query,msg=update.message;
 const chat=cb?.message?.chat??msg?.chat,actor=cb?.from??msg?.from;
 const data=String(cb?.data??""),action=data.startsWith("client_admin:")?data.slice(13):null;
 if(action===null && !(String(actor?.id)===OWNER&&String(chat?.id)===OWNER&&chat?.type==="private"))return false;
 const valid=String(actor?.id)===OWNER&&String(chat?.id)===OWNER&&chat?.type==="private";
 if(!valid){if(cb&&action!==null)await send(env,"answerCallbackQuery",{callback_query_id:cb.id,text:"Недоступно"}).catch(()=>{});return action!==null;}
 if(!env.VISITORS_KV)return false;
 const flow=await get(env,FLOW);
 if(action===null&&!flow)return false;
 if(cb)await send(env,"answerCallbackQuery",{callback_query_id:cb.id}).catch(()=>{});
 const session=await get(env,"owner_cabinet_session:"+OWNER);
 if(session?.authorized!==true){
   if(action!==null)await say(env,send,"🔒 Сначала войдите в личный кабинет владельца.");
   return action!==null;
 }
 if(action==="home"){await env.VISITORS_KV.delete(FLOW);return "home";}
 if(action==="cancel"){await env.VISITORS_KV.delete(FLOW);await say(env,send,"Операция отменена.");return true;}
 if(action==="open"){await say(env,send,"🔐 УПРАВЛЕНИЕ КЛИЕНТАМИ\n\nДоступно только владельцу DAME CAMELIAS.");return true;}
 if(action==="list"){
   const records=await get(env,REGISTRY)||{};
   const items=Object.values(records).map(x=>"🆔 "+x.telegramId+" · "+x.publications+" публикаций · "+(x.enabled?"активен":"отключён"));
   await say(env,send,"👥 КЛИЕНТЫ\n\n"+(items.join("\n")||"Пока нет добавленных клиентов."));
   return true;
 }
 if(action==="add"){
   await put(env,FLOW,{step:"id"});
   await say(env,send,"➕ ДОБАВЛЕНИЕ КЛИЕНТА\n\nПришлите Telegram ID.");
   return true;
 }
 if(action==="confirm"){
   if(flow?.step!=="confirm")return true;
   const all=await get(env,REGISTRY)||{};
   if(all[flow.id]){await say(env,send,"⚠️ Клиент уже существует. Изменение его баланса требует отдельной операции.");return true;}
   all[flow.id]={telegramId:flow.id,publications:flow.count,enabled:false,createdAt:new Date().toISOString(),status:"pending_integration"};
   await put(env,REGISTRY,all);
   await env.VISITORS_KV.delete(FLOW);
   await say(env,send,"✅ Заявка на подключение сохранена.\n\n🆔 "+flow.id+"\n💎 Запрошено: "+flow.count+"\n\n⚠️ Доступ и начисления ещё не активированы. Код клиента в реестр не сохранялся.");
   return true;
 }
 if(!msg?.text||!flow)return action!==null;
 const input=msg.text.trim();
 if(flow.step==="id"){
   if(!userId(input)){await say(env,send,"⚠️ Введите корректный Telegram ID клиента.");return true;}
   await put(env,FLOW,{step:"pin",id:input});
   await say(env,send,"🔐 Введите индивидуальный код клиента.\n\nПока он используется только для подтверждения заявки и не будет записан в реестр.");
   return true;
 }
 if(flow.step==="pin"){
   if(!/^\d{4,12}$/.test(input)){await say(env,send,"⚠️ Код должен состоять из 4–12 цифр.");return true;}
   // Do not persist plaintext PIN or an unsalted hash in the shared repository/KV.
   await put(env,FLOW,{step:"count",id:flow.id});
   await say(env,send,"💎 Сколько публикаций выделить клиенту?");
   return true;
 }
 if(flow.step==="count"){
   if(!/^\d{1,5}$/.test(input)||Number(input)>10000||Number(input)<1){await say(env,send,"⚠️ Укажите количество от 1 до 10000.");return true;}
   await put(env,FLOW,{step:"confirm",id:flow.id,count:Number(input)});
   await say(env,send,"📋 ПОДТВЕРЖДЕНИЕ\n\n🆔 "+flow.id+"\n💎 "+input+" публикаций\n\n⚠️ Это только заявка. Перед полноценной активацией потребуется защищённое хранение кода и подключение реестра к журналу публикаций.",confirm);
   return true;
 }
 return false;
}
