import {test} from "node:test";
import assert from "node:assert/strict";
import {OrderReminder} from "../src/reminders.js";

const person={id:123,first_name:"Клиент",username:"client"};
function fixture() {
  const entries=new Map(), messages=[];
  let alarm=null;
  const storage={get:async key=>structuredClone(entries.get(key)),put:async(key,value)=>entries.set(key,structuredClone(value)),setAlarm:async value=>{alarm=value;},deleteAlarm:async()=>{alarm=null;}};
  const ctx={storage,blockConcurrencyWhile:callback=>callback()};
  const object=new OrderReminder(ctx,{BOT_TOKEN:"test"});
  const request=async payload=>(await object.fetch(new Request("https://internal/",{method:"POST",body:JSON.stringify({person,chatId:123,...payload})}))).json();
  globalThis.fetch=async(_url,opts)=>{messages.push(JSON.parse(opts.body));return Response.json({ok:true,result:{message_id:77}});};
  return {object,request,messages,entries,get alarm(){return alarm;}};
}
test("opening Order arms 2h timer, each activity postpones, duplicate does not",async()=>{
  const f=fixture();
  await f.request({type:"activity",updateId:1});
  assert.equal(f.alarm,null);
  await f.request({type:"activity",opensOrder:true,updateId:2});
  const armed=f.alarm;
  assert.ok(Math.abs(armed-Date.now()-7200000)<100);
  const state=f.entries.get("state");state.lastActivity-=1000;f.entries.set("state",state);
  await f.request({type:"activity",updateId:3});
  assert.ok(f.entries.get("state").lastActivity>state.lastActivity);
  await f.request({type:"activity",updateId:2});
  assert.equal(f.entries.get("state").updateId,3);
});
test("completion cancels and remains suppressed on reopening Order",async()=>{
  const f=fixture();
  await f.request({type:"activity",opensOrder:true});
  await f.request({type:"complete"});
  await f.request({type:"activity",opensOrder:true});
  await f.object.alarm();
  assert.equal(f.alarm,null);assert.equal(f.messages.length,0);
});
test("early alarm reschedules; due alarm is at most once across restarts",async()=>{
  const f=fixture();await f.request({type:"activity",opensOrder:true});
  await f.object.alarm();assert.equal(f.messages.length,0);
  const state=f.entries.get("state");state.lastActivity=Date.now()-7200001;f.entries.set("state",state);
  await f.object.alarm();await f.object.alarm();
  assert.equal(f.messages.length,1);
  assert.ok(f.messages[0].text.includes("прямо здесь"));
  await f.request({type:"activity",opensOrder:true});
  await f.object.alarm();assert.equal(f.messages.length,1);
});
test("buttons and free text report immediately, escape HTML, deduplicate",async()=>{
  const f=fixture();await f.request({type:"activity",opensOrder:true});
  const state=f.entries.get("state");state.lastActivity=0;f.entries.set("state",state);
  await f.object.alarm();
  assert.deepEqual(await f.request({type:"reply",reason:"price",eventId:"cb:1"}),{handled:true});
  assert.equal(f.messages[1].chat_id,5866034656);
  assert.ok(f.messages[1].text.includes("Стоимость"));
  assert.deepEqual(await f.request({type:"reply",text:"<вопрос>",eventId:"msg:1"}),{handled:true});
  assert.ok(f.messages[3].text.includes("&lt;вопрос&gt;"));
  const count=f.messages.length;
  await f.request({type:"reply",text:"<вопрос>",eventId:"msg:1"});
  assert.equal(f.messages.length,count);
  assert.deepEqual(await f.request({type:"reply",text:"Ответ на шаг заказа",replyTo:999,eventId:"msg:2"}),{handled:false});
  await f.request({type:"activity",navigation:true});
  assert.deepEqual(await f.request({type:"reply",text:"Другой разговор",eventId:"msg:3"}),{handled:false});
});
test("uncertain Telegram send failure never retries user reminder",async()=>{
  const f=fixture();await f.request({type:"activity",opensOrder:true});
  const state=f.entries.get("state");state.lastActivity=0;f.entries.set("state",state);
  globalThis.fetch=async()=>{throw new Error("test network failure");};
  await f.object.alarm();await f.object.alarm();
  assert.ok(f.entries.get("state").attemptedAt);
  assert.equal(f.entries.get("state").deliveryFailed,true);
});
test("failed response report is persisted and retried even after order completes",async()=>{
  const f=fixture();await f.request({type:"activity",opensOrder:true});
  const state=f.entries.get("state");state.lastActivity=0;f.entries.set("state",state);
  await f.object.alarm();
  globalThis.fetch=async(_url,opts)=>{
    const message=JSON.parse(opts.body);
    if(message.chat_id===5866034656)throw new Error("test report failure");
    return Response.json({ok:true,result:{message_id:78}});
  };
  await f.request({type:"reply",text:"Нужна помощь",eventId:"reply:1"});
  assert.equal(f.entries.get("state").pendingReports.length,1);
  await f.request({type:"complete"});assert.ok(f.alarm);
  globalThis.fetch=async(_url,opts)=>{f.messages.push(JSON.parse(opts.body));return Response.json({ok:true,result:{message_id:79}});};
  await f.object.alarm();
  assert.equal(f.entries.get("state").pendingReports.length,0);
  assert.equal(f.messages.at(-1).chat_id,5866034656);
});
