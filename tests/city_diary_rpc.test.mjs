import test from "node:test";
import assert from "node:assert/strict";
import {cityDiaryRequest} from "../src/city_diary_rpc.js";

function storage(){
  const db=new Map();
  const copy=x=>x===undefined?undefined:structuredClone(x);
  return {
    async get(key){return copy(db.get(key));},
    async put(key,value){db.set(key,copy(value));},
    async transaction(fn){
      const working=new Map([...db].map(([key,value])=>[key,copy(value)]));
      const tx={get:async key=>copy(working.get(key)),put:async(key,value)=>working.set(key,copy(value))};
      const result=await fn(tx);
      db.clear();for(const [key,value] of working)db.set(key,value);
      return result;
    }
  };
}
const owned=async id=>id==="652282";
const allow={profileOwned:owned};
const ID="0123456789abcdef",OP="1111111111111111";
const at=()=>new Date(Date.now()+86400000*5).toISOString();
const plan=()=>({mode:"reminder",action:"review",profileId:"652282",at:at(),reviewText:"Мой текст"});
test("planning adapter rejects unknown or unowned profiles",async()=>{
 const s=storage();
 const denied=await cityDiaryRequest(s,{action:"create",id:ID,operation:OP,plan:{...plan(),profileId:"652283"}},allow);
 assert.equal(denied.status,403);
 assert.deepEqual((await cityDiaryRequest(s,{action:"list"},allow)).events,[]);
});
test("private store lists, edits and cancels only scheduled events",async()=>{
 const s=storage();
 const p=plan();
 const created=await cityDiaryRequest(s,{action:"create",id:ID,operation:OP,plan:p},allow);
 assert.equal(created.ok,true);
 assert.equal(created.event.status,"scheduled");
 const listed=await cityDiaryRequest(s,{action:"list"},allow);
 assert.equal(listed.events.length,1);
 const read=await cityDiaryRequest(s,{action:"get",id:ID},allow);
 assert.equal(read.event.reviewText,p.reviewText);
 const edit=await cityDiaryRequest(s,{action:"edit",id:ID,patch:{note:"Напомни мне"},
   operation:"2222222222222222",expectedRevision:1},allow);
 assert.equal(edit.event.revision,2);
 const canceled=await cityDiaryRequest(s,{action:"cancel",id:ID,
   operation:"3333333333333333",expectedRevision:2},allow);
 assert.equal(canceled.event.status,"cancelled");
 const repeat=await cityDiaryRequest(s,{action:"cancel",id:ID,
   operation:"3333333333333333",expectedRevision:2},allow);
 assert.deepEqual(repeat,canceled);
 assert.equal((await cityDiaryRequest(s,{action:"cancel",id:ID,
   operation:"4444444444444444",expectedRevision:3},allow)).status,409);
});
test("adapter cannot expose publication transitions",async()=>{
 const s=storage();
 assert.equal((await cityDiaryRequest(s,{action:"publish",id:ID},allow)).status,400);
 assert.equal((await cityDiaryRequest(s,{action:"transition",id:ID},allow)).status,400);
 assert.equal((await cityDiaryRequest(s,{action:"list"},{})).status,403);
});

test("batch forbids any unowned profile before writing the first event",async()=>{
 const s=storage(),date=at(),base={mode:"reminder",action:"review",at:date,reviewText:"Личный текст"};
 const reply=await cityDiaryRequest(s,{action:"batch",operation:OP,items:[
  {id:ID,plan:{...base,profileId:"652282"}},
  {id:"fedcba9876543210",plan:{...base,profileId:"652283"}}
 ]},allow);
 assert.equal(reply.status,403);
 assert.deepEqual((await cityDiaryRequest(s,{action:"list"},allow)).events,[]);
});
test("batch creates two owned reminders without publication side effects",async()=>{
 const s=storage(),base=plan(),items=[
  {id:ID,plan:base},
  {id:"fedcba9876543210",plan:{...base,at:new Date(Date.now()+86400000*6).toISOString()}}
 ];
 const reply=await cityDiaryRequest(s,{action:"batch",operation:OP,items},allow);
 assert.equal(reply.ok,true);assert.equal(reply.events.length,2);
 const again=await cityDiaryRequest(s,{action:"batch",operation:OP,items},allow);
 assert.deepEqual(again,reply);
 assert.equal((await cityDiaryRequest(s,{action:"list"},allow)).events.length,2);
});
