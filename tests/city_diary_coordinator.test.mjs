import test from "node:test";
import assert from "node:assert/strict";
import {cityDiaryRequestWithReminderSync} from "../src/city_diary_coordinator.js";

const USER="5866034656", TOKEN="private-test-secret-bridge";
const ID="0123456789abcdef", OP="1111111111111111";
const PLAN={mode:"reminder",action:"profile",
  at:"2026-10-28T15:30:00.000Z",profileId:null,reviewText:""};
function storage(){
 const db=new Map();const copy=x=>x===undefined?undefined:structuredClone(x);
 return {db,get:async key=>copy(db.get(key)),
  put:async(key,value)=>db.set(key,copy(value)),
  delete:async key=>db.delete(key),
  transaction:async fn=>{
   const draft=new Map([...db].map(([key,value])=>[key,copy(value)]));
   const tx={get:async key=>copy(draft.get(key)),
    put:async(key,value)=>draft.set(key,copy(value)),
    delete:async key=>draft.delete(key)};
   const result=await fn(tx);
   db.clear();for(const [key,value] of draft)db.set(key,value);
   return result;
  }};
}
function setup({fail=false}={}){
 const data=storage(),requests=[];let last=0;
 const schedulerNamespace={idFromName:x=>"private:"+x,
  get:id=>({fetch:async(_url,opts)=>{
   assert.equal(id,"private:"+USER);
   if(fail)throw Error("transport timeout");
   const payload=JSON.parse(opts.body);requests.push(payload);
   assert.equal(payload.userId,USER);
   if(payload.scheduleRevision<=last)return Response.json({
    ok:false,reason:"stale_schedule",currentRevision:last},{status:409});
   last=payload.scheduleRevision;
   return Response.json({ok:true,scheduleRevision:last});
  }})};
 const context={profileOwned:async()=>true};
 const bridge={authenticatedUserId:USER,schedulerNamespace,internalToken:TOKEN};
 const run=request=>cityDiaryRequestWithReminderSync(data,request,context,bridge);
 return {data,requests,run,bridge};
}
test("successful write reports pending sync without losing the saved plan",async()=>{
 const x=setup({fail:true});
 const answer=await x.run({action:"create",plan:PLAN,id:ID,operation:OP});
 assert.equal(answer.ok,true);
 assert.equal(answer.reminderSync.status,"pending");
 assert.equal(answer.reminderSync.reason,"sync_unknown");
 assert.equal(x.data.db.get("city_diary_events_v1").length,1);
});
test("retry of same operation is idempotent and separately reconciles the scheduler",async()=>{
 const x=setup();
 const req={action:"create",plan:PLAN,id:ID,operation:OP};
 const first=await x.run(req);
 const retry=await x.run(req);
 assert.equal(first.ok,true);assert.equal(retry.ok,true);
 assert.equal(retry.reminderSync.status,"synced");
 assert.equal(x.data.db.get("city_diary_events_v1").length,1);
 assert.equal(x.requests.length,2);
 assert.equal(x.requests[0].scheduleRevision,1);
 assert.equal(x.requests[1].scheduleRevision,1);
});
test("cancellation transmits empty reminder snapshot without touching publications",async()=>{
 const x=setup();
 await x.run({action:"create",plan:PLAN,id:ID,operation:OP});
 const cancelled=await x.run({action:"cancel",id:ID,expectedRevision:1,
   operation:"2222222222222222"});
 assert.equal(cancelled.ok,true);
 assert.equal(cancelled.reminderSync.status,"synced");
 assert.equal(x.requests.at(-1).scheduleRevision,2);
 assert.deepEqual(x.requests.at(-1).events,[]);
});
test("invalid mutation never starts a remote synchronization",async()=>{
 const x=setup();
 const response=await x.run({action:"create",plan:{...PLAN,at:"2020-01-01T00:00:00.000Z"},
  id:ID,operation:OP});
 assert.equal(response.ok,false);
 assert.equal(x.requests.length,0);
});
test("read-only and form draft operations never dispatch schedules",async()=>{
 const x=setup();
 const read=await x.run({action:"list"});
 assert.equal(read.ok,true);
 assert.equal(read.reminderSync,undefined);
 const draft=await x.run({action:"get_form_draft"});
 assert.equal(draft.ok,true);
 assert.equal(x.requests.length,0);
});
