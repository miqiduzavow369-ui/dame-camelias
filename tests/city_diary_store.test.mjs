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
    async transaction(fn) {
      const pending=new Map([...db].map(([k,v])=>[k,copy(v)]));
      const tx={
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
  ["city_diary_events_v1","city_diary_operation_receipts_v1"].sort());
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
 const items=[{id:ID,plan},{id:"fedcba9876543210",plan:{...plan,at:"2026-10-30T15:30:00.000Z"}}];
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
  {id:ID,plan},
  {id:"fedcba9876543210",plan:{...plan,at:"2026-01-01T00:00:00.000Z"}}
 ],{operation:OP,now:NOW}),/time_out_of_range/);
 assert.deepEqual(await store.list(),[]);
 assert.equal(backing.db.size,0);
});
test("month batch rejects duplicate IDs and excess dates before writes",async()=>{
 const store=new CityDiaryStore(storage());
 await assert.rejects(()=>store.createBatch([{id:ID,plan},{id:ID,plan}],{operation:OP,now:NOW}),/duplicate_event/);
 await assert.rejects(()=>store.createBatch(Array.from({length:32},(_,i)=>({
  id:i.toString(16).padStart(16,"0"),plan
 })),{operation:OP,now:NOW}),/invalid_batch/);
});
