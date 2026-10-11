const MANAGER_URL = "https://t.me/DameCamelias";
const MAIN = [
  [{ text: "✨ Как мы работаем", callback_data: "how" }, { text: "💎 Наши услуги", callback_data: "services" }],
  [{ text: "⭐ Отзывы и оценки", callback_data: "reviews" }, { text: "📝 Оставить заявку", callback_data: "order" }],
  [{ text: "❓ Вопросы и ответы", callback_data: "faq" }, { text: "💬 Связь с менеджером", url: MANAGER_URL }]
];
const back = [[{ text: "← Главное меню", callback_data: "home" }]];
const MEDIA_BASE = "https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/";
const MEDIA = {
  home: { type: "photo", url: MEDIA_BASE + "reviews-workspace.jpg" },
  how: { type: "animation", url: MEDIA_BASE + "how.mp4" },
  how_terms: { type: "photo", url: MEDIA_BASE + "how-infographic.jpg" },
  services: { type: "animation", url: MEDIA_BASE + "services.mp4" },
  service_city: { type: "photo", url: MEDIA_BASE + "intimcity-original.jpg" },
  service_ashoo: { type: "photo", url: MEDIA_BASE + "ashoo-original.jpg" },
  reviews: { type: "photo", url: MEDIA_BASE + "reviews-workspace.jpg" },
  order: { type: "animation", url: MEDIA_BASE + "order.mp4" },
  faq: { type: "animation", url: MEDIA_BASE + "faq.mp4" }
};
const FALLBACK_PHOTOS = {
  service_city: MEDIA_BASE + "intimcity.png",
  service_ashoo: MEDIA_BASE + "ashoo.png",
  reviews: MEDIA_BASE + "reviews.png"
};
const PAGES = {
  home: "✦ <b>DAME CAMELIAS</b> ✦\n\n🌹 <b>ПРОДВИЖЕНИЕ ВАШИХ АНКЕТ С ПОМОЩЬЮ ОТЗЫВОВ И ОЦЕНОК</b>\n\n⭐ Подготовка текстов отзывов\n💎 Работа с оценками и репутацией\n✍️ Продающие описания анкет\n\n<b>INTIMCITY • ASHOO</b>\n\nВыберите интересующий раздел ниже. 🌹",
  how: "✨ <b>КАК МЫ РАБОТАЕМ</b>\n\n<i>Четыре простых шага</i>\n\n<b>01 ✦ Заявка</b>\nУказываете площадку, ссылку на анкету, нужные услуги и пожелания.\n\n<b>02 ✦ Подготовка</b>\nСогласовываем материалы, стоимость и график работы.\n\n<b>03 ✦ Оплата</b>\nВы оплачиваете заказ после согласования всех деталей.\n\n<b>04 ✦ Выполнение</b>\nРаботаем по утверждённому плану. Менеджер остаётся на связи.\n\n🌹 <b>Всё понятно заранее — без лишних этапов.</b>",
  how_terms: "📋 <b>УСЛОВИЯ СОТРУДНИЧЕСТВА</b>\n\n🌹 <b>Сначала согласование — потом оплата.</b>\n\n1️⃣ Заполняете заявку и указываете анкеты.\n\n2️⃣ Мы согласуем объём редакционных работ, материалы и календарь.\n\n3️⃣ Уточняем стоимость.\n\n4️⃣ После подтверждения приступаем к согласованным работам.\n\n💬 Готовые тексты обсуждаются до завершения заказа.\n\n🖋 Описание профиля Intimcity готовится как законченный материал; по представленным условиям после передачи изменения не предусмотрены.\n\n🛡 Для публикации любой обратной связи важно соблюдать правила площадки и не представлять заказной материал как независимое свидетельство посещения.\n\n💎 Детали вашего заказа уточнит менеджер.",
  how_deadlines: "⏳ <b>СРОКИ И ГРАФИК</b>\n\n🌹 <b>Intimcity</b>\n\n⭐ <b>Оценки</b> публикуются в день размещения.\n\n💬 <b>Отзывы</b> проходят стандартную модерацию сайта. Обычно это занимает от <b>1</b> до <b>10</b> дней.\n\n✍️ <b>Описание</b> анкеты готовится индивидуально для каждой девушки. Срок подготовки — до 2 дней после оплаты.\n\n✦ После согласования графика публикаций анкета должна оставаться активной в назначенные дни с<b> 10:00 до 17:00.</b>\n\n💗 <b>ASHOO</b>\n\nСроки редакционных услуг уточняются при согласовании заявки.\n\n📅 Финальный график обсуждается до оплаты. Сроки модерации определяет сама площадка.",
  services: "💎 <b>НАШИ УСЛУГИ</b> 💎\n\n💖 Работаем с двумя популярными площадками:\n\n🌹 <b>Intimcity</b>\n💗 <b>ASHOO</b>\n\n💬 Публикация отзывов под вашей анкетой.\n\n⭐ Проставление оценок для повышения привлекательности профиля.",
  service_city: "🌹 <b>INTIMCITY — ПРАЙС</b>\n\n📋 Подробные условия и сроки — в разделе «Вопросы и ответы».\n\n💌 <b>Готовы оформить заказ? Нажмите кнопку ниже.</b>",
  service_ashoo: "💗 <b>ASHOO — ПРАЙС</b>\n\n📋 Подробные условия и сроки — в разделе «Вопросы и ответы».\n\n💌 <b>Готовы оформить заказ? Нажмите кнопку ниже.</b>",
  reviews: "⭐ <b>ОТЗЫВЫ И ОЦЕНКИ</b>\n\n💬 <b>Отзывы — доверие к вам и уверенность клиента.</b>\n\nПодлинные отзывы помогают мужчине узнать вас лучше ещё до встречи: понять особенности общения, атмосферу и сервис. Это даёт больше информации для выбора и помогает клиенту чувствовать себя увереннее.\n\n🌟 <b>Оценки — информация и позиции в поиске.</b>\n\nОценки отражают репутацию анкеты на площадке и могут учитываться алгоритмами сайта. Более высокая оценка может способствовать повышению анкеты в поисковой выдаче, но конкретное место определяет сама площадка.\n\n💎 <b>Хотите ознакомиться с услугами?</b>\nВыберите каталог ниже.",
  review_text: "💬 <b>ОТЗЫВ ПОД АНКЕТОЙ</b>\n\nХороший отзыв отвечает на конкретные вопросы читателя:\n\n🌹 Как прошла встреча и общение?\n\n✨ Чем запомнился сервис?\n\n🤍 Какие детали важны будущим посетителям?\n\n💎 Что соответствует описанию анкеты?\n\n<b>Мы помогаем и опубликовать впечатления</b> грамотно, ярко и понятно.",
  review_profile: "📜 <b>ОПИСАНИЕ АНКЕТЫ</b>\n\nФотографии привлекают внимание. Описание помогает понять, чего ожидать.\n\n✨ Сильные стороны и характер.\n\n🌹 Атмосфера общения.\n\n💎 Услуги и особенности.\n\n🖋 Грамотный текст без штампов.\n\n<b>Intimcity — 2 000 ₽.</b>\n\n⏳ Срок подготовки по условиям компании — до 2 дней после оплаты.",
  faq: "❓ <b>ВОПРОСЫ И ОТВЕТЫ</b>\n\nМы открыто рассказываем о том, что входит в услуги DAME CAMELIAS, сколько это стоит и как проходит работа.",
  faq_safe: "🛡 <b>БЕЗОПАСНОСТЬ И КОНФИДЕНЦИАЛЬНОСТЬ</b>\n\n🔐 <b>Безопасность вашей анкеты — наш приоритет.</b>\n\n⚙️ <b>Наша система работы построена следующим образом!</b>\n\n🌹 Мы используем поэтапный подход к работе с анкетами, уделяя внимание стабильности процессов, конфиденциальности и равномерному планированию публикаций.\n\n📱 Наши рабочие аккаунты имеют индивидуальные номера телефонов, принадлежащие нашей компании и не находящиеся в общем пользовании.\n\n🌐 Для организации работы используются отдельные интернет-соединения, индивидуальные IP-адреса и аккаунты Telegram.\n\n📍 Работа с анкетами организуется с учётом географии Москвы и Московской области.\n\n🔍 Мы уделяем внимание состоянию рабочих аккаунтов и их технической готовности, а также регулярно проверяем используемые средства связи.\n\n📞 Также номера телефонов рабочих аккаунтов имеют историю в «пробивках».\n\n🤝 <b>Все этапы работы и индивидуальные условия обсуждаются заранее.</b>",
  faq_accounts: "👤 <b>АККАУНТЫ И РЕПУТАЦИЯ</b>\n\n⭐ <b>Что формирует доверие?</b>\n\n<b>Наши аккаунты:</b>\n\n🌱 Не однодневки, выглядят органично для всех участников сайта.\n📅 Имеют дату регистрации не менее 1,5 года назад.\n💬 Ведут активную жизнь на сайте: отвечают на вопросы мужчин, просматривают анкеты, добавляют их в отложенные и избранные.\n📝 Имеют множество оценок и отзывов под анкетами девушек.\n🌟 Обладают достойной репутацией на сайте.",
  faq_schedule: "⏳ <b>СРОКИ И ГРАФИК</b>\n\n📋 Сначала заявка, затем согласование объёма и графика, после этого оплата.\n\n🌹 <b>Intimcity</b>\n\n• Описание анкеты — до 2 дней после оплаты.\n\n• Указанный в условиях срок модерации отзывов — обычно 1–10 дней.\n\n• Согласованный интервал активности анкеты — 10:00–17:00 в назначенные дни.\n\n💗 <b>ASHOO</b>\n\nСроки уточняются по конкретному заказу.\n\n💬время модерации отзыва  не зависят от DAME CAMELIAS.",
  faq_writing: "✍️ <b>ПОДГОТОВКА ТЕКСТОВ</b>\n\n<b>Вы сами пишете отзывы?</b>\n\nДа, мы оказываем услуги подготовки и редактирования текстов. Для достоверного отзыва нам нужны факты и реальный опыт ваших клиентов.\n\n<b>Можно прислать свой текст?</b>\n\nКонечно. Дословно опубликуем ваш текст\n\n<b>Можно выбрать стиль?</b>\n\nДа: нежный, лаконичный, яркий, подробный — обсуждаем заранее.",
  faq_payment: "💳 <b>ОПЛАТА И УСЛОВИЯ</b>\n\n🌹 Перед оплатой согласуем объём работ, тексты и график.\n\n<b>Цены на услуги:</b>\n\n🌹 Intimcity — 500 ₽ за наш текст отзыва, 400 ₽ за ваш текст, 2 000 ₽ за составление описания к анкете.\n\n💗 ASHOO — 1 000 ₽ за наш текст, 800 ₽ за ваш.\n\n🖋 По заявленным условиям компании завершённое описание Intimcity после передачи не редактируется.\n\n💬 За индивидуальным расчётом — к менеджеру.",
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
async function sendPhotoFile(env, data, url) {
  const imageResponse = await fetch(url);
  if (!imageResponse.ok) throw new Error("Image fetch HTTP " + imageResponse.status);
  const imageData = await imageResponse.arrayBuffer();
  if (!imageData.byteLength || imageData.byteLength > 10 * 1024 * 1024)
    throw new Error("Image missing or too large");
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) {
    form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  form.append("photo", new Blob([imageData], {type: "image/jpeg"}), "dame-camelias.jpg");
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendPhoto", {
    method: "POST", body: form
  });
  if (!response.ok) throw new Error("Telegram upload HTTP " + response.status);
  const result = await response.json();
  if (!result.ok) throw new Error("Telegram upload: " + result.description);
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
    buttons.push([{text:"📝 Открыть анкету",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/order"}}]);
    buttons.push([{text:"💬 Написать менеджеру",url:MANAGER_URL}],...back);
    return {inline_keyboard:buttons};
  }
  return {inline_keyboard:back};
}
// Send a new page then remove the previous one: works for both photo and text messages.
async function sendPage(env, chatId, key) {
  const payload = {
    chat_id: chatId,
    parse_mode: "HTML",
    reply_markup: keyboard(key, env)
  };
  const media = MEDIA[key];
  if (media && PAGES[key].length <= 1024) {
    try {
      const method = media.type === "animation" ? "sendAnimation" : "sendPhoto";
      const data = { ...payload, caption: PAGES[key] };
      data[media.type] = media.url;
      
      if (key === "home") {
        try {
          const { photo, ...fields } = data;
          return await sendPhotoFile(env, fields, photo);
        } catch (uploadError) {
          console.error("Home photo direct upload failed:", uploadError);
        }
      }
      return await telegram(env, method, data);
    } catch (err) {
      console.error("Primary media unavailable:", key, err);
    }
  }
  const fallback = FALLBACK_PHOTOS[key];
  if (fallback && PAGES[key].length <= 1024) {
    try {
      return await telegram(env, "sendPhoto", {
        ...payload, photo: fallback, caption: PAGES[key]
      });
    } catch (err) {
      console.error("Fallback image unavailable:", key, err);
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
const ORDER_MANAGER_CHAT_ID = 5866034656;
const encoder = new TextEncoder();
const toHex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
const plain = value => String(value ?? "").slice(0, 2000).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
async function validWebApp(initData, token) {
  if (!initData || initData.length > 12000) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const date = Number(params.get("auth_date"));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(date) || Math.abs(Date.now()/1000 - date) > 600) return false;
  params.delete("hash");
  const data = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => k + "=" + v).join("\n");
  const secret = await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", encoder.encode("WebAppData"), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]), encoder.encode(token));
  const key = await crypto.subtle.importKey("raw", secret, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(data))) === hash.toLowerCase();
}
async function receiveOrder(request, env) {
  if (!env.BOT_TOKEN) return new Response("Not configured", {status:503});
  if (Number(request.headers.get("content-length") || 0) > 50000) return new Response("Too large", {status:413});
  let input;
  try { input = await request.json(); } catch { return new Response("Invalid JSON", {status:400}); }
  if (!await validWebApp(input.initData, env.BOT_TOKEN)) return new Response("Telegram authorization required", {status:403});
  const order = input.order;
  if (!order || !Array.isArray(order.profiles) || order.profiles.length < 1 || order.profiles.length > 10 || !plain(order.name) || !plain(order.telegram)) return new Response("Invalid order", {status:400});
  const lines = ["💎 <b>DAME CAMELIAS — НОВАЯ ЗАЯВКА</b> 💎", "", "👤 <b>Клиент:</b> " + plain(order.name), "📲 <b>Telegram:</b> " + plain(order.telegram), "📋 <b>Статус:</b> " + plain(order.role), ""];
  const escape = s => plain(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const message = lines.map((line, index) => index === 0 ? line : escape(line)).join("\n");
  const blocks = order.profiles.map((p, i) => {
    if (!["intimcity","ashoo"].includes(p.platform) || !p.url || !["create","edit"].includes(p.kind)) throw Error("Invalid profile");
    const dates = Object.entries(p.schedule || {}).filter(([date,mode]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && ["review","rating","both"].includes(mode)).sort(([a],[b]) => a.localeCompare(b)).slice(0,100).map(([date,mode]) => date+" — "+({review:"отзыв",rating:"оценка",both:"отзыв + оценка"}[mode]));
    return ["🌹 <b>АНКЕТА №"+(i+1)+" — "+(p.platform === "ashoo" ? "ASHOO" : "Intimcity")+"</b>", "🔗 "+escape(p.url), "💬 Отзывов: "+escape(p.count)+" ("+(p.kind === "create" ? "подготовка" : "текст клиента")+")", ...(p.platform === "intimcity" ? ["⭐ Оценок: "+escape(p.ratings), "✍️ Описание: "+(p.description?"да":"нет")] : []), "📅 Даты: "+escape(dates.join("; ") || "не выбраны"), "💌 Пожелания: "+escape(p.services || "—"), "📝 Тексты: "+escape((p.reviewTexts || []).join(" | ") || "—"), "📋 Ответы: "+escape(p.answers || "—")].join("\n");
  });
  const tail = "💬 <b>Общие пожелания:</b> "+escape(order.notes || "—")+"\n💰 <b>Предварительная сумма:</b> "+escape(order.total)+" ₽";
  const parts = [message,...blocks,tail];
  const batches=[];let current="";
  for(const part of parts){if(part.length>3400)return new Response("Order field too long", {status:400});if(current && current.length+part.length+2>3600){batches.push(current);current="";}current+=(current?"\n\n":"")+part;}
  if(current)batches.push(current);
  try {for(const text of batches) await telegram(env,"sendMessage",{chat_id:ORDER_MANAGER_CHAT_ID,text,parse_mode:"HTML",disable_web_page_preview:true});}
  catch(e){console.error("Order delivery failed",e);return new Response("Delivery failed", {status:502});}
  return Response.json({ok:true});
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("DAME CAMELIAS bot is ready");
    if (request.method === "GET" && url.pathname === "/order") {
      const result = await fetch("https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/order/index.html");
      if (!result.ok) return new Response("Form unavailable", { status: 502 });
      return new Response(result.body, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
    }
    if (url.pathname === "/api/order" && request.method === "OPTIONS") return new Response(null, {status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
    if (url.pathname === "/api/order" && request.method === "POST") { const result = await receiveOrder(request, env); const headers = new Headers(result.headers); headers.set("Access-Control-Allow-Origin","*"); return new Response(result.body,{status:result.status,headers}); }
    if (request.method !== "POST" || url.pathname !== "/webhook") return new Response("Not found", { status: 404 });
    if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) return new Response("Not configured", { status: 503 });
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
    let update;
    try { update = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
    ctx.waitUntil(handle(update, env).catch(err => console.error("Update failed", err)));
    return new Response("ok");
  }
};
