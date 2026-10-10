const MANAGER_URL = "https://t.me/DameCamelias";
const MAIN = [
  [{ text: "✨ Как это работает", callback_data: "how" }, { text: "💎 Наши услуги", callback_data: "services" }],
  [{ text: "⭐ Отзывы и оценки", callback_data: "reviews" }, { text: "📝 Оставить заявку", callback_data: "order" }],
  [{ text: "❓ Вопросы и ответы", callback_data: "faq" }, { text: "💬 Связь с менеджером", url: MANAGER_URL }]
];
const back = [[{ text: "← Главное меню", callback_data: "home" }]];
const PAGES = {
  home: "<b>✦ DAME CAMELIAS ✦</b>\n\nДобро пожаловать в наш персональный сервис. Деликатная коммуникация и внимание к деталям.\n\nВыберите раздел:",
  how: "<b>✨ Как это работает</b>\n\n1. Выберите услугу.\n2. Заполните анкету и укажите профиль.\n3. Проверьте детали.\n4. Менеджер свяжется с вами для согласования.\n\nМы работаем только с подлинной обратной связью.",
  services: "<b>💎 Наши услуги</b>\n\n<b>Intimcity</b>\n• Подготовка текста по реальному отзыву — 500 ₽\n• Редактирование текста — 400 ₽\n• Описание профиля — 2 000 ₽\n\n<b>ASHOO</b>\n• Подготовка текста по реальному отзыву — 1 000 ₽\n• Редактирование текста — 800 ₽\n\nЦены указаны за редакционные услуги, без размещения отзывов или выставления оценок.",
  reviews: "<b>⭐ Отзывы и оценки</b>\n\nПомогаем структурировать и редактировать реальные отзывы клиентов, сохраняя их смысл. Фиктивные отзывы и искусственное повышение рейтинга не предлагаем.",
  faq: "<b>❓ Вопросы и ответы</b>\n\n<b>Как оставить заявку?</b>\nВыберите «Оставить заявку».\n\n<b>Можно указать несколько профилей?</b>\nДа, в анкете предусмотрено несколько профилей.\n\n<b>Минимальный заказ?</b>\n8 позиций суммарно.\n\n<b>Как связаться с менеджером?</b>\nЧерез @DameCamelias.",
  order: "<b>📝 Оставить заявку</b>\n\nАнкета с календарём скоро будет подключена. Пока напишите менеджеру: @DameCamelias."
};
async function telegram(env, method, data) {
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error("Telegram API HTTP " + response.status);
  const result = await response.json();
  if (!result.ok) throw new Error("Telegram API: " + result.description);
  return result.result;
}
function keyboard(key, env) {
  if (key === "home") return { inline_keyboard: MAIN };
  if (key === "order") {
    const buttons = [];
    if (env.FORM_URL && /^https:\/\//.test(env.FORM_URL)) buttons.push([{ text: "📝 Открыть анкету", url: env.FORM_URL }]);
    buttons.push([{ text: "💬 Написать менеджеру", url: MANAGER_URL }], ...back);
    return { inline_keyboard: buttons };
  }
  return { inline_keyboard: back };
}
async function handle(update, env) {
  if (update.callback_query) {
    const cb = update.callback_query;
    await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id });
    if (!cb.message) return;
    const key = Object.hasOwn(PAGES, cb.data) ? cb.data : "home";
    await telegram(env, "editMessageText", {
      chat_id: cb.message.chat.id, message_id: cb.message.message_id,
      text: PAGES[key], parse_mode: "HTML", reply_markup: keyboard(key, env)
    });
    return;
  }
  if (!update.message?.chat?.id) return;
  const cmd = (update.message.text || "").split(" ")[0].split("@")[0];
  const map = { "/start": "home", "/menu": "home", "/how": "how", "/services": "services", "/reviews": "reviews", "/order": "order", "/faq": "faq" };
  if (cmd === "/manager") {
    await telegram(env, "sendMessage", { chat_id: update.message.chat.id, text: "💬 Менеджер: @DameCamelias", reply_markup: { inline_keyboard: [[{ text: "Написать менеджеру", url: MANAGER_URL }], ...back] } });
    return;
  }
  const key = map[cmd] || "home";
  await telegram(env, "sendMessage", { chat_id: update.message.chat.id, text: PAGES[key], parse_mode: "HTML", reply_markup: keyboard(key, env) });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("DAME CAMELIAS bot is ready");
    if (request.method !== "POST" || url.pathname !== "/webhook") return new Response("Not found", { status: 404 });
    if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) return new Response("Not configured", { status: 503 });
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
    let update;
    try { update = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
    ctx.waitUntil(handle(update, env).catch(err => console.error("Update failed", err)));
    return new Response("ok");
  }
};
