import test from "node:test";
import assert from "node:assert/strict";
import {nextDiaryAlarm,dueDiaryNotifications,claimDiaryDelivery,
  settleDiaryDelivery,acknowledgeDiaryDelivery,recordDiaryMessageCleanup,diaryReminderMessage,diaryThanksCallback,parseDiaryThanksCallback}
  from "../src/city_diary_delivery.js";

const NOW=Date.parse("2026-10-24T10:00:00Z");
const id="0123456789abcdef",attemptId="2222222222222222";
const reminder=(at="2026-10-24T09:30:00.000Z")=>({
  id,mode:"reminder",status:"scheduled",action:"review",at,
  revision:1,localDate:"2026-10-24",profileId:"12345",reviewText:"Личный отзыв"
});
test("next alarm picks the earliest pending reminder without touching existing queues",()=>{
 const a=reminder("2026-10-25T09:00:00.000Z");
 const b={...a,id:"fedcba9876543210",at:"2026-10-24T13:00:00.000Z"};
 assert.equal(nextDiaryAlarm([a,b]),Date.parse(b.at));
 assert.equal(nextDiaryAlarm([a,b],{[b.id]:{state:"claimed"}}),Date.parse(a.at));
 assert.equal(nextDiaryAlarm([]),null);
});
test("due scan is bounded, ordered and skips cancelled and already claimed",()=>{
 const a=reminder(),b={...a,id:"fedcba9876543210",at:"2026-10-24T08:30:00.000Z"};
 const c={...a,id:"aaaaaaaaaaaaaaaa",status:"cancelled"};
 const found=dueDiaryNotifications([a,c,b],{},NOW);
 assert.deepEqual(found.map(e=>e.id),[b.id,a.id]);
 assert.deepEqual(dueDiaryNotifications([a,b],{[a.id]:{state:"claimed"}},NOW).map(e=>e.id),[b.id]);
});
test("claim is at-most-once and a replay cannot create a second Telegram attempt",()=>{
 const first=claimDiaryDelivery({},reminder(),{attemptId,now:NOW});
 const replay=claimDiaryDelivery(first.deliveries,reminder(),{attemptId,now:NOW});
 assert.equal(replay.replay,true);
 assert.deepEqual(replay.record,first.record);
 assert.throws(()=>claimDiaryDelivery(first.deliveries,reminder(),{
   attemptId:"3333333333333333",now:NOW}),/delivery_already_claimed/);
});
test("ambiguous Telegram failure is never automatically requeued",()=>{
 const claimed=claimDiaryDelivery({},reminder(),{attemptId,now:NOW});
 const lost=settleDiaryDelivery(claimed.deliveries,id,attemptId,
  {state:"delivery_unknown"},{now:NOW+1000});
 assert.equal(lost.record.state,"delivery_unknown");
 assert.deepEqual(dueDiaryNotifications([reminder()],lost.deliveries,NOW+2000),[]);
 assert.equal(nextDiaryAlarm([reminder()],lost.deliveries),null);
});
test("acknowledgment requires exact delivered message and is idempotent",()=>{
 const a=claimDiaryDelivery({},reminder(),{attemptId,now:NOW});
 const b=settleDiaryDelivery(a.deliveries,id,attemptId,
  {state:"sent",telegramMessageId:6789},{now:NOW+10});
 assert.throws(()=>acknowledgeDiaryDelivery(b.deliveries,id,999,diaryThanksCallback(id,attemptId),{now:NOW+20}),/invalid_acknowledgement/);
 const c=acknowledgeDiaryDelivery(b.deliveries,id,6789,diaryThanksCallback(id,attemptId),{now:NOW+20});
 assert.equal(c.record.state,"acknowledged");
 assert.equal(acknowledgeDiaryDelivery(c.deliveries,id,6789,diaryThanksCallback(id,attemptId),{now:NOW+30}).replay,true);
});
test("a reminder message is safe plain text and publication mode cannot masquerade",()=>{
 const e=reminder();const message=diaryReminderMessage(e);
 assert.ok(message.includes("Анкета №12345"));
 assert.ok(message.includes("Личный отзыв"));
 assert.throws(()=>diaryReminderMessage({...e,mode:"publication"}),/not_reminder/);
});

test("Telegram callback carries an unpredictable attempt nonce within 64 bytes",()=>{
 const callback=diaryThanksCallback(id,attemptId);
 assert.ok(callback.length<=64);
 assert.deepEqual(parseDiaryThanksCallback(callback),{eventId:id,nonce:attemptId.slice(0,12)});
 assert.equal(parseDiaryThanksCallback(callback+"garbage"),null);
 assert.equal(parseDiaryThanksCallback("citydiary:thanks:"+id),null);
});
test("replay acknowledgement rejects forged callback even after it was acknowledged",()=>{
 const a=claimDiaryDelivery({},reminder(),{attemptId,now:NOW});
 const b=settleDiaryDelivery(a.deliveries,id,attemptId,
  {state:"sent",telegramMessageId:6789},{now:NOW+10});
 const good=diaryThanksCallback(id,attemptId);
 const c=acknowledgeDiaryDelivery(b.deliveries,id,6789,good,{now:NOW+20});
 assert.throws(()=>acknowledgeDiaryDelivery(c.deliveries,id,6789,
   diaryThanksCallback(id,"ffffffffffffffff"),{now:NOW+30}),/invalid_acknowledgement/);
});

test("cleanup receipts never re-send reminders and preserve acknowledged delivery",()=>{
 const a=claimDiaryDelivery({},reminder(),{attemptId,now:NOW});
 const b=settleDiaryDelivery(a.deliveries,id,attemptId,
   {state:"sent",telegramMessageId:6789},{now:NOW+1});
 const c=acknowledgeDiaryDelivery(b.deliveries,id,6789,diaryThanksCallback(id,attemptId),{now:NOW+2});
 const failed=recordDiaryMessageCleanup(c.deliveries,id,6789,false,{now:NOW+3});
 assert.equal(failed.record.cleanupStatus,"failed");
 assert.equal(failed.record.state,"acknowledged");
 const deleted=recordDiaryMessageCleanup(failed.deliveries,id,6789,true,{now:NOW+4});
 assert.equal(deleted.record.cleanupStatus,"deleted");
 assert.equal(deleted.record.cleanupAttempts,2);
 assert.equal(recordDiaryMessageCleanup(deleted.deliveries,id,6789,false,{now:NOW+5}).replay,true);
 assert.equal(nextDiaryAlarm([reminder()],deleted.deliveries),null);
});
test("cleanup requires acknowledged matching delivery and has bounded failures",()=>{
 const a=claimDiaryDelivery({},reminder(),{attemptId,now:NOW});
 assert.throws(()=>recordDiaryMessageCleanup(a.deliveries,id,6789,true,{now:NOW}),/invalid_cleanup/);
 const b=settleDiaryDelivery(a.deliveries,id,attemptId,
   {state:"sent",telegramMessageId:6789},{now:NOW+1});
 const c=acknowledgeDiaryDelivery(b.deliveries,id,6789,diaryThanksCallback(id,attemptId),{now:NOW+2});
 assert.throws(()=>recordDiaryMessageCleanup(c.deliveries,id,1,true,{now:NOW+3}),/invalid_cleanup/);
 let state=c.deliveries;
 for(let i=0;i<3;i++)state=recordDiaryMessageCleanup(state,id,6789,false,{now:NOW+3+i}).deliveries;
 assert.throws(()=>recordDiaryMessageCleanup(state,id,6789,true,{now:NOW+9}),/cleanup_limit/);
});
