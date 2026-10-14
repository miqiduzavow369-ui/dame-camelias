import test from "node:test";
import assert from "node:assert/strict";
import {handleTrialCabinet} from "../src/trial_cabinet.js";
function mock(){
 const records=new Map(), sent=[];
 const env={VISITORS_KV:{
  async get(k){return records.has(k)?JSON.parse(records.get(k)):null;},
  async put(k,v){records.set(k,v);},
  async delete(k){records.delete(k);}
 },ORDER_REMINDERS:{idFromName:n=>n,get:()=>({fetch:async()=>({ok:true,json:async()=>({available:2})})})}};
 const send=async(_env,method,payload)=>{sent.push({method,payload});return {message_id:sent.length};};
 const callback=(id,action)=>({callback_query:{from:{id},message:{chat:{id,type:"private"}},id:"test",data:action}});
 const message=(id,text)=>({message:{from:{id},chat:{id,type:"private"},text}});
 return {env,send,sent,records,callback,message};
}
test("trial cabinet denies another user and keeps data separate",async()=>{
 const m=mock();
 assert.equal(await handleTrialCabinet(m.callback(12345678,"trial_cabinet:open"),m.env,m.send),true);
 assert.equal(m.sent.some(x=>x.method==="sendMessage"),false);
 assert.equal(m.records.size,0);
});
test("requires correct PIN, stores profile only under trial namespace",async()=>{
 const m=mock(),uid=5627932577;
 await handleTrialCabinet(m.callback(uid,"trial_cabinet:open"),m.env,m.send);
 assert.ok(m.sent.at(-1).payload.text.includes("Введите индивидуальный код"));
 await handleTrialCabinet(m.message(uid,"1234"),m.env,m.send);
 assert.ok(m.sent.at(-1).payload.text.includes("не подошёл"));
 await handleTrialCabinet(m.message(uid,"2222"),m.env,m.send);
 await handleTrialCabinet(m.callback(uid,"trial_cabinet:add"),m.env,m.send);
 await handleTrialCabinet(m.message(uid,"https://a.intimcity.rip/indi/anketa12345.htm"),m.env,m.send);
 assert.ok(m.sent.at(-1).payload.text.includes("Анкета №12345"));
 assert.ok([...m.records.keys()].every(k=>k.startsWith("trial_cabinet_v1:5627932577:")));
 assert.equal(m.records.has("owner_anketa_library:5866034656"),false);
});
