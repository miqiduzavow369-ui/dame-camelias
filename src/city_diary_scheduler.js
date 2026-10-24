// Separate Cloudflare Durable Object blueprint for City diary reminders.
// NOT registered in wrangler.toml and NOT reachable from production routes.
// The manual City's OrderReminder alarm is intentionally untouched.
import {nextDiaryAlarm,dueDiaryNotifications,claimDiaryDelivery,
  settleDiaryDelivery,acknowledgeDiaryDelivery,recordDiaryMessageCleanup,diaryReminderMessage,diaryThanksCallback} from "./city_diary_delivery.js";

const EVENTS="diary_scheduler_events_v1",DELIVERIES="diary_scheduler_deliveries_v1";
const USER="diary_scheduler_owner_v1", SCHEDULE_REVISION="diary_scheduler_revision_v1";
const ACK_UPDATES="diary_scheduler_ack_updates_v1";
const SAFE_USER=/^[1-9]\d{4,15}$/;
const TOKEN=/^[a-f0-9]{16,32}$/;
const reply=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
const copy=value=>JSON.parse(JSON.stringify(value));

export class CityDiaryScheduler {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(request){
    // No public routes: caller must supply an internal bearer secret.
    // Even once bound, no userId from HTTP is authoritative without the private coordinator.
    if(!this.env.CITY_DIARY_INTERNAL_TOKEN ||
       request.headers.get("Authorization")!=="Bearer "+this.env.CITY_DIARY_INTERNAL_TOKEN)
      return reply({ok:false,reason:"forbidden"},403);
    let input;
    try{input=await request.json();}catch{return reply({ok:false,reason:"bad_request"},400);}
    if(!SAFE_USER.test(String(input?.userId||"")))
      return reply({ok:false,reason:"invalid_user"},400);
    return this.ctx.blockConcurrencyWhile(async()=>{
      const storage=this.ctx.storage;
      const owner=await storage.get(USER);
      if(owner!==undefined&&owner!==String(input.userId))
        return reply({ok:false,reason:"wrong_owner"},403);
      if(!owner)await storage.put(USER,String(input.userId));
      if(input.type==="replace_schedule"){
        // The owner coordinator must provide a monotonically increasing snapshot
        // revision. Old delayed snapshots may never revive cancelled reminders.
        if(!Number.isSafeInteger(input.scheduleRevision)||input.scheduleRevision<1)
          return reply({ok:false,reason:"invalid_schedule_revision"},400);
        const lastRevision=await storage.get(SCHEDULE_REVISION)||0;
        if(input.scheduleRevision<=lastRevision)
          return reply({ok:false,reason:"stale_schedule",currentRevision:lastRevision},409);
        // This is a standalone transport snapshot; the cabinet remains authoritative.
        // Only reminder events may be sent; never schedule publication submissions here.
        const events=input.events;
        if(!Array.isArray(events)||events.length>120||
           events.some(e=>e.mode!=="reminder"||e.status!=="scheduled"||
             typeof e.id!=="string"||!TOKEN.test(e.id)||!Number.isFinite(Date.parse(e.at))))
          return reply({ok:false,reason:"invalid_events"},400);
        if(new Set(events.map(e=>e.id)).size!==events.length)
          return reply({ok:false,reason:"duplicate_event"},400);
        const delivered=await storage.get(DELIVERIES)||{};
        const previous=await storage.get(EVENTS)||[];
        const previousById=new Map(previous.map(e=>[e.id,e]));
        // Never re-send a previous id even if client changes event version.
        // Remove cancelled plans without discarding their delivery receipts.
        const accepted=events.filter(e=>{
          const old=previousById.get(e.id);
          return !(old&&old.revision>e.revision);
        });
        // Persist snapshot and its monotonic version atomically; a crash must
        // never leave a newer cancellation version attached to old events.
        await storage.transaction(async tx=>{
          const current=await tx.get(SCHEDULE_REVISION)||0;
          if(input.scheduleRevision<=current)throw Error("stale_schedule");
          await tx.put(EVENTS,copy(accepted));
          await tx.put(SCHEDULE_REVISION,input.scheduleRevision);
        });
        await this.rearm(accepted,delivered);
        return reply({ok:true,count:accepted.length,scheduleRevision:input.scheduleRevision});
      }
      if(input.type==="status"){
        const deliveries=await storage.get(DELIVERIES)||{};
        const record=deliveries[input.eventId];
        return reply({ok:true,record:record?copy(record):null});
      }
      if(input.type==="record_cleanup"){
        if(!TOKEN.test(String(input.eventId||""))||
           !Number.isSafeInteger(input.messageId)||input.messageId<1||
           typeof input.deleted!=="boolean")
          return reply({ok:false,reason:"bad_request"},400);
        const deliveries=await storage.get(DELIVERIES)||{};
        try{
          const result=recordDiaryMessageCleanup(deliveries,
            input.eventId,input.messageId,input.deleted);
          await storage.put(DELIVERIES,result.deliveries);
          return reply({ok:true,replay:result.replay===true,record:result.record});
        }catch{return reply({ok:false,reason:"cleanup_rejected"},409);}
      }
      if(input.type==="acknowledge"){
        if(!TOKEN.test(String(input.eventId||""))||
           !Number.isSafeInteger(input.messageId)||typeof input.callbackData!=="string")return reply({ok:false,reason:"bad_request"},400);
        if(input.updateId!==undefined&&
           (!Number.isSafeInteger(input.updateId)||input.updateId<0))
          return reply({ok:false,reason:"invalid_update_id"},400);
        try{
          const result=await storage.transaction(async tx=>{
            const deliveries=await tx.get(DELIVERIES)||{};
            const updates=await tx.get(ACK_UPDATES)||{};
            const key=input.updateId===undefined?null:String(input.updateId);
            const signature=JSON.stringify([input.eventId,input.messageId,input.callbackData]);
            if(key!==null&&Object.hasOwn(updates,key)&&updates[key]!==signature)
              throw Error("update_id_conflict");
            const next=acknowledgeDiaryDelivery(deliveries,
              input.eventId,input.messageId,input.callbackData);
            const receipts=Object.fromEntries(Object.entries(updates).slice(-255));
            if(key!==null)receipts[key]=signature;
            await tx.put(DELIVERIES,next.deliveries);
            if(key!==null)await tx.put(ACK_UPDATES,receipts);
            return next;
          });
          return reply({ok:true,replay:result.replay===true,record:result.record});
        }catch{return reply({ok:false,reason:"invalid_acknowledgement"},409);}
      }
      return reply({ok:false,reason:"unknown_action"},400);
    });
  }
  async rearm(events,deliveries){
    const at=nextDiaryAlarm(events,deliveries);
    if(at===null)await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,at));
  }
  async alarm(){
    return this.ctx.blockConcurrencyWhile(async()=>{
      const storage=this.ctx.storage;
      const owner=await storage.get(USER);
      const events=await storage.get(EVENTS)||[];
      let deliveries=await storage.get(DELIVERIES)||{};
      if(!owner||!SAFE_USER.test(owner)){await storage.deleteAlarm();return;}
      const due=dueDiaryNotifications(events,deliveries);
      for(const event of due){
        // Persist claim before Telegram send; never duplicate after uncertain result.
        const attemptId=Array.from(crypto.getRandomValues(new Uint8Array(12)))
          .map(v=>v.toString(16).padStart(2,"0")).join("");
        const claim=claimDiaryDelivery(deliveries,event,{attemptId});
        deliveries=claim.deliveries;
        await storage.put(DELIVERIES,deliveries);
        let result={state:"delivery_unknown"};
        try{
          const text=diaryReminderMessage(event);
          const response=await fetch("https://api.telegram.org/bot"+this.env.BOT_TOKEN+"/sendMessage",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({chat_id:owner,text,protect_content:true,
              reply_markup:{inline_keyboard:[[{text:"Спасибо ✨",callback_data:diaryThanksCallback(event.id,attemptId)}]]}}),
            signal:AbortSignal.timeout(10000)
          });
          const body=await response.json();
          if(response.ok&&body.ok&&Number.isSafeInteger(body.result?.message_id))
            result={state:"sent",telegramMessageId:body.result.message_id};
          else if(!response.ok&&response.status>=400&&response.status<500)
            result={state:"delivery_failed"};
        }catch{/* Unknown outcome is never retried automatically. */}
        const settled=settleDiaryDelivery(deliveries,event.id,attemptId,result);
        deliveries=settled.deliveries;
        await storage.put(DELIVERIES,deliveries);
      }
      await this.rearm(events,deliveries);
    });
  }
}
