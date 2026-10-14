const DELAY = 2 * 60 * 60 * 1000;
const REASONS = { price: "Стоимость", timing: "Сроки", help: "Нужна помощь" };
const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function send(env, data) {
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000)
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error("Reminder Telegram delivery failed: " + response.status);
  return body.result;
}
export async function reminderCall(env, person, chat, payload) {
  if (!env.ORDER_REMINDERS || !person || person.is_bot || chat?.type !== "private" || !Number.isSafeInteger(person.id)) return {handled:false};
  const stub = env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName(String(person.id)));
  const response = await stub.fetch("https://reminder.internal/", {
    method:"POST", body:JSON.stringify({...payload, person, chatId:chat.id})
  });
  if (!response.ok) throw new Error("Reminder state unavailable");
  return response.json();
}
export class OrderReminder {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const input = await request.json();
    return this.ctx.blockConcurrencyWhile(async () => {
      const storage = this.ctx.storage;
      const state = await storage.get("state") || {};
      const now = Date.now();
      // Dedicated DO identities for one-shot owner review submission.
      // Durable Object storage serializes claims; unlike KV get+put,
      // concurrent Telegram callbacks cannot each win the same claim.
      // Per-Telegram-ID publication credits; independent of reminder data.
      // Only this object's verified server-side callers can operate on credits.
      if (String(input.type||"").startsWith("credits_")) {
        const uid=String(input.userId||"");
        if (!/^\d{5,16}$/.test(uid))return Response.json({error:"invalid_user"},{status:400});
        let ledger=await storage.get("credits_v1");
        if(!ledger){
          ledger={grant:uid==="5866034656"?10:0,spent:0,claims:{},history:[],createdAt:now};
          await storage.put("credits_v1",ledger);
        }
        const claims=ledger.claims||{};
        const occupied=Object.values(claims).filter(x=>x.status==="reserved").length;
        const balance=Math.max(0,ledger.grant-ledger.spent-occupied);
        if(input.type==="credits_status")
          return Response.json({grant:ledger.grant,spent:ledger.spent,
            available:balance,reserved:occupied,remaining:ledger.grant-ledger.spent});
        const key=String(input.kind)+":"+String(input.profileId||"");
        if(!["rating","review"].includes(input.kind) ||
           !/^\d{1,9}$/.test(String(input.profileId)) ||
           !/^[a-f0-9]{12,16}$/.test(String(input.nonce||"")))
          return Response.json({error:"invalid_claim"},{status:400});
        if(input.type==="credits_reserve"){
          if(claims[key])return Response.json({ok:false,reason:"already_claimed"});
          if(balance<=0)return Response.json({ok:false,reason:"empty"});
          claims[key]={status:"reserved",nonce:input.nonce,at:now};
          ledger.claims=claims;
          await storage.put("credits_v1",ledger);
          return Response.json({ok:true,available:balance-1});
        }
        if(input.type==="credits_complete"){
          const claim=claims[key];
          if(!claim || claim.nonce!==input.nonce)
            return Response.json({ok:false,reason:"missing_reservation"},{status:409});
          if(claim.status==="completed")
            return Response.json({ok:true,already:true,remaining:ledger.grant-ledger.spent});
          if(claim.status!=="reserved")
            return Response.json({ok:false,reason:"invalid_status"},{status:409});
          claim.status="completed";claim.completedAt=now;
          ledger.spent++;
          ledger.history=[...(ledger.history||[]),{key,at:now}].slice(-500);
          await storage.put("credits_v1",ledger);
          return Response.json({ok:true,remaining:ledger.grant-ledger.spent});
        }
        return Response.json({error:"invalid_action"},{status:400});
      }
      if (input.type === "review_claim") {
        if (input.account !== "yan_first" || !/^\d{1,9}$/.test(String(input.profileId)) ||
            !/^[a-f0-9]{16}$/.test(String(input.nonce)))
          return Response.json({claimed:false,reason:"invalid"},{status:400});
        const claim = await storage.get("review_claim");
        if (claim) return Response.json({claimed:false,status:claim.status});
        await storage.put("review_claim",{status:"submission_maybe_sent",at:now,nonce:input.nonce});
        return Response.json({claimed:true,status:"submission_maybe_sent"});
      }
      if (input.type === "review_submit_boundary") {
        const claim=await storage.get("review_claim");
        if (!claim || claim.nonce!==input.nonce || claim.status!=="submission_maybe_sent")
          return Response.json({ok:false},{status:409});
        await storage.put("review_claim",{...claim,status:"submission_started",boundaryAt:now});
        return Response.json({ok:true});
      }
      if (input.type === "review_preflight_failed") {
        const claim=await storage.get("review_claim");
        if (!claim || claim.nonce!==input.nonce || claim.status!=="submission_maybe_sent")
          return Response.json({ok:false},{status:409});
        // No attempt was made, but NEVER release or erase claim automatically.
        await storage.put("review_claim",{...claim,status:"preflight_failed",failedAt:now});
        return Response.json({ok:true});
      }
      // One-time recovery of the 2026-10-14 incident only. Never general unlock.
      if (input.type === "review_recover_652282") {
        if (input.account!=="yan_first" || String(input.profileId)!=="652282" ||
            !/^[a-f0-9]{16}$/.test(String(input.nonce)))
          return Response.json({ok:false,reason:"scope"},{status:403});
        const claim=await storage.get("review_claim");
        if (!claim || claim.nonce!==input.nonce ||
            !["preflight_failed","submission_started","submission_maybe_sent"].includes(claim.status))
          return Response.json({ok:false,reason:"not-eligible"},{status:409});
        const prior=await storage.get("review_recovery_652282")||{count:0};
        await storage.put("review_recovery_652282",{
          at:now,oldNonce:claim.nonce,count:prior.count+1,
          previousStatus:claim.status,status:"owner-authorized-temporary-retry"
        });
        await storage.delete("review_claim");
        return Response.json({ok:true});
      }
      if (input.type === "review_status") {
        const claim=await storage.get("review_claim");
        return Response.json({claimed:!!claim,status:claim?.status||"available"});
      }
      if (input.type === "review_verified") {
        const claim=await storage.get("review_claim");
        if (!claim || claim.nonce!==input.nonce) return Response.json({ok:false},{status:409});
        await storage.put("review_claim",{...claim,status:"published",verifiedAt:now});
        return Response.json({ok:true});
      }
      if (input.type === "activity") {
        // Ignore duplicate and out-of-order Telegram updates.
        if (Number.isSafeInteger(input.updateId) && input.updateId <= (state.updateId ?? -1)) return Response.json({handled:false});
        state.updateId = input.updateId;
        state.person = input.person; state.chatId = input.chatId;
        state.lastActivity = now;
        if (input.navigation) state.awaitingReply = false;
        if (input.opensOrder) state.openedOrder = true;
        if (state.pendingReports?.length) await storage.setAlarm(now + 60000);
        else if (state.openedOrder && !state.completed && !state.attemptedAt) await storage.setAlarm(now + DELAY);
      } else if (input.type === "complete") {
        state.completed = true; state.completedAt = now;
        if (!state.pendingReports?.length) await storage.deleteAlarm();
      } else if (input.type === "reply") {
        const reason = REASONS[input.reason];
        if (reason) state.awaitingReply = true;
        const explicit = input.replyTo === state.messageId;
        if (!state.sentAt || (!reason && (state.completed || (!state.awaitingReply && !explicit)))) return Response.json({handled:false});
        if (input.replyTo && !explicit && !reason) return Response.json({handled:false});
        const eventId = String(input.eventId);
        if ((state.reported || []).includes(eventId)) return Response.json({handled:true});
        const person = input.person;
        const label = person.username ? "@" + person.username : [person.first_name, person.last_name].filter(Boolean).join(" ");
        const text = "💎 <b>DAME CAMELIAS — ОТВЕТ НА НАПОМИНАНИЕ</b>\n\n" +
          '👤 <a href="tg://user?id=' + person.id + '">' + escape(label || person.id) + "</a>\n" +
          "🆔 " + person.id + "\n🕐 " + new Intl.DateTimeFormat("ru-RU", {timeZone:"Europe/Moscow", dateStyle:"short", timeStyle:"short"}).format(new Date(now)) + " (МСК)\n\n" +
          (reason ? "🔘 " : "💬 ") + escape(reason || String(input.text || "").slice(0, 2500));
        // Persist before sending: never duplicate a report on Telegram webhook retry.
        state.reported = [...(state.reported || []), eventId].slice(-100);
        await storage.put("state", state);
        try { await send(this.env, {chat_id:5866034656, text, parse_mode:"HTML"}); }
        catch (error) {
          state.pendingReports = [...(state.pendingReports || []), {text, attempts:0}];
          await storage.setAlarm(now + 60000);
          await storage.put("state", state);
          console.error(error);
        }
        await send(this.env, {chat_id:state.chatId, text:state.pendingReports?.length ? "🌹 Спасибо! Ваш ответ сохранён для передачи менеджеру." : "🌹 Спасибо! Ваш ответ передан менеджеру."});
        return Response.json({handled:true});
      }
      await storage.put("state", state);
      return Response.json({handled:false});
    });
  }
  async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const storage = this.ctx.storage, state = await storage.get("state");
      if (state?.pendingReports?.length) {
        const pending=[];
        for (const report of state.pendingReports) {
          try { await send(this.env,{chat_id:5866034656,text:report.text,parse_mode:"HTML"}); }
          catch(error) {
            report.attempts++;
            if(report.attempts<5)pending.push(report);
            else console.error("Reminder report retries exhausted",error);
          }
        }
        state.pendingReports=pending;
        await storage.put("state",state);
        if(pending.length){await storage.setAlarm(Date.now()+60000);return;}
      }
      if (!state?.openedOrder || state.completed || state.attemptedAt) return;
      const due = state.lastActivity + DELAY;
      if (Date.now() < due) { await storage.setAlarm(due); return; }
      // Telegram has no idempotency key. Claim before the network call for at-most-once delivery.
      state.attemptedAt = Date.now();
      await storage.put("state", state);
      try {
        const result = await send(this.env, {
          chat_id:state.chatId, parse_mode:"HTML",
          text:"🌹 Здравствуйте!\n\nВы уже познакомились с <b>DAME CAMELIAS — добавление отзывов и оценок под вашей анкетой</b>, но пока не оформили заявку. 💎\n\n💬 Подскажите, что вас остановило: стоимость, сроки или нужна помощь с оформлением?\n\nВыберите кнопку ниже или просто напишите свой ответ прямо здесь — мы поможем. 🌹",
          reply_markup:{inline_keyboard:[
            [{text:"💎 Стоимость", callback_data:"reminder:price"}, {text:"⏳ Сроки", callback_data:"reminder:timing"}],
            [{text:"💬 Нужна помощь", callback_data:"reminder:help"}]
          ]}
        });
        state.sentAt = Date.now(); state.messageId = result.message_id; state.awaitingReply = true;
      } catch (error) { state.deliveryFailed = true; console.error(error); }
      await storage.put("state", state);
    });
  }
}
