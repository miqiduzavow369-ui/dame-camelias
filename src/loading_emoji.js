export const LOADING_EMOJI_KEY="cabinet_loading_emoji_v1";
const validId=value=>typeof value==="string"&&/^\d{1,24}$/.test(value);
export function selectedLoadingEmoji(message){
 const text=message?.text;
 if(typeof text!=="string"||!/^\s*[⏳⌛]\ufe0f?\s*$/.test(text))return null;
 const entity=message.entities?.find(e=>e.type==="custom_emoji"&&validId(e.custom_emoji_id)&&/^[⏳⌛]\ufe0f?$/.test(text.slice(e.offset,e.offset+e.length)));
 return entity?{id:entity.custom_emoji_id,alt:text.slice(entity.offset,entity.offset+entity.length)}:null;
}
// Retry only an explicit Telegram 400 rejection of the custom decoration.
// A network timeout may already have delivered the message and is not retried.
export async function sendWithLoadingEmoji(env,send,method,payload){
 if(!["sendMessage","editMessageText"].includes(method)||!payload.text?.startsWith("⏳ ")||/^⏳ (?:Подтверждение устарело|Эти данные уже устарели|Сначала подтвердите)/.test(payload.text))return send(env,method,payload);
 let emoji;
 try{emoji=await env.VISITORS_KV?.get(LOADING_EMOJI_KEY,"json");}catch{}
 if(!validId(emoji?.id)||!/^[⏳⌛]\ufe0f?$/.test(emoji?.alt||"")||payload.parse_mode||payload.entities)return send(env,method,payload);
 const decorated={...payload,text:emoji.alt+payload.text.slice(1),entities:[{type:"custom_emoji",offset:0,length:emoji.alt.length,custom_emoji_id:emoji.id}]};
 try{return await send(env,method,decorated);}catch(error){if(error.telegramCode!==400)throw error;return send(env,method,payload);}
}
