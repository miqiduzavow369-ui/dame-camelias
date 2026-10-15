import test from "node:test";
import assert from "node:assert/strict";
import {handleOwnerAnketa,ownerAllowed} from "../src/owner_anketa.js";

const OWNER = 5866034656;
const memory = new Map();
const env = {VISITORS_KV:{
  get: async k => memory.has(k) ? JSON.parse(memory.get(k)) : null,
  put: async (k,v) => {memory.set(k,v);}
}};
const message=(id,text="/anketa",chat=id,kind="private")=>({
  message:{from:{id},chat:{id:chat,type:kind},text}
});
const callback=(id,data)=>({callback_query:{
  id:"callback-test",from:{id},message:{chat:{id,type:"private"}},data
}});
function sentMessages(){const sent=[];return {
  sent,send:async(_e,method,payload)=>sent.push({method,payload})
};}
test("owner verified by Telegram ID and private chat",()=>{
  assert.equal(ownerAllowed(message(OWNER)),true);
  assert.equal(ownerAllowed(message(123)),false);
  assert.equal(ownerAllowed(message(OWNER,"/anketa",-1,"supergroup")),false);
});
test("owner entry requires the cabinet PIN",async()=>{
  memory.clear();
  const {sent,send}=sentMessages();
  assert.equal(await handleOwnerAnketa(callback(OWNER,"owner_anketa:open"),env,send),true);
  assert.match(sent.at(-1).payload.text,/индивидуальный код доступа/);
});
test("number is accepted but identity never invented without lookup bridge",async()=>{
  memory.clear();
  let out=sentMessages();
  await handleOwnerAnketa(callback(OWNER,"owner_anketa:open"),env,out.send);
  out=sentMessages();
  await handleOwnerAnketa(message(OWNER,"750206"),env,out.send);
  assert.match(out.sent.at(-1).payload.text,/Неверный код/);
  assert.doesNotMatch(out.sent.at(-1).payload.text,/Саша/);
});
test("outsider cannot invoke owner callback",async()=>{
  const {sent,send}=sentMessages();
  await handleOwnerAnketa(callback(123,"owner_anketa:open"),env,send);
  assert.equal(sent.length,1);
  assert.equal(sent[0].method,"answerCallbackQuery");
});
