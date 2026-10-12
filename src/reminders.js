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
