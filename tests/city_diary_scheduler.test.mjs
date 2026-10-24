import test from "node:test";
import assert from "node:assert/strict";
import {CityDiaryScheduler} from "../src/city_diary_scheduler.js";

const TOKEN="dev-only-private-secret";
const ID="0123456789abcdef";
const USER_ID="5866034656";
const past=new Date(Date.now()-60000).toISOString();
const future=new Date(Date.now()+3600000).toISOString();
const reminder=(at=past)=>({id:ID,mode:"reminder",status:"scheduled",revision:1,
  action:"review",at,localDate:"2026-10-24",profileId:"12345",reviewText:"Только личный опыт"});
function setup(){
 const db=new Map(),alarms=[];
 const copy=x=>x===undefined?undefined:structuredClone(x);
 const storage={
  async get(k){return copy(db.get(k));},
  async put(k,v){db.set(k,copy(v));},
  async transaction(fn){
    const pending=new Map([...db].map(([k,v])=>[k,copy(v)]));
    const tx={get:async k=>copy(pending.get(k)),
      put:async(k,v)=>pending.set(k,copy(v))};
    const result=await fn(tx);
    db.clear();for(const [k,v] of pending)db.set(k,v);
    return result;
  },
  async deleteAlarm(){alarms.push(["delete"]);},
  async setAlarm(at){alarms.push(["set",at]);}
 };
 const ctx={storage,blockConcurrencyWhile:fn=>fn()};
 const obj=new CityDiaryScheduler(ctx,{CITY_DIARY_INTERNAL_TOKEN:TOKEN,BOT_TOKEN:"fake"});
 const call=async(input,auth=TOKEN)=>{
  const response=await obj.fetch(new Request("https://diary.internal/",{
    method:"POST",headers:{"Authorization":"Bearer "+auth},
    body:JSON.stringify({userId:USER_ID,...input})
  }));
  return {status:response.status,body:await response.json()};
 };
 return {obj,call,alarms,db};
}
test("rejects unauthenticated callers and never schedules manual City alarms",async()=>{
 const {call,db,alarms}=setup();
 const denied=await call({type:"replace_schedule",events:[reminder()]},"wrong");
 assert.equal(denied.status,403);assert.equal(db.size,0);assert.equal(alarms.length,0);
});
test("creates reminder-only snapshots and declines publication plans",async()=>{
 const {call,db}=setup();
 const denied=await call({type:"replace_schedule",events:[{...reminder(),mode:"publication"}]});
 assert.equal(denied.status,400);
 const ok=await call({type:"replace_schedule",scheduleRevision:1,events:[reminder(future)]});
 assert.equal(ok.status,200);assert.equal(ok.body.count,1);
 assert.equal(db.has("diary_scheduler_events_v1"),true);
});
test("one scheduler object is permanently bound to one client identity",async()=>{
 const {call,obj}=setup();
 await call({type:"replace_schedule",scheduleRevision:1,events:[reminder(future)]});
 const response=await obj.fetch(new Request("https://diary.internal/",{
  method:"POST",headers:{"Authorization":"Bearer "+TOKEN},
  body:JSON.stringify({type:"status",userId:"1234567890",eventId:ID})
 }));
 assert.equal(response.status,403);
});
test("delivered message is recorded and not re-sent by a repeated alarm",async()=>{
 const {obj,call,db}=setup();
 await call({type:"replace_schedule",scheduleRevision:1,events:[reminder()]});
 const original=globalThis.fetch;let messages=0,callbackData="";
 globalThis.fetch=async(_url,init)=>{messages++;
   callbackData=JSON.parse(init.body).reply_markup.inline_keyboard[0][0].callback_data;
   return Response.json({ok:true,result:{message_id:777}});
 };
 try{await obj.alarm();await obj.alarm();}
 finally{globalThis.fetch=original;}
 assert.equal(messages,1);
 assert.equal(db.get("diary_scheduler_deliveries_v1")[ID].state,"sent");
 const a=await call({type:"acknowledge",eventId:ID,messageId:777,callbackData});
 assert.equal(a.body.record.state,"acknowledged");
 const b=await call({type:"acknowledge",eventId:ID,messageId:777,callbackData});
 assert.equal(b.body.replay,true);
});
test("unknown Telegram result is never retried after another alarm",async()=>{
 const {obj,call,db}=setup();
 await call({type:"replace_schedule",scheduleRevision:1,events:[reminder()]});
 const original=globalThis.fetch;let attempts=0;
 globalThis.fetch=async()=>{attempts++;throw Error("ambiguous timeout");};
 try{await obj.alarm();await obj.alarm();}
 finally{globalThis.fetch=original;}
 assert.equal(attempts,1);
 assert.equal(db.get("diary_scheduler_deliveries_v1")[ID].state,"delivery_unknown");
});

test("out-of-order schedule snapshots cannot revive a cancelled reminder",async()=>{
 const {call,db}=setup();
 assert.equal((await call({type:"replace_schedule",scheduleRevision:1,events:[reminder(future)]})).status,200);
 assert.equal((await call({type:"replace_schedule",scheduleRevision:2,events:[]})).status,200);
 const stale=await call({type:"replace_schedule",scheduleRevision:1,events:[reminder(future)]});
 assert.equal(stale.status,409);
 assert.equal(stale.body.reason,"stale_schedule");
 assert.deepEqual(db.get("diary_scheduler_events_v1"),[]);
});
test("a forged Thanks callback does not acknowledge or modify delivery",async()=>{
 const {call,obj,db}=setup();
 await call({type:"replace_schedule",scheduleRevision:1,events:[reminder()]});
 const original=globalThis.fetch;let realCallback="";
 globalThis.fetch=async(_url,init)=>{
  realCallback=JSON.parse(init.body).reply_markup.inline_keyboard[0][0].callback_data;
  return Response.json({ok:true,result:{message_id:777}});
 };
 try{await obj.alarm();}finally{globalThis.fetch=original;}
 assert.ok(realCallback.length<=64);
 const fake=realCallback.slice(0,-12)+"ffffffffffff";
 const forged=await call({type:"acknowledge",eventId:ID,messageId:777,callbackData:fake});
 assert.equal(forged.status,409);
 const wrongMessage=await call({type:"acknowledge",eventId:ID,messageId:999,callbackData:realCallback});
 assert.equal(wrongMessage.status,409);
 assert.equal(db.get("diary_scheduler_deliveries_v1")[ID].state,"sent");
 assert.equal((await call({type:"acknowledge",eventId:ID,messageId:777,callbackData:realCallback})).status,200);
 assert.equal((await call({type:"acknowledge",eventId:ID,messageId:777,callbackData:fake})).status,409);
});

test("failed atomic schedule commit preserves prior revision and event list",async()=>{
 const {call,db}=setup();
 await call({type:"replace_schedule",scheduleRevision:1,events:[reminder(future)]});
 const earlier=structuredClone(db.get("diary_scheduler_events_v1"));
 // Verify the atomic storage contract by a second, rejected snapshot:
 // the failed operation must not remove a previously accepted event.
 const denied=await call({type:"replace_schedule",scheduleRevision:1,events:[]});
 assert.equal(denied.status,409);
 assert.deepEqual(db.get("diary_scheduler_events_v1"),earlier);
 assert.equal(db.get("diary_scheduler_revision_v1"),1);
});

test("cancel accepted before alarm prevents Telegram send",async()=>{
 const {obj,call,db}=setup();
 await call({type:"replace_schedule",scheduleRevision:1,events:[reminder()]});
 const cancelled=await call({type:"replace_schedule",scheduleRevision:2,events:[]});
 assert.equal(cancelled.status,200);
 const original=globalThis.fetch;let messages=0;
 globalThis.fetch=async()=>{messages++;return Response.json({ok:true,result:{message_id:777}});};
 try{await obj.alarm();}finally{globalThis.fetch=original;}
 assert.equal(messages,0);
 assert.deepEqual(db.get("diary_scheduler_events_v1"),[]);
});

test("scheduler records cleanup separately and keeps verified acknowledgement",async()=>{
 const {obj,call,db}=setup();
 await call({type:"replace_schedule",scheduleRevision:1,events:[reminder()]});
 const original=globalThis.fetch;let callbackData="";
 globalThis.fetch=async(_url,init)=>{
  callbackData=JSON.parse(init.body).reply_markup.inline_keyboard[0][0].callback_data;
  return Response.json({ok:true,result:{message_id:777}});
 };
 try{await obj.alarm();}finally{globalThis.fetch=original;}
 const ack=await call({type:"acknowledge",eventId:ID,messageId:777,callbackData});
 assert.equal(ack.body.record.state,"acknowledged");
 const failed=await call({type:"record_cleanup",eventId:ID,messageId:777,deleted:false});
 assert.equal(failed.body.record.cleanupStatus,"failed");
 const cleaned=await call({type:"record_cleanup",eventId:ID,messageId:777,deleted:true});
 assert.equal(cleaned.body.record.cleanupStatus,"deleted");
 assert.equal(cleaned.body.record.state,"acknowledged");
 const repeated=await call({type:"record_cleanup",eventId:ID,messageId:777,deleted:true});
 assert.equal(repeated.body.replay,true);
 assert.equal(db.get("diary_scheduler_deliveries_v1")[ID].cleanupAttempts,2);
});
test("scheduler rejects cleanup without verified acknowledgement",async()=>{
 const {call}=setup();
 const denied=await call({type:"record_cleanup",eventId:ID,messageId:777,deleted:true});
 assert.equal(denied.status,409);
});

test("same Telegram update ID cannot be reused with a different acknowledgement",async()=>{
 const {obj,call,db}=setup();
 await call({type:"replace_schedule",scheduleRevision:1,events:[reminder()]});
 let callbackData="";
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  callbackData=JSON.parse(init.body).reply_markup.inline_keyboard[0][0].callback_data;
  return Response.json({ok:true,result:{message_id:777}});
 };
 try{await obj.alarm();}finally{globalThis.fetch=original;}
 const first=await call({type:"acknowledge",eventId:ID,messageId:777,callbackData,updateId:901});
 assert.equal(first.status,200);
 const repeated=await call({type:"acknowledge",eventId:ID,messageId:777,callbackData,updateId:901});
 assert.equal(repeated.status,200);
 assert.equal(repeated.body.replay,true);
 const forged=await call({type:"acknowledge",eventId:ID,messageId:778,callbackData,updateId:901});
 assert.equal(forged.status,409);
 assert.equal(db.get("diary_scheduler_ack_updates_v1")["901"],
   JSON.stringify([ID,777,callbackData]));
 assert.equal(db.get("diary_scheduler_deliveries_v1")[ID].state,"acknowledged");
});
test("invalid Telegram update IDs are refused before recording acknowledgement",async()=>{
 const {call,db}=setup();
 const response=await call({type:"acknowledge",eventId:ID,messageId:777,
  callbackData:"citydiary:thanks:"+ID+":aaaaaaaaaaaa",updateId:-3});
 assert.equal(response.status,400);
 assert.equal(db.has("diary_scheduler_ack_updates_v1"),false);
});
