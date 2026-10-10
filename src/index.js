const MANAGER_URL = "https://t.me/DameCamelias";
const MAIN = [
  [{ text: "✨ Как мы работаем", callback_data: "how" }, { text: "💎 Наши услуги", callback_data: "services" }],
  [{ text: "⭐ Отзывы и оценки", callback_data: "reviews" }, { text: "📝 Оставить заявку", callback_data: "order" }],
  [{ text: "❓ Вопросы и ответы", callback_data: "faq" }, { text: "💬 Связь с менеджером", url: MANAGER_URL }]
];
const back = [[{ text: "← Главное меню", callback_data: "home" }]];
const PHOTO_URLS = {
  home: "https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/welcome.png",
  service_city: "https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/intimcity.png",
  service_ashoo: "https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/ashoo.png",
  reviews: "https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/reviews.png"
};
const PAGES = {
  home: "✦ <b>DAME CAMELIAS</b> ✦\n\n🌹 Добро пожаловать!\n\n💎 <b>Выберите интересующий раздел ниже.</b>",
  how: "✨ <b>КАК МЫ РАБОТАЕМ</b>\n\n<i>Четыре простых шага</i>\n\n<b>01 ✦ Заявка</b>\nУказываете площадку, ссылку на анкету, нужные услуги и пожелания.\n\n<b>02 ✦ Подготовка</b>\nСогласовываем материалы, стоимость и график работы.\n\n<b>03 ✦ Оплата</b>\nВы оплачиваете заказ после согласования всех деталей.\n\n<b>04 ✦ Выполнение</b>\nРаботаем по утверждённому плану. Менеджер остаётся на связи.\n\n🌹 <b>Всё понятно заранее — без лишних этапов.</b>",
  how_terms: "📋 <b>УСЛОВИЯ СОТРУДНИЧЕСТВА</b>\n\n🌹 <b>Сначала согласование — потом оплата.</b>\n\n1️⃣ Заполняете заявку и указываете анкеты.\n\n2️⃣ Мы согласуем объём редакционных работ, материалы и календарь.\n\n3️⃣ Уточняем стоимость.\n\n4️⃣ После подтверждения приступаем к согласованным работам.\n\n💬 Готовые тексты обсуждаются до завершения заказа.\n\n🖋 Описание профиля Intimcity готовится как законченный материал; по представленным условиям после передачи изменения не предусмотрены.\n\n🛡 Для публикации любой обратной связи важно соблюдать правила площадки и не представлять заказной материал как независимое свидетельство посещения.\n\n💎 Детали вашего заказа уточнит менеджер.",
  how_deadlines: "⏳ <b>СРОКИ И ГРАФИК</b>\n\n🌹 <b>Intimcity</b>\n\n⭐ <b>Оценки</b> публикуются в день размещения.\n\n💬 <b>Отзывы</b> проходят стандартную модерацию сайта. Обычно это занимает от <b>1</b> до <b>10</b> дней.\n\n✍️ <b>Описание</b> анкеты готовится индивидуально для каждой девушки. Срок подготовки — до 2 дней после оплаты.\n\n✦ После согласования графика публикаций анкета должна оставаться активной в назначенные дни с<b> 10:00 до 17:00.</b>\n\n💗 <b>ASHOO</b>\n\nСроки редакционных услуг уточняются при согласовании заявки.\n\n📅 Финальный график обсуждается до оплаты. Сроки модерации определяет сама площадка.",
  services: "💎 <b>НАШИ УСЛУГИ</b>\n\n🌹 <b>Intimcity</b>\nПодготовка текстов, оформление анкеты и работа с обратной связью.\n\n💗 <b>ASHOO</b>\nПодготовка текстов и работа с обратной связью.\n\n<b>Выберите площадку ниже, чтобы посмотреть услуги и цены. 💌</b>",
  service_city: "🌹 <b>INTIMCITY — ПРАЙС</b>\n\n<i>Работа с анкетой и отзывами</i>\n\n✍️ <b> Публикация отзыва с нашим текстом - 500 ₽</b>\n\nПишем материал по предоставленной информации или исходя из нашего опыта.\n\n🖋 <b>Публикация отзыва  с вашим текстом — 400 ₽</b>\n\nДословный  перенос вашего текста\n\n📜 <b>Описание анкеты — 2 000 ₽</b>\n\nПишем выразительное продающее описание ваших достоинств, особенностей и услуг.\n\n⏳ Описание — изготавливается до 2 дней после оплаты.\n\n💬 публикация текстов площадкой, согласно условиям компании после прохождения модерации, обычно 1–10 дней.\n\n⭐ Оценки публикуются день в день.\n\n<b>Готовы создать заказ?</b> Нажмите «Оформить заявку».",
  service_ashoo: "💗 <b>ASHOO — ПРАЙС</b>\n\n<i>Отзывы и редакционные услуги</i>\n\n✍️ Публикация отзыва с нашим текстом  <b>— 1 000 ₽</b>\n\nПишем материал по предоставленной информации или исходя из нашего опыта.\n\n🖋 <b>Публикация отзыва  с вашим текстом — 800 ₽</b>\n\nРаботаем с вашим текстом дословный перенос\n\n🌸 Здесь предлагаем именно публикацию текста.\n\n💌 Все пожелания, объём и сроки можно обсудить с менеджером.",
  reviews: "⭐ <b>ОТЗЫВЫ И ОЦЕНКИ</b>\n\n💬 <b>Отзывы — доверие к вам и уверенность клиента.</b>\n\nПодлинные отзывы помогают мужчине узнать вас лучше ещё до встречи: понять особенности общения, атмосферу и сервис. Это даёт больше информации для выбора и помогает клиенту чувствовать себя увереннее.\n\n🌟 <b>Оценки — информация и позиции в поиске.</b>\n\nОценки отражают репутацию анкеты на площадке и могут учитываться алгоритмами сайта. Более высокая оценка может способствовать повышению анкеты в поисковой выдаче, но конкретное место определяет сама площадка.\n\n💎 <b>Хотите ознакомиться с услугами?</b>\nВыберите каталог ниже.",
  review_text: "💬 <b>ОТЗЫВ ПОД АНКЕТОЙ</b>\n\nХороший отзыв отвечает на конкретные вопросы читателя:\n\n🌹 Как прошла встреча и общение?\n\n✨ Чем запомнился сервис?\n\n🤍 Какие детали важны будущим посетителям?\n\n💎 Что соответствует описанию анкеты?\n\n<b>Мы помогаем и опубликовать впечатления</b> грамотно, ярко и понятно.",
  review_profile: "📜 <b>ОПИСАНИЕ АНКЕТЫ</b>\n\nФотографии привлекают внимание. Описание помогает понять, чего ожидать.\n\n✨ Сильные стороны и характер.\n\n🌹 Атмосфера общения.\n\n💎 Услуги и особенности.\n\n🖋 Грамотный текст без штампов.\n\n<b>Intimcity — 2 000 ₽.</b>\n\n⏳ Срок подготовки по условиям компании — до 2 дней после оплаты.",
  faq: "❓ <b>ВОПРОСЫ И ОТВЕТЫ</b>\n\nМы открыто рассказываем о том, что входит в услуги DAME CAMELIAS, сколько это стоит и как проходит работа.\n\n🛡 Конфиденциальность\n\n👤 Аккаунты и репутация\n\n⏳ Сроки и график\n\n✍️ Тексты отзывов\n\n💳 Оплата и условия\n\n🌹 Опыт компании\n\n<b>Выберите интересующую тему ниже.</b>",
  faq_safe: "🛡 <b>БЕЗОПАСНОСТЬ И КОНФИДЕНЦИАЛЬНОСТЬ</b>\n\n<b>Как вы работаете с моей анкетой?</b>\n\nМы заранее согласовываем услуги, материалы и сроки. Для подготовки текстов достаточно сведений, относящихся к заказу.\n\nВ работе с аккаунтами используем телефоны, прокси, разные интернет-соединения, номера телефонов и геолокации.",
  faq_accounts: "👤 <b>АККАУНТЫ И РЕПУТАЦИЯ</b>\n\n⭐ <b>Что формирует доверие?</b>\n\n<b>Наши аккаунты</b>\n\n<b>Не однодневки</b>\n\nИмеют возраст не менее 1.5 года\n\nАктивная жизнь на сайте\n\nИмеют множество оценок и отзывах под анкетами девушек\n\nДостойная репутация на сайте",
  faq_schedule: "⏳ <b>СРОКИ И ГРАФИК</b>\n\n📋 Сначала заявка, затем согласование объёма и графика, после этого оплата.\n\n🌹 <b>Intimcity</b>\n\n• Описание анкеты — до 2 дней после оплаты.\n\n• Указанный в условиях срок модерации отзывов — обычно 1–10 дней.\n\n• Согласованный интервал активности анкеты — 10:00–17:00 в назначенные дни.\n\n💗 <b>ASHOO</b>\n\nСроки уточняются по конкретному заказу.\n\n💬время модерации отзыва  не зависят от DAME CAMELIAS.",
  faq_writing: "✍️ <b>ПОДГОТОВКА ТЕКСТОВ</b>\n\n<b>Вы сами пишете отзывы?</b>\n\nДа, мы оказываем услуги подготовки и редактирования текстов. Для достоверного отзыва нам нужны факты и реальный опыт ваших клиентов.\n\n<b>Можно прислать свой текст?</b>\n\nКонечно. Дословно опубликуем ваш текст\n\n<b>Можно выбрать стиль?</b>\n\nДа: нежный, лаконичный, яркий, подробный — обсуждаем заранее.",
  faq_payment: "💳 <b>ОПЛАТА И УСЛОВИЯ</b>\n\n🌹 Перед оплатой согласуем объём работ, тексты и график.\n\n<b>Цены на редакционные услуги:</b>\n\n🌹 Intimcity — 500 ₽ за подготовку текста, 400 ₽ за редактуру, 2 000 ₽ за описание.\n\n💗 ASHOO — 1 000 ₽ за подготовку текста, 800 ₽ за редактуру.\n\n🖋 По заявленным условиям компании завершённое описание Intimcity после передачи не редактируется.\n\n💬 За индивидуальным расчётом — к менеджеру.",
  faq_about: "🌹 <b>О КОМПАНИИ DAME CAMELIAS</b>\n\n💎 Мы специализируемся на услугах продвижения и репутационного оформления анкет на Intimcity и ASHOO.\n\n✨ Команда работает более трёх лет.\n\n⭐ Наш фокус — отзывы, оценки, тексты и описание анкет.\n\n🤍 Мы не предлагаем и не публикуем  негативные отзывы о конкурентках.\n\n📋 Каждая заявка обсуждается индивидуально: состав работ, цена, сроки и материалы согласуются заранее.",
  order: "📝 <b>ОСТАВИТЬ ЗАЯВКУ</b>\n\n💌 Чтобы обсудить заказ, нажмите кнопку <b>«Написать менеджеру»</b>.\n\n🌹 Менеджер уточнит площадку, ссылку на анкету, интересующие услуги и пожелания.\n\n📅 Фирменную HTML-анкету с календарём мы подключим отдельно.",
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
  if (key === "how") return {inline_keyboard:[
    [{text:"💎 Посмотреть услуги",callback_data:"services"}],
    [{text:"📝 Оставить заявку",callback_data:"order"}],
    [{text:"💬 Задать вопрос менеджеру",url:MANAGER_URL}],
    ...back
  ]};
  if (["how_terms","how_deadlines"].includes(key)) return {inline_keyboard:[
    [{text:"← Как мы работаем",callback_data:"how"}],...back
  ]};
  if (key === "services") return { inline_keyboard:[
    [{text:"🌹 Intimcity",callback_data:"service_city"}],
    [{text:"💗 ASHOO",callback_data:"service_ashoo"}],
    [{text:"📝 Оставить заявку",callback_data:"order"}],
    [{text:"💬 Менеджер",url:MANAGER_URL}], ...back
  ]};
  if (["service_city","service_ashoo"].includes(key)) return {inline_keyboard:[
    [{text:"📝 Оформить заявку",callback_data:"order"}],
    [{text:"← Наши услуги",callback_data:"services"}], ...back
  ]};
  if (key === "reviews") return {inline_keyboard:[
    [{text:"💎 Посмотреть услуги",callback_data:"services"}],
    [{text:"📝 Оставить заявку",callback_data:"order"}],
    ...back
  ]};
  if (["review_text","review_profile"].includes(key)) return {inline_keyboard:[
    [{text:"← Отзывы и оценки",callback_data:"reviews"}],...back
  ]};
  if (key === "faq") return {inline_keyboard:[
    [{text:"🛡 Безопасность и конфиденциальность",callback_data:"faq_safe"}],
    [{text:"👤 Аккаунты и репутация",callback_data:"faq_accounts"}],
    [{text:"⏳ Сроки и график",callback_data:"faq_schedule"}],
    [{text:"✍️ Подготовка текстов",callback_data:"faq_writing"}],
    [{text:"💳 Оплата и условия",callback_data:"faq_payment"}],
    [{text:"🌹 О компании",callback_data:"faq_about"}],
    [{text:"💬 Задать вопрос",url:MANAGER_URL}], ...back
  ]};
  if (key.startsWith("faq_")) return {inline_keyboard:[
    [{text:"← Все вопросы",callback_data:"faq"}],
    [{text:"💬 Написать менеджеру",url:MANAGER_URL}], ...back
  ]};
  if (key === "order") {
    const buttons=[];
    if (env.FORM_URL && /^https:\/\//.test(env.FORM_URL))
      buttons.push([{text:"📝 Открыть анкету",url:env.FORM_URL}]);
    buttons.push([{text:"💬 Написать менеджеру",url:MANAGER_URL}],...back);
    return {inline_keyboard:buttons};
  }
  return {inline_keyboard:back};
}
// Send a new page then remove the previous one: works for both photo and text messages.
async function sendPage(env, chatId, key) {
  const payload = {
    chat_id: chatId, parse_mode: "HTML",
    reply_markup: keyboard(key, env)
  };
  const photo = PHOTO_URLS[key];
  if (photo && PAGES[key].length <= 1024) {
    try {
      return await telegram(env, "sendPhoto", {
        ...payload, photo, caption: PAGES[key]
      });
    } catch (err) {
      console.error("Telegram photo delivery failed; using text fallback:", key, err);
    }
  }
  return telegram(env, "sendMessage", { ...payload, text: PAGES[key] });
}
async function handle(update, env) {
  if (update.callback_query) {
    const cb = update.callback_query;
    await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id });
    if (!cb.message) return;
    const key = Object.hasOwn(PAGES, cb.data) ? cb.data : "home";
    await sendPage(env, cb.message.chat.id, key);
    try {
      await telegram(env, "deleteMessage", {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id
      });
    } catch (err) {
      console.error("Could not remove previous menu:", err);
    }
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
  await sendPage(env, update.message.chat.id, key);
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
