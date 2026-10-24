// Diary reminder delivery engine: pure immutable operations.
// Deliberately separate from orders, credits, moderation and existing DO alarms.
// Claim BEFORE calling Telegram. An uncertain network outcome is not retried
// blindly because Telegram sendMessage has no idempotency key.
import {DiaryError} from "./city_diary_model.js";
const fail=code=>{throw new DiaryError(code);};
const clone=x=>JSON.parse(JSON.stringify(x));
const MAX_DUE=25;
export const DIARY_DELIVERY_STATES=Object.freeze([
  "pending","claimed","sent","delivery_unknown","delivery_failed","acknowledged","dismissed"
]);
function validEvent(e) {
  return e&&typeof e.id==="string"&&/^[a-f0-9]{16,32}$/.test(e.id)&&
    (e.mode==="reminder"||e.mode==="publication")&&e.status==="scheduled"&&
    Number.isFinite(Date.parse(e.at));
}
export function nextDiaryAlarm(events,deliveries={},now=Date.now()) {
  if(!Number.isSafeInteger(now)||!Array.isArray(events))fail("invalid_schedule");
  let first=null;
  for(const e of events) {
    if(!validEvent(e))continue;
    if(deliveries[e.id]?.state)continue;
    const at=Date.parse(e.at);
    if(first===null||at<first)first=at;
  }
  return first;
}
export function dueDiaryNotifications(events,deliveries={},now=Date.now()) {
  if(!Number.isSafeInteger(now)||!Array.isArray(events))fail("invalid_schedule");
  return events.filter(e=>validEvent(e)&&Date.parse(e.at)<=now&&!deliveries[e.id]?.state)
    .sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))
    .slice(0,MAX_DUE).map(clone);
}
export function claimDiaryDelivery(deliveries,event,{attemptId,now=Date.now()}={}) {
  if(!validEvent(event)||!Number.isSafeInteger(now)||
     typeof attemptId!=="string"||!/^[a-f0-9]{16,32}$/.test(attemptId))
    fail("invalid_delivery");
  const old=deliveries[event.id];
  if(old){
    if(old.attemptId===attemptId)return {deliveries:clone(deliveries),record:clone(old),replay:true};
    fail("delivery_already_claimed");
  }
  const record={eventId:event.id,attemptId,state:"claimed",claimedAt:now,
    eventRevision:event.revision,telegramMessageId:null,updatedAt:now};
  return {deliveries:{...clone(deliveries),[event.id]:record},record:clone(record),replay:false};
}
export function settleDiaryDelivery(deliveries,eventId,attemptId,result,{now=Date.now()}={}) {
  const old=deliveries[eventId];
  if(!old||old.attemptId!==attemptId)fail("delivery_claim_missing");
  if(old.state!=="claimed")fail("delivery_already_settled");
  if(!Number.isSafeInteger(now)||!["sent","delivery_unknown","delivery_failed"].includes(result?.state))
    fail("invalid_delivery_result");
  const msg=result.state==="sent"?result.telegramMessageId:null;
  if(result.state==="sent"&&(!Number.isSafeInteger(msg)||msg<1))fail("invalid_message_id");
  const record={...old,state:result.state,telegramMessageId:msg,updatedAt:now};
  return {deliveries:{...clone(deliveries),[eventId]:record},record:clone(record)};
}
export function diaryThanksCallback(eventId,attemptId) {
  if(typeof eventId!=="string"||!/^[a-f0-9]{16,32}$/.test(eventId)||
     typeof attemptId!=="string"||!/^[a-f0-9]{16,32}$/.test(attemptId))
    fail("invalid_callback");
  // Telegram callback_data must fit 64 bytes. 32-char ID + 12-char nonce = 62.
  return "citydiary:thanks:"+eventId+":"+attemptId.slice(0,12);
}
export function parseDiaryThanksCallback(data) {
  if(typeof data!=="string"||data.length>64)return null;
  const m=/^citydiary:thanks:([a-f0-9]{16,32}):([a-f0-9]{12})$/.exec(data);
  return m?{eventId:m[1],nonce:m[2]}:null;
}
export function acknowledgeDiaryDelivery(deliveries,eventId,telegramMessageId,callbackData,{now=Date.now()}={}) {
  const old=deliveries[eventId];
  if(!old)fail("delivery_claim_missing");
  if(old.state==="acknowledged") {
    const parsed=parseDiaryThanksCallback(callbackData);
    if(old.telegramMessageId!==telegramMessageId||!parsed||parsed.eventId!==eventId||
       parsed.nonce!==old.attemptId?.slice(0,12))fail("invalid_acknowledgement");
    return {deliveries:clone(deliveries),record:clone(old),replay:true};
  }
  const parsed=parseDiaryThanksCallback(callbackData);
  if(old.state!=="sent"||old.telegramMessageId!==telegramMessageId||
     !parsed||parsed.eventId!==eventId||
     parsed.nonce!==old.attemptId?.slice(0,12)||!Number.isSafeInteger(now))
    fail("invalid_acknowledgement");
  const record={...old,state:"acknowledged",acknowledgedAt:now,updatedAt:now};
  return {deliveries:{...clone(deliveries),[eventId]:record},record:clone(record),replay:false};
}
export function claimDiaryMessageCleanup(deliveries,eventId,telegramMessageId,{now=Date.now()}={}) {
  const old=deliveries?.[eventId];
  if(!old||old.state!=="acknowledged"||old.telegramMessageId!==telegramMessageId||
     !Number.isSafeInteger(now))fail("invalid_cleanup");
  if(old.cleanupStatus==="deleted"||old.cleanupStatus==="in_progress")
    return {deliveries:clone(deliveries),record:clone(old),claimed:false};
  const attempts=old.cleanupAttempts||0;
  if(attempts>=3)fail("cleanup_limit");
  const record={...old,cleanupStatus:"in_progress",cleanupAttempts:attempts+1,
    cleanupUpdatedAt:now,updatedAt:now};
  return {deliveries:{...clone(deliveries),[eventId]:record},
    record:clone(record),claimed:true};
}
export function recordDiaryMessageCleanup(deliveries,eventId,telegramMessageId,deleted,{now=Date.now()}={}) {
  const old=deliveries?.[eventId];
  if(!old||old.state!=="acknowledged"||
     old.telegramMessageId!==telegramMessageId||
     typeof deleted!=="boolean"||!Number.isSafeInteger(now))
    fail("invalid_cleanup");
  if(old.cleanupStatus==="deleted")
    return {deliveries:clone(deliveries),record:clone(old),replay:true};
  if(old.cleanupStatus!=="in_progress")fail("cleanup_not_claimed");
  const record={...old,cleanupStatus:deleted?"deleted":"failed",
    cleanupUpdatedAt:now,updatedAt:now};
  return {deliveries:{...clone(deliveries),[eventId]:record},
    record:clone(record),replay:false};
}
export function diaryReminderMessage(event) {
  if(!event||event.mode!=="reminder")fail("not_reminder");
  const action={
    profile:"проверить анкету",rating:"заняться оценками",
    review:"подготовить отзыв",rating_review:"заняться отзывом и оценками"
  }[event.action];
  if(!action)fail("invalid_action");
  const lines=["✦ DAME CAMELIAS · ВАШЕ НАПОМИНАНИЕ",
    "Сегодня вы планировали "+action+".",
    "📅 "+(event.localDate||event.at.slice(0,10)),
    event.profileId?"👤 Анкета №"+event.profileId:"",
    event.reviewText?"✍️ Ваш текст:\n"+event.reviewText:""];
  // Plain text: review copy stays in the private chat; no HTML injection.
  return lines.filter(Boolean).join("\n\n");
}
