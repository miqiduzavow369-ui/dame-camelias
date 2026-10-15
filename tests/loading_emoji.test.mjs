import test from "node:test";
import assert from "node:assert/strict";
import {selectedLoadingEmoji,sendWithLoadingEmoji,LOADING_EMOJI_KEY} from "../src/loading_emoji.js";
const id="1234567890123456789",emoji={id,alt:"⏳"};
test("only a standalone custom hourglass selects the shared waiting emoji",()=>{
 assert.deepEqual(selectedLoadingEmoji({text:" ⏳ ",entities:[{type:"custom_emoji",offset:1,length:1,custom_emoji_id:id}]}),emoji);
 for(const text of ["⏳","hello ⏳","🌹"]){assert.equal(selectedLoadingEmoji({text}),null);}
 assert.equal(selectedLoadingEmoji({text:"⏳",entities:[{type:"custom_emoji",offset:0,length:1,custom_emoji_id:"bad-id"}]}),null);
});
test("waiting messages use selected emoji on sends and edits without altering other text or buttons",async()=>{
 const env={VISITORS_KV:{get:async key=>{assert.equal(key,LOADING_EMOJI_KEY);return emoji;}}},calls=[];
 const send=async(e,m,p)=>{calls.push({m,p});return {message_id:42};};
 for(const method of ["sendMessage","editMessageText"]){
  const payload={chat_id:"123456789",message_id:42,text:"⏳ 🌹 Минутку — проверяем <анкету> & фото",reply_markup:{inline_keyboard:[]}};
  assert.equal((await sendWithLoadingEmoji(env,send,method,payload)).message_id,42);
  const result=calls.at(-1).p;assert.equal(result.text,payload.text);assert.equal(result.parse_mode,undefined);
  assert.deepEqual(result.entities,[{type:"custom_emoji",offset:0,length:1,custom_emoji_id:id}]);
  assert.deepEqual(result.reply_markup,payload.reply_markup);assert.equal(payload.entities,undefined);
 }
 const payload={text:"✅ Готово"};await sendWithLoadingEmoji(env,send,"sendMessage",payload);assert.equal(calls.at(-1).p,payload);
});
test("unset configuration and rejected custom emoji fall back; network errors do not retry",async()=>{
 const payload={chat_id:1,text:"⏳ Проверяем"},env={VISITORS_KV:{get:async()=>emoji}};
 const calls=[];const send=async(e,m,p)=>{calls.push(p);if(p.entities)throw Object.assign(Error("rejected"),{telegramCode:400});return {message_id:1};};
 await sendWithLoadingEmoji(env,send,"sendMessage",payload);assert.equal(calls.length,2);assert.equal(calls[1],payload);
 let attempts=0;await assert.rejects(sendWithLoadingEmoji(env,async()=>{attempts++;throw Error("timeout");},"sendMessage",payload));assert.equal(attempts,1);
 await sendWithLoadingEmoji({VISITORS_KV:{get:async()=>null}},send,"sendMessage",payload);assert.equal(calls.at(-1),payload);
});
