import test from "node:test";
import assert from "node:assert/strict";
import {CityDiaryStore} from "../src/city_diary_store.js";

const NOW=Date.parse("2026-10-24T10:00:00.000Z");
const ID="0123456789abcdef", OP="1111111111111111";
const plan={mode:"publication",action:"review",at:"2026-10-28T15:30:00.000Z",
  profileId:"652282",reviewText:"Мой проверяемый личный опыт"};
function storage({failReceipt=false}={}) {
  const db=new Map();
  const copy=x=>x===undefined?undefined:structuredClone(x);
  return {
    db,
    async get(key){return copy(db.get(key));},
    async put(key,value){db.set(key,copy(value));},
    async delete(key){db.delete(key);},
    async transaction(fn) {
      const pending=new Map([...db].map(([k,v])=>[k,copy(v)]));
      const tx={
        async delete(key){pending.delete(key);},
        async get(key){return copy(pending.get(key));},
        async put(key,value){
          if(failReceipt&&key==="city_diary_operation_receipts_v1")
            throw Error("simulated_receipt_failure");
          pending.set(key,copy(value));
        }
      };
      const value=await fn(tx);
      db.clear();for(const [k,v] of pending)db.set(k,v);
      return value;
    }
  };
}
test("isolated stores cannot read other client's private events",async()=>{
 const alice=new CityDiaryStore(storage()),bob=new CityDiaryStore(storage());
 await alice.create(plan,{id:ID,operation:OP,now:NOW});
 assert.equal((await alice.list()).length,1);
 assert.deepEqual(await bob.list(),[]);
 assert.equal(await bob.get(ID),null);
});
test("idempotent retry returns same result and never duplicates an event",async()=>{
 const store=new CityDiaryStore(storage());
 const first=await store.create(plan,{id:ID,operation:OP,now:NOW});
 const retry=await store.create(plan,{id:ID,operation:OP,now:NOW+1});
 assert.deepEqual(retry,first);
 assert.equal((await store.list()).length,1);
 await assert.rejects(()=>store.create({...plan,reviewText:"other"},{id:ID,operation:OP,now:NOW}),/operation_conflict/);
});
test("edit and cancellation require fresh revision and private operation ID",async()=>{
 const store=new CityDiaryStore(storage());
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 const edited=await store.edit(ID,{at:"2026-10-29T15:30:00.000Z"},
  {expectedRevision:1,operation:"2222222222222222",now:NOW});
 assert.equal(edited.revision,2);
 const repeat=await store.edit(ID,{at:"2026-10-29T15:30:00.000Z"},
  {expectedRevision:1,operation:"2222222222222222",now:NOW});
 assert.deepEqual(repeat,edited);
 await assert.rejects(()=>store.edit(ID,{note:"old"},{expectedRevision:1,operation:"3333333333333333",now:NOW}),/revision_conflict/);
 const cancelled=await store.transition(ID,"cancelled",{expectedRevision:2,operation:"4444444444444444",now:NOW});
 assert.equal(cancelled.status,"cancelled");
 await assert.rejects(()=>store.edit(ID,{note:"new"},{expectedRevision:3,operation:"5555555555555555",now:NOW}),/event_locked/);
});
test("a failed validation never adds events or receipts",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 await assert.rejects(()=>store.create({...plan,at:"2025-01-01T00:00:00.000Z"},
  {id:ID,operation:OP,now:NOW}),/time_out_of_range/);
 assert.deepEqual(await store.list(),[]);
 assert.equal(backing.db.has("city_diary_operation_receipts_v1"),false);
});
test("create and edits do not reserve credits, send Telegram messages or reach ADMIN",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 assert.deepEqual([...backing.db.keys()].sort(),
  ["city_diary_events_v1","city_diary_operation_receipts_v1","city_diary_schedule_revision_v1"].sort());
});

test("atomic transaction rolls back both event and receipt on write failure",async()=>{
  const backing=storage({failReceipt:true}),store=new CityDiaryStore(backing);
  await assert.rejects(()=>store.create(plan,{id:ID,operation:OP,now:NOW}),/simulated_receipt_failure/);
  assert.deepEqual(await store.list(),[]);
  assert.equal(backing.db.size,0);
});
test("a transaction-capable storage is mandatory",()=>{
  assert.throws(()=>new CityDiaryStore({async get(){},async put(){}}),/invalid_storage/);
});

test("atomic month batch creates independent dates and retries idempotently",async()=>{
 const store=new CityDiaryStore(storage());
 const items=[{id:ID,plan:{...plan,mode:"reminder"}},{id:"fedcba9876543210",plan:{...plan,mode:"reminder",at:"2026-10-30T15:30:00.000Z"}}];
 const first=await store.createBatch(items,{operation:OP,now:NOW});
 assert.equal(first.length,2);
 assert.equal(first[0].at,items[0].plan.at);
 const retry=await store.createBatch(items,{operation:OP,now:NOW+1000});
 assert.deepEqual(retry,first);
 assert.equal((await store.list()).length,2);
 const changed=await store.edit(ID,{note:"Только эта запись"},{expectedRevision:1,operation:"aaaaaaaaaaaaaaaa",now:NOW});
 assert.equal(changed.note,"Только эта запись");
 assert.equal((await store.get(items[1].id)).note,undefined);
});
test("month batch rolls back entirely when any event is invalid",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 await assert.rejects(()=>store.createBatch([
  {id:ID,plan:{...plan,mode:"reminder"}},
  {id:"fedcba9876543210",plan:{...plan,mode:"reminder",at:"2026-01-01T00:00:00.000Z"}}
 ],{operation:OP,now:NOW}),/time_out_of_range/);
 assert.deepEqual(await store.list(),[]);
 assert.equal(backing.db.size,0);
});
test("month batch rejects duplicate IDs and excess dates before writes",async()=>{
 const store=new CityDiaryStore(storage());
 await assert.rejects(()=>store.createBatch([{id:ID,plan:{...plan,mode:"reminder"}},{id:ID,plan:{...plan,mode:"reminder"}}],{operation:OP,now:NOW}),/duplicate_event/);
 await assert.rejects(()=>store.createBatch(Array.from({length:32},(_,i)=>({
  id:i.toString(16).padStart(16,"0"),plan
 })),{operation:OP,now:NOW}),/invalid_batch/);
});

test("bulk publications are refused until individual authoring and financial holds are implemented",async()=>{
 const store=new CityDiaryStore(storage());
 await assert.rejects(()=>store.createBatch([{id:ID,plan}],{operation:OP,now:NOW}),/batch_publication_unavailable/);
 assert.deepEqual(await store.list(),[]);
});

test("terminal cancellation transfers to archive atomically and preserves get/history",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 await store.transition(ID,"cancelled",{operation:"2222222222222222",expectedRevision:1,now:NOW+5});
 const args={operation:"3333333333333333",expectedRevisions:[{id:ID,revision:2}],now:NOW+10};
 const first=await store.archiveTerminal(args);
 assert.equal(first.count,1);
 assert.deepEqual(await store.list(),[]);
 assert.equal((await store.listArchive()).length,1);
 assert.equal((await store.get(ID)).status,"cancelled");
 assert.equal((await store.get(ID)).archivedAt,NOW+10);
 assert.deepEqual(await store.archiveTerminal({...args,now:NOW+20}),first);
});
test("active and unverified completed publication records cannot be archived",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 const op="3333333333333333";
 await assert.rejects(()=>store.archiveTerminal({operation:op,expectedRevisions:[{id:ID,revision:1}],now:NOW}),/archive_not_terminal/);
 assert.equal((await store.list()).length,1);
 const a=await store.transition(ID,"awaiting_confirmation",{operation:"2222222222222222",expectedRevision:1,now:NOW});
 const b=await store.transition(ID,"submitted",{operation:"4444444444444444",expectedRevision:a.revision,now:NOW});
 await store.transition(ID,"completed",{operation:"5555555555555555",expectedRevision:b.revision,now:NOW});
 await assert.rejects(()=>store.archiveTerminal({operation:op,expectedRevisions:[{id:ID,revision:4}],now:NOW}),/archive_requires_verified_result/);
 assert.equal((await store.listArchive()).length,0);
});
test("archive rejects stale revisions without partial moves",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 await store.transition(ID,"cancelled",{operation:"2222222222222222",expectedRevision:1,now:NOW});
 await assert.rejects(()=>store.archiveTerminal({operation:"3333333333333333",expectedRevisions:[{id:ID,revision:1}],now:NOW}),/revision_conflict/);
 assert.equal((await store.list()).length,1);
 assert.equal((await store.listArchive()).length,0);
});
test("archive transaction rollback leaves original record intact",async()=>{
 const backing=storage({failReceipt:true}),store=new CityDiaryStore(backing);
 backing.db.set("city_diary_events_v1",[{id:ID,revision:2,status:"cancelled",mode:"reminder",action:"profile",at:"2026-10-28T15:30:00.000Z",profileId:null,reviewText:"",createdAt:NOW,updatedAt:NOW}]);
 await assert.rejects(()=>store.archiveTerminal({operation:OP,expectedRevisions:[{id:ID,revision:2}],now:NOW}),/simulated_receipt_failure/);
 assert.equal((await store.list()).length,1);
 assert.equal((await store.listArchive()).length,0);
});
test("archived identifiers cannot be reused to create a new event",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 await store.transition(ID,"cancelled",{operation:"2222222222222222",expectedRevision:1,now:NOW});
 await store.archiveTerminal({operation:"3333333333333333",expectedRevisions:[{id:ID,revision:2}],now:NOW});
 await assert.rejects(()=>store.create(plan,{id:ID,operation:"4444444444444444",now:NOW}),/duplicate_event/);
});

test("private unfinished form survives client restart, expires and clears",async()=>{
 const backing=storage(),first=new CityDiaryStore(backing);
 const form={mode:"publication",date:"2026-10-30",time:"17:20",
  profileId:"652282",accountId:"yan_second",action:"review",
  reviewText:"Мой личный опыт",note:"Проверить",editingId:""};
 await first.saveFormDraft(form,{expectedRevision:0,now:NOW});
 const reopened=new CityDiaryStore(backing);
 assert.deepEqual((await reopened.readFormDraft({now:NOW+5000})).form,form);
 assert.equal(await reopened.readFormDraft({now:NOW+31*86400000}),null);
 assert.deepEqual(await reopened.clearFormDraft({expectedRevision:1,now:NOW+5000}),{cleared:true,revision:0});
 assert.equal(await reopened.readFormDraft({now:NOW+5000}),null);
});
test("private form cannot contain credentials or oversized text",async()=>{
 const store=new CityDiaryStore(storage());
 const form={mode:"reminder",date:"2026-10-30",time:"12:00",profileId:"",
  accountId:"",action:"profile",reviewText:"",note:"",editingId:""};
 await assert.rejects(()=>store.saveFormDraft({...form,proxy:"secret"},{expectedRevision:0,now:NOW}),/invalid_form_draft/);
 await assert.rejects(()=>store.saveFormDraft({...form,reviewText:"x".repeat(4001)},{expectedRevision:0,now:NOW}),/invalid_form_draft/);
 await store.saveFormDraft(form,{expectedRevision:0,now:NOW});
 assert.equal((await store.readFormDraft({now:NOW+1})).form.action,"profile");
});
test("draft is isolated from active event ledger and other clients",async()=>{
 const a=storage(),b=storage();
 const first=new CityDiaryStore(a),second=new CityDiaryStore(b);
 const form={mode:"reminder",date:"2026-10-30",time:"12:00",profileId:"",
  accountId:"",action:"profile",reviewText:"",note:"",editingId:""};
 await first.saveFormDraft(form,{expectedRevision:0,now:NOW});
 assert.equal(await second.readFormDraft({now:NOW+1}),null);
 assert.deepEqual(await first.list(),[]);
});

test("archive pagination returns bounded stable pages without losing history",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 for(let i=0;i<65;i++){
  const id=i.toString(16).padStart(16,"0");
  backing.db.set("city_diary_archive_v1",[
   ...(backing.db.get("city_diary_archive_v1")||[]),
   {id,mode:"reminder",status:"cancelled",action:"profile",
    at:"2026-10-28T15:30:00.000Z",archivedAt:NOW+i,
    revision:2,profileId:null,reviewText:""}
  ]);
 }
 const page1=await store.archivePage({offset:0,limit:30});
 const page2=await store.archivePage({offset:30,limit:30});
 const page3=await store.archivePage({offset:60,limit:30});
 assert.equal(page1.total,65);assert.equal(page1.events.length,30);
 assert.equal(page2.events.length,30);assert.equal(page3.events.length,5);
 assert.equal(page1.hasMore,true);assert.equal(page3.hasMore,false);
 assert.notEqual(page1.events[0].id,page2.events[0].id);
 await assert.rejects(()=>store.archivePage({offset:-1,limit:30}),/invalid_archive_page/);
 await assert.rejects(()=>store.archivePage({offset:0,limit:51}),/invalid_archive_page/);
});

test("two devices cannot overwrite or clear newer form draft",async()=>{
 const backing=storage(),one=new CityDiaryStore(backing),two=new CityDiaryStore(backing);
 const form={mode:"reminder",date:"2026-10-30",time:"12:00",profileId:"",
  accountId:"",action:"profile",reviewText:"first",note:"",editingId:""};
 assert.equal((await one.saveFormDraft(form,{expectedRevision:0,now:NOW})).revision,1);
 assert.equal((await two.saveFormDraft({...form,reviewText:"second"},{expectedRevision:1,now:NOW+1})).revision,2);
 await assert.rejects(()=>one.saveFormDraft({...form,reviewText:"stale"},{expectedRevision:1,now:NOW+2}),/draft_revision_conflict/);
 await assert.rejects(()=>one.clearFormDraft({expectedRevision:1,now:NOW+2}),/draft_revision_conflict/);
 assert.equal((await two.readFormDraft({now:NOW+3})).form.reviewText,"second");
});

test("pre-revision legacy form drafts migrate without losing contents",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 const form={mode:"reminder",date:"2026-10-31",time:"12:00",
  profileId:"",accountId:"",action:"profile",reviewText:"old",note:"legacy",editingId:""};
 backing.db.set("city_diary_form_draft_v1",{form,updatedAt:NOW,expiresAt:NOW+86400000});
 assert.equal((await store.readFormDraft({now:NOW+1})).form.note,"legacy");
 const updated=await store.saveFormDraft({...form,note:"migrated"},{expectedRevision:0,now:NOW+2});
 assert.equal(updated.revision,1);
 assert.equal((await store.readFormDraft({now:NOW+3})).form.note,"migrated");
});
test("legacy form draft can be cleared only with its current revision",async()=>{
 const backing=storage(),store=new CityDiaryStore(backing);
 const form={mode:"reminder",date:"2026-10-31",time:"12:00",
  profileId:"",accountId:"",action:"profile",reviewText:"",note:"old",editingId:""};
 backing.db.set("city_diary_form_draft_v1",{form,updatedAt:NOW,expiresAt:NOW+86400000});
 assert.deepEqual(await store.clearFormDraft({expectedRevision:0,now:NOW+1}),{cleared:true,revision:0});
 assert.equal(await store.readFormDraft({now:NOW+2}),null);
});

test("source revision and reminder snapshot track cancelled events without replay increment",async()=>{
 const store=new CityDiaryStore(storage());
 const item={mode:"reminder",action:"profile",profileId:null,reviewText:"",
  at:"2026-10-28T15:30:00.000Z"};
 assert.equal((await store.reminderSnapshot()).scheduleRevision,0);
 await store.create(item,{id:ID,operation:OP,now:NOW});
 assert.equal((await store.reminderSnapshot()).events.length,1);
 await store.create(item,{id:ID,operation:OP,now:NOW});
 assert.equal((await store.reminderSnapshot()).scheduleRevision,1);
 await store.transition(ID,"cancelled",{expectedRevision:1,operation:"2222222222222222",now:NOW});
 const after=await store.reminderSnapshot();
 assert.equal(after.scheduleRevision,2);
 assert.deepEqual(after.events,[]);
});
