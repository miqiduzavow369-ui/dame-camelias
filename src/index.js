const MANAGER_URL = "https://t.me/DameCamelias";
const MAIN = [
  [{ text: "✨ Как это работает", callback_data: "how" }, { text: "💎 Наши услуги", callback_data: "services" }],
  [{ text: "⭐ Отзывы и оценки", callback_data: "reviews" }, { text: "📝 Оставить заявку", callback_data: "order" }],
  [{ text: "❓ Вопросы и ответы", callback_data: "faq" }, { text: "💬 Связь с менеджером", url: MANAGER_URL }]
];
const back = [[{ text: "← Главное меню", callback_data: "home" }]];
const PAGES = {
  home: "<b>✦ DAME CAMELIAS ✦</b>\n\nДобро пожаловать в наш персональный сервис. Деликатная коммуникация и внимание к деталям.\n\nВыберите раздел:",
  how: "✦ <b>DAME CAMELIAS</b> ✦\n\n🌹 <b>Как проходит наше сотрудничество</b>\n\nБлагодарим вас за доверие к DAME CAMELIAS.\n\nМы ценим индивидуальный подход, внимание к деталям и возможность заранее согласовать все этапы работы.\n\n<b>01 ✦ ЗНАКОМСТВО С ВАШЕЙ АНКЕТОЙ</b>\n\nВы заполняете небольшую форму, указываете площадку, ссылки на профили, необходимые услуги, пожелания и удобные даты.\n\n<b>02 ✦ ПОДГОТОВКА ПЛАНА</b>\n\nПосле изучения заявки мы составляем индивидуальный график работы с учётом особенностей вашей анкеты.\n\n<b>03 ✦ РАБОТА С МАТЕРИАЛАМИ</b>\n\nЕсли вы заказываете подготовку текстов, наша команда составляет их на основе предоставленной вами информации и подлинного клиентского опыта.\n\nГотовые материалы направляются вам для ознакомления.\n\n<b>04 ✦ СОГЛАСОВАНИЕ</b>\n\nМы обсуждаем график, содержание материалов и все важные детали. При необходимости вносим согласованные корректировки.\n\n<b>05 ✦ ОПЛАТА</b>\n\nТолько после вашего ознакомления с заказом и согласования условий мы переходим к оплате.\n\n<b>06 ✦ ВЫПОЛНЕНИЕ</b>\n\nРабота выполняется по утверждённому графику. Менеджер остаётся на связи по организационным вопросам.\n\n🌙 <b>Наш главный принцип</b>\n\nВы заранее знаете, какие работы входят в заказ, их стоимость, сроки и порядок выполнения.\n\n<b>Спасибо за доверие к DAME CAMELIAS.</b>\n\nБудем рады сотрудничеству 🌹",
  how_terms: "<b>📋 Условия сотрудничества</b>\n\n🌹 Работа начинается с анкеты и уточнения пожеланий.\n\n✦ Сначала менеджер согласовывает состав работ, материалы и график.\n\n✦ После согласования заказа происходит оплата.\n\n✦ Тексты готовятся на основе предоставленных материалов и подлинного клиентского опыта.\n\n✦ Организационные изменения и вопросы обсуждаются с менеджером до начала выполнения.\n\n<b>Отдельное условие для Intimcity</b>\n\nОписание профиля готовится индивидуально. По представленным условиям компании после передачи готового авторского описания дальнейшие изменения не предусмотрены.\n\nДля уточнения условий по вашему заказу свяжитесь с менеджером.",
  how_deadlines: "<b>⏳ Сроки выполнения</b>\n\n<b>Intimcity</b>\n\n✦ Подготовка описания профиля — до 2 дней после оплаты.\n\n✦ Отзывы проходят модерацию сайта; в предоставленных условиях указан обычный срок от 1 до 10 дней.\n\n✦ Для согласованного графика предусмотрена активность анкеты в назначенные дни с 10:00 до 17:00.\n\n<b>Общий порядок</b>\n\nДаты и этапы работ заранее обсуждаются с менеджером. Сроки зависят от выбранной услуги и согласованных материалов.\n\nПо срокам для ASHOO и индивидуальным вопросам обращайтесь к менеджеру.",
  services: "<b>💎 Наши услуги</b>\n\n<b>Intimcity</b>\n• Подготовка текста по реальному отзыву — 500 ₽\n• Редактирование текста — 400 ₽\n• Описание профиля — 2 000 ₽\n\n<b>ASHOO</b>\n• Подготовка текста по реальному отзыву — 1 000 ₽\n• Редактирование текста — 800 ₽\n\nЦены указаны за редакционные услуги, без размещения отзывов или выставления оценок.",
  reviews: "<b>⭐ Отзывы и оценки</b>\n\nПомогаем структурировать и редактировать реальные отзывы клиентов, сохраняя их смысл. Фиктивные отзывы и искусственное повышение рейтинга не предлагаем.",
  faq: "<b>❓ Вопросы и ответы</b>\n\n<b>🛡 Почему работа с DAME CAMELIAS безопасна?</b>\n\nМы уделяем особое внимание качеству работы, конфиденциальности и соблюдению правил площадок. Каждая заявка рассматривается индивидуально, а при подготовке текстов мы опираемся на реальный клиентский опыт.\n\n<b>👤 Как выглядят аккаунты пользователей?</b>\n\nМы ориентируемся на полноценные, давно существующие профили с естественной историей активности, заполненной информацией, отзывами и оценками. Для нас важна видимая подлинность аккаунтов и репутация пользователей.\n\n<b>🌍 Почему это 100% безопастно?</b>\n\nКаждый аккаунт работает в индивидуальных условиях: отдельное устройство, собственное интернет-соединение, активный Telegram-аккаунт и уникальная геолокация. При этом у каждой девушки свои показатели по пробивам и проходам.\n\n<b>⭐ Какой опыт работы у DAME CAMELIAS?</b>\n\nМы работаем уже 3 года и уделяем особое внимание качеству услуг, репутации клиентов и аккуратной работе с их профилями. За данный период небыло случаев исключения отзывов или проблем с анкетами девушек . ",
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
  if (key === "how") return { inline_keyboard: [
    [{ text: "📋 Условия сотрудничества", callback_data: "how_terms" }],
    [{ text: "⏳ Сроки выполнения", callback_data: "how_deadlines" }],
    [{ text: "💎 Посмотреть услуги", callback_data: "services" }],
    [{ text: "📝 Оформить заявку", callback_data: "order" }],
    [{ text: "💬 Задать вопрос менеджеру", url: MANAGER_URL }],
    ...back
  ] };
  if (key === "how_terms" || key === "how_deadlines") return { inline_keyboard: [
    [{ text: "← Как это работает", callback_data: "how" }],
    ...back
  ] };
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
