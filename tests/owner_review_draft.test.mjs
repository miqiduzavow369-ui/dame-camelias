import test from "node:test";
import assert from "node:assert/strict";
import {handleOwnerAnketa} from "../src/owner_anketa.js";

const OWNER=5866034656;
const PREFIX="owner_anketa_";
function setup(){
  const store=new Map();
  const actions=[];
  const env={VISITORS_KV:{
    get:async (key)=>store.has(key)?JSON.parse(store.get(key)):null,
    put:async (key,value)=>{store.set(key,value);},
    delete:async key=>{store.delete(key);}
  }};
  let next=100;
  const send=async (_env,method,payload)=>{
    actions.push({method,payload});
    return {message_id:next++};
  };
  const cb=data=>({callback_query:{id:"test",from:{id:OWNER},
    message:{message_id:5,chat:{id:OWNER,type:"private"}},data}});
  const msg=text=>({message:{message_id:7,from:{id:OWNER},chat:{id:OWNER,type:"private"},text}});
  store.set(PREFIX+"saved:"+OWNER+":771053",JSON.stringify({
    profile:{id:"771053",name:"Evelyn"},host:"b.intimcity.rip"
  }));
  store.set(PREFIX+"selected_account:"+OWNER,JSON.stringify({
    profileId:"771053",account:"yan_first",expiresAt:Date.now()+120000
  }));
  return {env,store,actions,send,cb,msg};
}
test("review text remains unchanged in preview and is not published",async()=>{
  const s=setup();
  await handleOwnerAnketa(s.cb("owner_anketa:savedreview:771053"),s.env,s.send);
  const entry=s.actions.filter(x=>x.method==="sendMessage" || x.method==="editMessageText").at(-1);
  assert.match(entry.payload.text,/НОВЫЙ ОТЗЫВ/);
  const original="Подтверждаю, что текст написан мной самостоятельно.";
  await handleOwnerAnketa(s.msg(original),s.env,s.send);
  const draft=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
  assert.equal(draft.step,"review_preview");
  assert.equal(draft.text,original);
  assert.match(s.actions.filter(x=>x.method==="sendMessage"||x.method==="editMessageText").at(-1).payload.text,/ПРОВЕРКА ОТЗЫВА/);
  assert.equal(s.actions.filter(x=>x.method==="sendPhoto").length,0);
});
test("review editing returns to text input without website submission",async()=>{
  const s=setup();
  await handleOwnerAnketa(s.cb("owner_anketa:savedreview:771053"),s.env,s.send);
  await handleOwnerAnketa(s.msg("Первоначальный вариант сообщения для проверки"),s.env,s.send);
  const draft=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
  await handleOwnerAnketa(s.cb("owner_anketa:reviewedit:"+draft.nonce),s.env,s.send);
  const updated=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
  assert.equal(updated.step,"review_input");
  assert.equal(updated.id,"771053");
});
test("owner's ordinary messages are untouched outside review input state",async()=>{
  const s=setup();
  assert.equal(await handleOwnerAnketa(s.msg("Обычный текст клиента"),s.env,s.send),false);
});
