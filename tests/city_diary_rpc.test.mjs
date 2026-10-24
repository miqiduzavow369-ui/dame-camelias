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

test("male identities come only from existing City registry",async()=>{
 const s=storage();
 const base=plan();
 const invalid=await cityDiaryRequest(s,{action:"create",id:ID,operation:OP,
   plan:{...base,accountId:"invented_man"}},allow);
 assert.equal(invalid.status,400);assert.equal(invalid.reason,"invalid_account");
 const valid=await cityDiaryRequest(s,{action:"create",id:ID,operation:OP,
   plan:{...base,accountId:"yan_second"}},allow);
 assert.equal(valid.ok,true);assert.equal(valid.event.accountId,"yan_second");
});

test("publication planning rejects manually published review for same man",async()=>{
 const store=storage(),draft={mode:"publication",action:"review",accountId:"yan_second",
   profileId:"652282",at:at(),reviewText:"Подлинный личный текст"};
 const manualStatus=async()=>({archive:[{account:"yan_second",profileId:"652282",kind:"review"}],statuses:{}});
 const result=await cityDiaryRequest(store,{action:"create",id:ID,operation:OP,plan:draft},
   {profileOwned:owned,manualStatus});
 assert.equal(result.ok,false);assert.equal(result.reason,"already_published");
 assert.deepEqual((await cityDiaryRequest(store,{action:"list"},allow)).events,[]);
});
test("published review does not block planning an unrelated rating",async()=>{
 const store=storage(),draft={mode:"publication",action:"rating",accountId:"yan_second",
   profileId:"652282",at:at(),reviewText:""};
 const manualStatus=async()=>({archive:[{account:"yan_second",profileId:"652282",kind:"review"}],statuses:{}});
 const result=await cityDiaryRequest(store,{action:"create",id:ID,operation:OP,plan:draft},
   {profileOwned:owned,manualStatus});
 assert.equal(result.ok,true);assert.equal(result.event.action,"rating");
});
test("publication planning fails closed without authoritative City status adapter",async()=>{
 const store=storage(),draft={mode:"publication",action:"review",accountId:"yan_second",
   profileId:"652282",at:at(),reviewText:"Подлинный личный текст"};
 const result=await cityDiaryRequest(store,{action:"create",id:ID,operation:OP,plan:draft},allow);
 assert.equal(result.reason,"eligibility_unavailable");
 assert.deepEqual((await cityDiaryRequest(store,{action:"list"},allow)).events,[]);
});

test("recheck sees manual City review published after a plan was saved, without submitting",async()=>{
 const backing=storage();
 const draft={mode:"publication",action:"review",accountId:"yan_second",profileId:"652282",
   at:at(),reviewText:"Мой реальный личный опыт"};
 let published=false;
 const manualStatus=async()=>({
   archive:published?[{account:"yan_second",profileId:"652282",kind:"review"}]:[],
   statuses:{review:published?"published":"unknown",rating:"unknown"}
 });
 const opts={profileOwned:owned,manualStatus};
 const created=await cityDiaryRequest(backing,{action:"create",id:ID,operation:OP,plan:draft},opts);
 assert.equal(created.ok,true);
 published=true;
 const checked=await cityDiaryRequest(backing,{action:"recheck",id:ID,
   expectedRevision:created.event.revision},opts);
 assert.equal(checked.ok,true);
 assert.equal(checked.eligibleForPlanning,false);
 assert.equal(checked.reason,"already_published");
 assert.equal(checked.publicationAuthorized,false);
 assert.equal(checked.siteCheckRequired,true);
 assert.equal((await cityDiaryRequest(backing,{action:"get",id:ID},opts)).event.status,"scheduled");
});
test("recheck is read-only and never authorizes publication when no conflict exists",async()=>{
 const backing=storage(),opts={profileOwned:owned,manualStatus:async()=>({archive:[],statuses:{}})};
 const draft={mode:"publication",action:"rating",accountId:"yan_second",
   profileId:"652282",at:at(),reviewText:""};
 const created=await cityDiaryRequest(backing,{action:"create",id:ID,operation:OP,plan:draft},opts);
 assert.equal(created.ok,true);
 const result=await cityDiaryRequest(backing,{action:"recheck",id:ID,expectedRevision:1},opts);
 assert.equal(result.eligibleForPlanning,true);
 assert.equal(result.publicationAuthorized,false);
 assert.equal(result.requiresClientConfirmation,true);
 assert.equal(result.requiresExistingCityGuard,true);
 assert.equal((await cityDiaryRequest(backing,{action:"get",id:ID},opts)).event.revision,1);
});
test("recheck refuses a stale version and never accepts a reminder as publication",async()=>{
 const backing=storage(),opts={profileOwned:owned,manualStatus:async()=>({archive:[],statuses:{}})};
 await cityDiaryRequest(backing,{action:"create",id:ID,operation:OP,plan:plan()},opts);
 const reminder=await cityDiaryRequest(backing,{action:"recheck",id:ID,expectedRevision:1},opts);
 assert.equal(reminder.reason,"not_publication");
 const draft={mode:"publication",action:"rating",accountId:"yan_second",
  profileId:"652282",at:at(),reviewText:""};
 const other="fedcba9876543210";
 const created=await cityDiaryRequest(backing,{action:"create",id:other,
    operation:"3333333333333333",plan:draft},opts);
 assert.equal(created.ok,true);
 const stale=await cityDiaryRequest(backing,{action:"recheck",id:other,expectedRevision:99},opts);
 assert.equal(stale.reason,"revision_conflict");
});
