import test from "node:test";
import assert from "node:assert/strict";
import {DiaryError,createDiaryEvent,addDiaryEvent,editDiaryEvent,transitionDiaryEvent,dueDiaryEvents,listDiaryEvents} from "../src/city_diary_model.js";

const NOW=Date.parse("2026-10-24T10:00:00.000Z");
const at="2026-10-28T15:30:00.000Z";
const plan={mode:"publication",action:"review",at,profileId:"652282",reviewText:"Мой личный отзыв"};
const id="0123456789abcdef";
const make=()=>createDiaryEvent(plan,{id,now:NOW});
test("schedule persists only the plan; no execution or credit side effects",()=>{
 const e=make();
 assert.equal(e.status,"scheduled");
 assert.equal(e.revision,1);
 assert.deepEqual(Object.keys(e).sort(),["action","at","createdAt","id","mode","profileId","reviewText","revision","status","updatedAt"].sort());
});
test("rejects invalid and past dates, empty publication text and invalid identities",()=>{
 assert.throws(()=>createDiaryEvent({...plan,at:"2026-10-23T15:30:00.000Z"},{id,now:NOW}),DiaryError);
 assert.throws(()=>createDiaryEvent({...plan,reviewText:""},{id,now:NOW}),/review_text_required/);
 assert.throws(()=>createDiaryEvent({...plan,profileId:"abc"},{id,now:NOW}),/invalid_profile/);
 assert.throws(()=>createDiaryEvent({...plan,at:"2026-02-30T00:00:00.000Z"},{id,now:NOW}),/invalid_time/);
});
test("monthly batch is independent and cannot duplicate identifiers",()=>{
 const first=make();const second=createDiaryEvent({...plan,at:"2026-10-30T16:00:00.000Z"},{id:"fedcba9876543210",now:NOW});
 const events=addDiaryEvent(addDiaryEvent([],first),second);
 assert.equal(events.length,2);
 assert.throws(()=>addDiaryEvent(events,first),/duplicate_event/);
 const changed=editDiaryEvent(first,{at:"2026-10-29T15:00:00.000Z"},{expectedRevision:1,now:NOW});
 assert.equal(changed.revision,2);
 assert.equal(events[0].at,at);
 assert.equal(events[1].at,second.at);
});
test("only scheduled events can be changed and stale edits fail",()=>{
 const e=make();
 assert.throws(()=>editDiaryEvent(e,{note:"a"},{expectedRevision:2,now:NOW}),/revision_conflict/);
 const pending=transitionDiaryEvent(e,"awaiting_confirmation",{expectedRevision:1,now:NOW});
 assert.throws(()=>editDiaryEvent(pending,{note:"a"},{expectedRevision:2,now:NOW}),/event_locked/);
});
test("confirm does not imply completed; cancelled and completed are terminal",()=>{
 const a=make(),b=transitionDiaryEvent(a,"awaiting_confirmation",{expectedRevision:1,now:NOW});
 const c=transitionDiaryEvent(b,"submitted",{expectedRevision:2,now:NOW});
 assert.equal(c.status,"submitted");
 assert.throws(()=>transitionDiaryEvent(c,"cancelled",{expectedRevision:3,now:NOW}),/invalid_transition/);
 const done=transitionDiaryEvent(c,"completed",{expectedRevision:3,now:NOW});
 assert.throws(()=>transitionDiaryEvent(done,"submitted",{expectedRevision:4,now:NOW}),/invalid_transition/);
 const cancelled=transitionDiaryEvent(a,"cancelled",{expectedRevision:1,now:NOW});
 assert.throws(()=>transitionDiaryEvent(cancelled,"awaiting_confirmation",{expectedRevision:2,now:NOW}),/invalid_transition/);
});
test("reminders never enter publication approval flow",()=>{
 const e=createDiaryEvent({mode:"reminder",action:"profile",at,reviewText:""},{id,now:NOW});
 assert.throws(()=>transitionDiaryEvent(e,"awaiting_confirmation",{expectedRevision:1,now:NOW}),/invalid_transition/);
});
test("due and range queries are sorted without mutating source",()=>{
 const a=make(),b=createDiaryEvent({...plan,at:"2026-10-29T15:30:00.000Z"},{id:"fedcba9876543210",now:NOW});
 const original=[b,a];const due=dueDiaryEvents(original,Date.parse("2026-10-28T15:31:00.000Z"));
 assert.deepEqual(due.map(e=>e.id),[id]);
 assert.deepEqual(listDiaryEvents(original,{from:"2026-10-28T00:00:00.000Z",to:"2026-11-01T00:00:00.000Z"}).map(e=>e.id),[id,b.id]);
 assert.equal(original[0].id,b.id);
});

test("an IANA timezone and original calendar day are persisted with UTC",()=>{
 const event=createDiaryEvent({...plan,
   at:"2026-10-24T22:30:00.000Z",
   timezone:"Europe/Stockholm",localDate:"2026-10-25"},{id,now:NOW});
 assert.equal(event.localDate,"2026-10-25");
 assert.equal(event.timezone,"Europe/Stockholm");
 assert.equal(event.at,"2026-10-24T22:30:00.000Z");
});
test("inconsistent local day or unknown timezone fails closed",()=>{
 assert.throws(()=>createDiaryEvent({...plan,
   timezone:"Europe/Stockholm",localDate:"2026-10-24",
   at:"2026-10-24T22:30:00.000Z"},{id,now:NOW}),/local_date_mismatch/);
 assert.throws(()=>createDiaryEvent({...plan,
   timezone:"Unknown/Somewhere",localDate:"2026-10-25",
   at:"2026-10-24T22:30:00.000Z"},{id,now:NOW}),/invalid_timezone/);
});
test("rescheduling updates the local date and timezone together",()=>{
 const event=createDiaryEvent({...plan,timezone:"Europe/Stockholm",localDate:"2026-10-28"},
 {id,now:NOW});
 const updated=editDiaryEvent(event,{
   at:"2026-10-29T15:30:00.000Z",localDate:"2026-10-29"
 },{expectedRevision:1,now:NOW});
 assert.equal(updated.localDate,"2026-10-29");
 assert.equal(updated.revision,2);
});

test("all existing City men account IDs are accepted without accepting invented IDs",()=>{
 for(let number=1;number<=30;number++){
  const accountId=number===1?"yan_first":number===2?"yan_second":"yan_"+String(number).padStart(2,"0");
  const event=createDiaryEvent({...plan,accountId},{id,now:NOW});
  assert.equal(event.accountId,accountId);
 }
 for(const accountId of ["yan_01","yan_02","yan_31","yan_99","yan_abc"]){
  assert.throws(()=>createDiaryEvent({...plan,accountId},{id,now:NOW}),/invalid_account/);
 }
});
