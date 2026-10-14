import { reminderCall } from "./reminders.js";
import { handleClientAdmin } from "./client_admin.js";
import { handleTrialCabinet } from "./trial_cabinet.js";
import { handleOwnerAnketa, handleAnketaLookupResult, ownerDryfillPayload, ownerReviewPayload, ownerReviewStage, ownerRatingFormApi, serveProfileThumbnail } from "./owner_anketa.js";
export { OrderReminder } from "./reminders.js";
const MANAGER_URL = "https://t.me/DameCamelias";
const MAIN = [
  [{ text: "✨ Как работаем", callback_data: "how" }, { text: "💖 Зачем это?", callback_data: "reviews" }],
  [{ text: "❓ Вопросы", callback_data: "faq" }, { text: "💎 Цены", callback_data: "services" }],
  [{ text: "📝 Заказ", callback_data: "order" }, { text: "💬 Менеджер", url: MANAGER_URL }]
]
const back = [[{ text: "← Главное меню", callback_data: "home" }]];
const MEDIA_BASE = "https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/assets/";
const VISUAL_BASE = MEDIA_BASE + "visual-v2/";
const MEDIA = {
  welcome: { type: "photo", url: VISUAL_BASE + "01_welcome_square.jpg" },
  home: { type: "photo", url: VISUAL_BASE + "02_main_menu_square.jpg" },
  how: { type: "photo", url: VISUAL_BASE + "03_how_we_work_square.jpg" },
  reviews: { type: "photo", url: VISUAL_BASE + "04_why_this_square.jpg" },
  faq: { type: "photo", url: VISUAL_BASE + "05_faq_square.jpg" },
  services: { type: "photo", url: VISUAL_BASE + "06_prices_square.jpg" },
  service_city: { type: "photo", url: MEDIA_BASE + "intimcity-original.jpg" },
  service_ashoo: { type: "photo", url: MEDIA_BASE + "ashoo-original.jpg" },
  order: { type: "photo", url: VISUAL_BASE + "09_order_square.jpg" },
  faq_safe: { type: "photo", url: VISUAL_BASE + "25_faq_security_square.jpg" },
  faq_accounts: { type: "photo", url: VISUAL_BASE + "26_faq_accounts_square.jpg" },
  faq_schedule: { type: "photo", url: VISUAL_BASE + "27_faq_schedule_square.jpg" },
  faq_writing: { type: "photo", url: VISUAL_BASE + "28_faq_writing_square.jpg" },
  faq_payment: { type: "photo", url: VISUAL_BASE + "29_faq_payment_square.jpg" },
  faq_about: { type: "photo", url: VISUAL_BASE + "30_faq_about_square.jpg" }
};
const LEGACY_MEDIA = {
  welcome: { type: "photo", url: MEDIA_BASE + "reviews-workspace.jpg" },
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
  welcome: "✦ <b>DAME CAMELIAS</b> ✦\n🌹 <b>ДОБРО ПОЖАЛОВАТЬ!</b> 🌹\n\n💎 Мы помогаем вашим анкетам выделяться, укреплять доверие клиентов и привлекать новые обращения.\n\n⭐ Написание и публикация отзывов\n💎 Работа с оценками и рейтингом\n✍️ Повышение привлекательности анкет\n\n🌹 <b>DAME CAMELIAS — искусство безупречной репутации.</b>",
  home: "✨ <b>Как работаем</b> — всё о нашем подходе.\n💖 <b>Зачем это?</b> — сила отзывов и оценок.\n❓ <b>Вопросы</b> — ответы без лишних слов.\n💎 <b>Цены</b> — услуги и стоимость.\n📝 <b>Заказ</b> — оформить легко и удобно.\n💬 <b>Менеджер</b> — поможем лично.",
  how: "✨ <b>КАК МЫ РАБОТАЕМ</b>\n\n<i>Четыре простых шага</i>\n\n<b>01 ✦ Заявка</b>\nУказываете площадку, ссылку на анкету, нужные услуги и пожелания.\n\n<b>02 ✦ Подготовка</b>\nСогласовываем материалы, стоимость и график работы.\n\n<b>03 ✦ Оплата</b>\nВы оплачиваете заказ после согласования всех деталей.\n\n<b>04 ✦ Выполнение</b>\nРаботаем по утверждённому плану. Менеджер остаётся на связи.\n\n🌹 <b>Всё понятно заранее — без лишних этапов.</b>",
  how_terms: "📋 <b>УСЛОВИЯ СОТРУДНИЧЕСТВА</b>\n\n🌹 <b>Сначала согласование — потом оплата.</b>\n\n1️⃣ Заполняете заявку и указываете анкеты.\n\n2️⃣ Мы согласуем объём редакционных работ, материалы и календарь.\n\n3️⃣ Уточняем стоимость.\n\n4️⃣ После подтверждения приступаем к согласованным работам.\n\n💬 Готовые тексты обсуждаются до завершения заказа.\n\n🖋 Описание профиля Intimcity готовится как законченный материал; по представленным условиям после передачи изменения не предусмотрены.\n\n🛡 Для публикации любой обратной связи важно соблюдать правила площадки и не представлять заказной материал как независимое свидетельство посещения.\n\n💎 Детали вашего заказа уточнит менеджер.",
  how_deadlines: "⏳ <b>СРОКИ И ГРАФИК</b>\n\n🌹 <b>Intimcity</b>\n\n⭐ <b>Оценки</b> публикуются в день размещения.\n\n💬 <b>Отзывы</b> проходят стандартную модерацию сайта. Обычно это занимает от <b>1</b> до <b>10</b> дней.\n\n✍️ <b>Описание</b> анкеты готовится индивидуально для каждой девушки. Срок подготовки — до 2 дней после оплаты.\n\n✦ После согласования графика публикаций анкета должна оставаться активной в назначенные дни с<b> 10:00 до 17:00.</b>\n\n💗 <b>ASHOO</b>\n\nСроки редакционных услуг уточняются при согласовании заявки.\n\n📅 Финальный график обсуждается до оплаты. Сроки модерации определяет сама площадка.",
  services: "💎 <b>НАШИ УСЛУГИ</b> 💎\n\n💖 Работаем с двумя популярными площадками:\n\n🌹 <b>Intimcity</b>\n💗 <b>ASHOO</b>\n\n💬 Публикация отзывов под вашей анкетой.\n\n⭐ Проставление оценок для повышения привлекательности профиля.",
  service_city: "🌹 <b>Intimcity — ПРАЙС</b>\n\n✨ <b>Минимальный заказ — от 8 штук в сумме.</b>\n\n<b>⚡️Возможно распределить на все ваши анкеты.</b>\n\n📋 <b>Все подробности, условия и сроки</b> — в разделе «Вопросы и ответы».",
  service_ashoo: "💗 <b>ASHOO — ПРАЙС</b>\n\n✨ <b>Минимальный заказ — от 4 штук.</b>\n\n<b>🚨Не более 2х отзывов в неделю.</b>\n\n📋 <b>Все подробности, условия и сроки</b> — в разделе «Вопросы и ответы».",
  reviews: "⭐ <b>ОТЗЫВЫ И ОЦЕНКИ — КЛЮЧ К ЗАКАЗАМ 💎</b>\n\n💬 <b>ОТЗЫВЫ — ДОВЕРИЕ КЛИЕНТОВ! ❤️</b>\n\n🔥 Мужчине важно знать, что <b>всё реально, без обмана и проверено другими мужчинами!</b>\n\n💋 Даже красивая анкета без отзывов вызывает сомнения. А хорошие отзывы подтверждают качество сервиса и помогают выбрать именно вас!\n\n🌟 <b>ОЦЕНКИ — РЕЙТИНГ И ПОЗИЦИЯ В ПОИСКЕ! 🚀</b>\n\n📊 По оценкам мужчина видит <b>ваши сильные и слабые стороны</b>, преимущества и понимает, чего ожидать от встречи.\n\n📈 Чем больше высоких оценок, тем выше шансы подняться в поиске и привлечь новых клиентов!\n\n💎 <b>Без отзывов — меньше доверия, без оценок — меньше внимания!</b>\n\n🔥 <b>Больше доверия + выше рейтинг = больше клиентов! ❤️</b>",
  review_text: "💬 <b>ОТЗЫВ ПОД АНКЕТОЙ</b>\n\nХороший отзыв отвечает на конкретные вопросы читателя:\n\n🌹 Как прошла встреча и общение?\n\n✨ Чем запомнился сервис?\n\n🤍 Какие детали важны будущим посетителям?\n\n💎 Что соответствует описанию анкеты?\n\n<b>Мы помогаем и опубликовать впечатления</b> грамотно, ярко и понятно.",
  review_profile: "📜 <b>ОПИСАНИЕ АНКЕТЫ</b>\n\nФотографии привлекают внимание. Описание помогает понять, чего ожидать.\n\n✨ Сильные стороны и характер.\n\n🌹 Атмосфера общения.\n\n💎 Услуги и особенности.\n\n🖋 Грамотный текст без штампов.\n\n<b>Intimcity — 2 000 ₽.</b>\n\n⏳ Срок подготовки по условиям компании — до 2 дней после оплаты.",
  faq: "❓ <b>ВОПРОСЫ И ОТВЕТЫ</b>\n\nМы открыто рассказываем о том, что входит в услуги DAME CAMELIAS, сколько это стоит и как проходит работа.",
  faq_safe: "🛡 <b>БЕЗОПАСНОСТЬ И КОНФИДЕНЦИАЛЬНОСТЬ</b>\n\n🔐 <b>Безопасность вашей анкеты — наш приоритет.</b>\n\n⚙️ <b>Наша система работы построена следующим образом!</b>\n\n🌹 Мы используем поэтапный подход к работе с анкетами, уделяя внимание стабильности процессов, конфиденциальности и равномерному планированию публикаций.\n\n📱 Наши рабочие аккаунты имеют индивидуальные номера телефонов, принадлежащие нашей компании и не находящиеся в общем пользовании.\n\n🌐 Для организации работы используются отдельные интернет-соединения, индивидуальные IP-адреса и аккаунты Telegram.\n\n📍 Работа с анкетами организуется с учётом географии Москвы и Московской области.\n\n🔍 Мы уделяем внимание состоянию рабочих аккаунтов и их технической готовности, а также регулярно проверяем используемые средства связи.\n\n📞 Также номера телефонов рабочих аккаунтов имеют историю в «пробивках».\n\n🤝 <b>Все этапы работы и индивидуальные условия обсуждаются заранее.</b>",
  faq_accounts: "👤 <b>АККАУНТЫ И РЕПУТАЦИЯ</b>\n\n⭐ <b>Что формирует доверие?</b>\n\n<b>Наши аккаунты:</b>\n\n🌱 Не однодневки, выглядят органично для всех участников сайта.\n📅 Имеют дату регистрации не менее 1,5 года назад.\n💬 Ведут активную жизнь на сайте: отвечают на вопросы мужчин, просматривают анкеты, добавляют их в отложенные и избранные.\n📝 Имеют множество оценок и отзывов под анкетами девушек.\n🌟 Обладают достойной репутацией на сайте.",
  faq_schedule: "⏳ <b>СРОКИ И ГРАФИК</b>\n\n📋 Сначала вы оставляете заявку. Мы согласовываем сроки, стоимость и принимаем оплату.\n\n🌹 <b>INTIMCITY</b>\n\n✍️ <b>Описание анкеты</b> — готовим в течение 2 дней после оплаты.\n\n💬 <b>Отзывы</b> — после написания отправляются на проверку сайта. Обычно публикация занимает от 1 до 10 дней.\n\n🕙 <b>Время работы</b> — в назначенные дни ваша анкета должна быть активна с 10:00 до 17:00, чтобы мы могли выполнить заказ.\n\n💗 <b>ASHOO</b>\n\n📅 Сроки выполнения заказа обсуждаем индивидуально.\n\n⚠️ <b>Важно:</b> мы не можем ускорить проверку отзывов на сайте. Время публикации зависит от площадки.",
  faq_writing: "✍️ <b>ПОДГОТОВКА ТЕКСТОВ</b>\n\n<b>Вы сами пишете отзывы?</b>\n\nДа, мы оказываем услуги подготовки и редактирования текстов. Для достоверного отзыва нам нужны факты и реальный опыт ваших клиентов.\n\n<b>Можно прислать свой текст?</b>\n\nКонечно. Дословно опубликуем ваш текст\n\n<b>Можно выбрать стиль?</b>\n\nДа: нежный, лаконичный, яркий, подробный — обсуждаем заранее.",
  faq_payment: "💳 <b>ОПЛАТА И УСЛОВИЯ</b>\n\n🌹 Перед оплатой согласуем объём работ, тексты и график.\n\n<b>Цены на услуги:</b>\n\n🌹 Intimcity — 500 ₽ за наш текст отзыва, 400 ₽ за ваш текст, 2 000 ₽ за составление описания к анкете.\n\n💗 ASHOO — 1 000 ₽ за наш текст, 800 ₽ за ваш.\n\n🖋 По заявленным условиям компании завершённое описание Intimcity после передачи не редактируется.\n\n💬 За индивидуальным расчётом — к менеджеру.",
  faq_about: "🌹 <b>О КОМПАНИИ DAME CAMELIAS</b>\n\n💎 Мы специализируемся на услугах продвижения и репутационного оформления анкет на Intimcity и ASHOO.\n\n✨ Команда работает более трёх лет.\n\n⭐ Наш фокус — отзывы, оценки, тексты и описание анкет.\n\n🤍 Мы не предлагаем и не публикуем  негативные отзывы о конкурентках.\n\n📋 Каждая заявка обсуждается индивидуально: состав работ, цена, сроки и материалы согласуются заранее.",
  order: "🌹 <b>ОФОРМЛЕНИЕ ЗАЯВКИ</b> 💎\n\n💌 Выберите удобный способ — мы позаботимся об остальном!\n\n📝 <b>Через анкету</b> — все детали, календарь и расчёт стоимости.\n\n🤖 <b>Через бота</b> — быстрое оформление шаг за шагом в Telegram.\n\n💬 <b>Помощь менеджера</b> — личная консультация и ответы на вопросы.\n\n🌹 <b>Ваш комфорт — наш приоритет!</b>",
};
// Protect outgoing content for everyone except the owner's private Telegram chat.
const CONTENT_OWNER_ID = "5866034656";
function protectOutgoing(method, data) {
  if (!/^(sendMessage|sendPhoto|sendAnimation|sendVideo|sendDocument|sendAudio|sendVoice|sendVideoNote|sendMediaGroup|copyMessage)$/.test(method)) return data;
  const chatId = String(data?.chat_id ?? "");
  return {...data, protect_content: chatId !== CONTENT_OWNER_ID};
}
async function telegram(env, method, data) {
  data = protectOutgoing(method, data);
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error("Telegram API HTTP " + response.status);
  const result = await response.json();
  if (!result.ok) throw new Error("Telegram API: " + result.description);
  return result.result;
}
async function sendPhotoFile(env, data, url) {
  data = protectOutgoing("sendPhoto", data);
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
  if (key === "welcome") return {inline_keyboard:[[{text:"✨ НАЧАТЬ",callback_data:"home"}]]};
  if (key === "home") { const id=String(env.__ownerMenuChatId ?? ""); return {inline_keyboard: id==="5866034656" ? [...MAIN,[{text:"🔐 Личный кабинет",callback_data:"owner_anketa:open"}],[{text:"👥 Управление клиентами",callback_data:"client_admin:open"}]] : id==="5627932577" ? [...MAIN,[{text:"🌹 Мои анкеты",callback_data:"trial_cabinet:open"}]] : MAIN}; }
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
    [{text:"🛡 Безопасность вашей анкеты",callback_data:"faq_safe"}],
    [{text:"👤 Как выглядят аккаунты?",callback_data:"faq_accounts"}],
    [{text:"⏳ Сроки публикации",callback_data:"faq_schedule"}],
    [{text:"✍️ Формирование отзывов",callback_data:"faq_writing"}],
    [{text:"💳 Условия оплаты",callback_data:"faq_payment"}],
    [{text:"🌹 Кто мы такие?",callback_data:"faq_about"}],
    [{text:"💬 Задать вопрос",url:MANAGER_URL}], ...back
  ]};
  if (key.startsWith("faq_")) return {inline_keyboard:[
    [{text:"← Все вопросы",callback_data:"faq"}],
    [{text:"💬 Помощь менеджера",url:MANAGER_URL}], ...back
  ]};
  if (key === "order") {
    const buttons=[];
    buttons.push([{text:"📝 Заявка через анкету",web_app:{url:"https://dame-camelias.gptjjjgpt.workers.dev/order"}}]);
    buttons.push([{text:"🤖 Заявка через бота",callback_data:"quick_order"}]);
    buttons.push([{text:"💬 Помощь менеджера",url:MANAGER_URL}],...back);
    return {inline_keyboard:buttons};
  }
  return {inline_keyboard:back};
}
// Send a new page then remove the previous one: works for both photo and text messages.
async function sendPage(env, chatId, key) {
  const payload = {
    chat_id: chatId,
    parse_mode: "HTML",
    reply_markup: keyboard(key, {...env,__ownerMenuChatId:chatId})
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
  const legacy = LEGACY_MEDIA[key];
  if (legacy && PAGES[key] && PAGES[key].length <= 1024) {
    try {
      const method = legacy.type === "animation" ? "sendAnimation" : "sendPhoto";
      const legacyData = { ...payload, caption: PAGES[key] };
      legacyData[legacy.type] = legacy.url;
      return await telegram(env, method, legacyData);
    } catch (err) {
      console.error("Legacy media fallback unavailable:", key, err);
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

const QUICK_STEPS=["profiles_count","url","platform","kind","count","review_text","ratings","description","dates","role","name","notes","confirm"];
const QUICK_QUESTIONS={
 platform:"🌹 На какой площадке размещена анкета <b>{id}</b>? Выберите подходящий вариант ниже.",
 profiles_count:"💎 Для начала подскажите, сколько анкет вы хотите включить в заказ? Укажите число от 1 до 5. Каждую анкету мы внимательно оформим отдельно.",
 url:"🔗 Отлично! Давайте начнём с анкеты №{n}. Пришлите, пожалуйста, её ID или ссылку — так мы сможем уточнить все детали заказа.",
 kind:"✍️ Кто подготовит тексты отзывов? Мы составим их для вас или вы пришлёте свои?",
 count:"💬 Сколько отзывов вы хотите заказать для этой анкеты?",
 review_text:"📝 Пришлите текст отзыва №{n} из {total}. Мы бережно добавим его к вашей заявке.",
 ratings:"⭐ С отзывами определились! Сколько оценок добавить для этой анкеты?",
 description:"✍️ Нужно составить красивое и продающее описание анкеты?",
 dates:"📅 Осталось согласовать даты для этой анкеты. Например:\n15.10 — отзыв\n17.10 — оценка и отзыв\n18.10 — отзыв\n\nЕсли нужна помощь, нажмите «📅 Помогите подобрать».",
 role:"🌹 Все анкеты заполнены! Уточните, пожалуйста, ваш статус.",
 name:"💌 Подскажите, как к вам обращаться?",
 notes:"✨ Есть ли особые пожелания? Напишите их или ответьте «Нет».",
 confirm:"💎 Всё готово! Проверьте состав заказа и предварительную стоимость. Если всё верно, отправьте заявку менеджеру."
};
const quickEsc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const quickClean=v=>String(v??"").trim();
const quickProfile=d=>d.current || {};
const quickId=url=>{const raw=String(url||"").trim().replace(/\/+$/,"");return raw.includes("/")?raw.split("/").pop().split(/[?#]/)[0]||raw:raw;};
const quickPrice=p=>(Number(p.count)||0)*(p.platform==="ASHOO"?(p.kind==="Свой текст"?800:1000):(p.kind==="Свой текст"?400:500))+(p.platform==="Intimcity"?(Number(p.ratings)||0)*500+(p.description==="да"?2000:0):0);
const quickPositions=p=>(Number(p.count)||0)+(p.platform==="Intimcity"?(Number(p.ratings)||0)+(p.description==="да"?1:0):0);
const quickList=d=>[...(d.profiles||[]),...(d.current?.url?[d.current]:[])];
const quickTotals=d=>({sum:quickList(d).reduce((x,p)=>x+quickPrice(p),0),positions:quickList(d).reduce((x,p)=>x+quickPositions(p),0)});
function quickUrl(state){return "https://dame-camelias.gptjjjgpt.workers.dev/order?draft="+encodeURIComponent(JSON.stringify(state));}
function quickState(message){
 const entity=(message?.entities||[]).find(e=>e.type==="text_link"&&e.url?.includes("/order?draft="));
 if(!entity)return null;
 try{
 const u=new URL(entity.url);
 if(u.origin!=="https://dame-camelias.gptjjjgpt.workers.dev"||u.pathname!=="/order")return null;
 const st=JSON.parse(u.searchParams.get("draft"));
 if(!st||!Number.isInteger(st.i)||st.i<0||st.i>=QUICK_STEPS.length||!st.d||typeof st.d!=="object")return null;
 return st;
 }catch{return null;}
}
const QUICK_VISUAL_BASE = MEDIA_BASE + "order-bot-visuals/";
const QUICK_VISUALS = {
 profiles_count:"03_profiles_count.png",url:"04_profile_link.png",platform:"05_platform.png",
 kind:"06_text_author.png",count:"07_reviews_count.png",review_text:"06_text_author.png",
 ratings:"08_ratings.png",description:"09_description.png",dates:"10_schedule.png",
 role:"12_role.png",name:"13_contact.png",notes:"14_notes.png",confirm:"15_confirmation.png"
};
async function quickVisual(env,chatId,stage,profileIndex){
 const filename=stage==="profiles_count"?"01_order_bot_entry.png":stage==="url"&&profileIndex>1?"11_next_profile.png":QUICK_VISUALS[stage];
 if(!filename)return;
 try{
  await telegram(env,"sendPhoto",{chat_id:chatId,photo:QUICK_VISUAL_BASE+filename});
 }catch(err){console.error("Quick order image unavailable:",stage,err);}
}
async function quickPrompt(env,chatId,state,prefix=""){
 const d=state.d,stage=QUICK_STEPS[state.i],p=quickProfile(d);
 const index=(d.profiles||[]).length+1;
 const cost=stage==="count"?(p.platform==="ASHOO"?(p.kind==="Свой текст"?800:1000):(p.kind==="Свой текст"?400:500)):500;
 const question=stage==="review_text"?QUICK_QUESTIONS[stage].replace("{n}",String((p.reviewTexts||[]).length+1)).replace("{total}",String(p.count)):QUICK_QUESTIONS[stage].replace("{n}",String(index)).replace("{id}",quickEsc(quickId(p.url)));
 const priceHint=stage==="count"?"\n💰 Цена одного отзыва: "+cost+" ₽.":stage==="ratings"?"\n💰 Одна оценка — 500 ₽.":stage==="description"?"\n💰 Описание — 2 000 ₽.":"";
 const intro=state.i===0?"🌹 <b>ВАЖНО:</b> минимальный заказ — <b>8 позиций</b> (отдельных услуг или в сумме по всем анкетам).\n\n💎 <b>ДОБРО ПОЖАЛОВАТЬ В DAME CAMELIAS!</b>\n\n💖 Мы позаботились о том, чтобы оформление было простым и удобным. Просто отвечайте на вопросы, а мы бережно поможем вам оформить заказ.\n\n":"";
 const profileIntro=["kind","count","review_text","ratings","description","dates"].includes(stage)?"🌹 <b>"+quickEsc(p.platform)+" · Анкета "+quickEsc(quickId(p.url))+"</b>\n":"";
 const all=quickList(d),total=quickTotals(d);
 const recap=stage==="confirm"?[
   "🌹 <b>ПРОВЕРЬТЕ ЗАКАЗ</b>",
   ...all.flatMap((x,i)=>["","<b>Анкета №"+(i+1)+" — "+quickEsc(x.platform)+"</b>","🔗 "+quickEsc(x.url),"💬 Отзывов: "+quickEsc(x.count)+" ("+quickEsc(x.kind)+")",...(x.platform==="Intimcity"?["⭐ Оценок: "+quickEsc(x.ratings),"✍️ Описание: "+quickEsc(x.description)]:[]),"📅 Даты: "+quickEsc(x.dates),"💰 Сумма анкеты: "+quickPrice(x).toLocaleString("ru-RU")+" ₽"]),
   "","👤 "+quickEsc(d.name)+" — "+quickEsc(d.role),"💌 "+quickEsc(d.notes),
   "📦 <b>Всего позиций: "+total.positions+"</b>","💰 <b>Итого: "+total.sum.toLocaleString("ru-RU")+" ₽</b>",""
 ].join("\n")+"\n":"";
 const transition=stage==="url" && index>1?"✅ <b>Готово! Данные первой анкеты сохранены.</b>\n\n🌹 Перейдём к анкете №"+index+". Сейчас также всё аккуратно оформим — начнём с её ссылки или ID.\n\n":"";
 const content=(prefix?quickEsc(prefix)+"\n\n":"")+intro+transition+recap+profileIntro+question+priceHint+
 '\n\n<a href="'+quickUrl(state).replace(/&/g,"&amp;")+'">&#8288;</a>';
 const options={
 platform:[["🌹 Intimcity","Intimcity"],["💗 ASHOO","ASHOO"]],
 kind:[["✍️ Мы составляем","Наш текст"],["📝 Вы присылаете свой","Свой текст"]],
 description:[["✅ Да","Да"],["❌ Нет","Нет"]],
 role:[["🌹 Индивидуалка","Индивидуалка"],["👩‍💼 Менеджер","Менеджер"]],
 dates:[["📅 Помогите подобрать","Помогите подобрать"]],
 confirm:[["✅ Отправить заказ","ОТПРАВИТЬ"]]
 };
 const buttons=[...(options[stage]||[]).map(([label,value])=>[{text:label,callback_data:"quick:"+value}]),[{text:"❌ Отмена",callback_data:"quick:ОТМЕНА"}]];
 const markup=options[stage]?{inline_keyboard:buttons}:{force_reply:true,input_field_placeholder:stage==="profiles_count"?"Например: 2":"Напишите ваш ответ",selective:false};
 if (!prefix && !(stage==="review_text" && (p.reviewTexts||[]).length>0)) await quickVisual(env,chatId,stage,index);
 const result=await telegram(env,"sendMessage",{chat_id:chatId,text:content,parse_mode:"HTML",disable_web_page_preview:true,reply_markup:markup});
 return result?.result?.message_id;
}
function quickValidate(stage,answer){
 const v=answer.trim().slice(0,1500);
 if(!v)return null;
 if(stage==="platform")return /^(intimcity|интимсити)$/i.test(v)?"Intimcity":/^(ashoo|ашу)$/i.test(v)?"ASHOO":null;
 if(stage==="profiles_count")return /^[1-5]$/.test(v)?Number(v):null;
 if(stage==="url")return v.length>=4?v:null;
 if(stage==="kind")return /^(наш текст|мы составляем)$/i.test(v)?"Наш текст":/^(свой текст|вы присылаете свой)$/i.test(v)?"Свой текст":null;
 if(stage==="count"||stage==="ratings")return /^\d{1,2}$/.test(v)?Number(v):null;
 if(stage==="description")return /^(да|нет)$/i.test(v)?v.toLowerCase():null;
 if(stage==="role")return /^(индивидуалка|менеджер)$/i.test(v)?v:null;
 if(stage==="review_text")return v.length>=5&&!/^(нет|пропустить)$/i.test(v)?v:null;
 if(stage==="confirm")return /^отправить$/i.test(v)?"send":null;
 return v;
}
async function quickReply(env,update){
 const msg=update.message,state=quickState(msg.reply_to_message);
 if(!state)return false;
 const d=state.d,stage=QUICK_STEPS[state.i],value=quickValidate(stage,msg.text||"");
 if(value===null){await quickPrompt(env,msg.chat.id,state,"⚠️ Проверьте ответ и попробуйте снова.");return true;}
 const ids=[...(d.cleanup||[]),msg.reply_to_message?.message_id,msg.message_id].filter(Number.isInteger);
 d.cleanup=ids.slice(-85);
 if(stage==="confirm"){
   const all=quickList(d),totals=quickTotals(d);
   if(totals.positions<8){await quickPrompt(env,msg.chat.id,state,"⚠️ Минимум 8 позиций. Сейчас "+totals.positions+". Отправка невозможна, начните заказ заново с большим количеством.");return true;}
   const date=new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",dateStyle:"short",timeStyle:"short"}).format(new Date());
   const user=msg.from?.username;
   const contact=user?'<a href="https://t.me/'+user+'">@'+user+'</a>':'<a href="tg://user?id='+msg.from.id+'">Написать клиенту</a>';
   const parts=["💎 <b>DAME CAMELIAS — НОВАЯ ЗАЯВКА</b> 💎","📅 <b>Дата и время:</b> "+date+" (МСК)","💬 <b>Способ:</b> Быстрый заказ","👤 <b>Клиент:</b> "+quickEsc(d.name),"📲 <b>Telegram:</b> "+contact,"📋 <b>Статус:</b> "+quickEsc(d.role),...all.map((p,i)=>["🌹 <b>АНКЕТА №"+(i+1)+" — "+p.platform+"</b>","🔗 "+quickEsc(p.url),"💬 Отзывов: "+quickEsc(p.count)+" ("+quickEsc(p.kind)+")",...(p.platform==="Intimcity"?["⭐ Оценок: "+quickEsc(p.ratings),"✍️ Описание: "+quickEsc(p.description)]:[]),"📅 Даты:\n"+quickEsc(p.dates),...(p.kind==="Свой текст"?["📝 Тексты:\n"+(p.reviewTexts||[]).map((t,j)=>(j+1)+". "+quickEsc(t)).join("\n")]:[]),"💰 Сумма анкеты: "+quickPrice(p).toLocaleString("ru-RU")+" ₽"].join("\n")),"💌 <b>Пожелания:</b> "+quickEsc(d.notes),"📦 <b>Позиций:</b> "+totals.positions,"💰 <b>Итого: "+totals.sum.toLocaleString("ru-RU")+" ₽</b>"];
   for(const part of parts){
     if(part.length>3500){await telegram(env,"sendMessage",{chat_id:msg.chat.id,text:"⚠️ Слишком длинные тексты. Уменьшите объём и попробуйте снова."});return true;}
   }
   const batches=[];let joined="";
   for(const part of parts){if(joined.length+part.length+2>3500){batches.push(joined);joined="";}joined+=(joined?"\n\n":"")+part;}
   if(joined)batches.push(joined);
   for(const text of batches){await telegram(env,"sendMessage",{chat_id:ORDER_MANAGER_CHAT_ID,text,parse_mode:"HTML",disable_web_page_preview:true});}
   await reminderCall(env,msg.from,msg.chat,{type:"complete"});
   for(const message_id of new Set(d.cleanup)){try{await telegram(env,"deleteMessage",{chat_id:msg.chat.id,message_id});}catch{}}
   try { await telegram(env,"sendPhoto",{chat_id:msg.chat.id,photo:QUICK_VISUAL_BASE+"16_order_success.jpg"}); } catch (err) { console.error("Quick order success image unavailable:",err); }
   await telegram(env,"sendMessage",{chat_id:msg.chat.id,parse_mode:"HTML",text:"🌹 <b>DAME CAMELIAS</b> 🌹\n\n✅ <b>Ваш заказ успешно отправлен!</b>\n\n💌 Спасибо за обращение. Наш менеджер скоро свяжется с вами.",reply_markup:keyboard("order",env)});
   return true;
 }
 if(stage==="platform"){d.current.platform=value;}
 else if(stage==="profiles_count"){d.profiles_count=value;d.profiles=[];d.current={};}
 else if(stage==="review_text"){
   d.current.reviewTexts=[...(d.current.reviewTexts||[]),value];
   if(d.current.reviewTexts.length<d.current.count){await quickPrompt(env,msg.chat.id,state);return true;}
 }else if(["url","kind","count","ratings","description","dates"].includes(stage)){d.current[stage]=value;}
 else d[stage]=value;
 state.i++;

 if(stage==="count"){
   if(d.current.kind==="Свой текст"&&value>0)state.i=QUICK_STEPS.indexOf("review_text");
   else state.i=QUICK_STEPS.indexOf(d.current.platform==="ASHOO"?"dates":"ratings");
 }
 if(stage==="review_text")state.i=QUICK_STEPS.indexOf(d.current.platform==="ASHOO"?"dates":"ratings");
 if(stage==="dates"){
   d.profiles.push(d.current);d.current=null;
   if(d.profiles.length<d.profiles_count){state.i=QUICK_STEPS.indexOf("url");d.current={};}
   else state.i=QUICK_STEPS.indexOf("role");
 }
 await quickPrompt(env,msg.chat.id,state);
 return true;
}
async function handle(update, env) {
  const adminHandled=await handleClientAdmin(update,env,telegram);
  if(adminHandled){
    if(adminHandled==="home"&&update.callback_query?.message?.chat?.id)await sendPage(env,update.callback_query.message.chat.id,"home");
    return;
  }
  const trialHandled = await handleTrialCabinet(update, env, telegram);
  if (trialHandled) {
    if (trialHandled==="home" && update.callback_query?.message?.chat?.id)
      await sendPage(env,update.callback_query.message.chat.id,"home");
    return;
  }
  const ownerHandled = await handleOwnerAnketa(update, env, telegram);
  if (ownerHandled) {
    // The owner module removes its temporary navigation on "В начало".
    // Restore the actual main menu instead of leaving an empty chat.
    if (update.callback_query?.data === "owner_anketa:home" && update.callback_query.message?.chat?.id) {
      await sendPage(env, update.callback_query.message.chat.id, "home");
    }
    return;
  }
  const person = update.callback_query?.from || update.message?.from;
  const chat = update.callback_query?.message?.chat || update.message?.chat;
  const action = update.callback_query?.data || (update.message?.text || "").split(/\s+/)[0].split("@")[0];
  await reminderCall(env,person,chat,{type:"activity",updateId:update.update_id,opensOrder:["order","quick_order","/order","/quick"].includes(action),navigation:!!update.callback_query && !action?.startsWith("reminder:") || action.startsWith("/")});
  if (update.callback_query) {
    const cb = update.callback_query;
    await trackVisitor(env,cb.from,cb.message?.chat,visitorInterest(update)).catch(err=>console.error("Visitor tracking:",err));
    await telegram(env, "answerCallbackQuery", { callback_query_id: cb.id });
    if (!cb.message) return;
    if (cb.data?.startsWith("reminder:")) {
      await reminderCall(env,cb.from,cb.message.chat,{type:"reply",reason:cb.data.slice(9),eventId:"callback:"+cb.id});
      return;
    }
    if (cb.data === "quick_order") { await quickPrompt(env,cb.message.chat.id,{i:0,d:{startId:cb.message.message_id}}); return; }
    if (cb.data?.startsWith("quick:")) {
      const selected=cb.data.slice(6);
      if (selected==="ОТМЕНА") {
        // Never delete a numerical range: it may contain unrelated user messages.
        await telegram(env,"deleteMessage",{chat_id:cb.message.chat.id,message_id:cb.message.message_id}).catch(()=>{});
        await sendPage(env,cb.message.chat.id,"order");
        return;
      }
      if (!quickState(cb.message)) {
        await telegram(env,"sendMessage",{chat_id:cb.message.chat.id,text:"⚠️ Шаг устарел. Нажмите «💬 Быстрый заказ», чтобы начать снова."});
        return;
      }
      await quickReply(env,{message:{chat:cb.message.chat,from:cb.from,text:selected,reply_to_message:cb.message}});
      return;
    }
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
  await trackVisitor(env,update.message.from,update.message.chat,visitorInterest(update)).catch(err=>console.error("Visitor tracking:",err));
  const cmd = (update.message.text || "").split(" ")[0].split("@")[0];
  if (cmd === "/start" && /^cancel_\d+$/.test((update.message.text||"").split(/\s+/)[1]||"")) {
    // Cancel only this command; do not erase the intervening chat history.
    await telegram(env,"deleteMessage",{chat_id:update.message.chat.id,message_id:update.message.message_id}).catch(()=>{});
    await sendPage(env,update.message.chat.id,"order");
    return;
  }
  if (cmd === "/cancel") { await telegram(env,"sendMessage",{chat_id:update.message.chat.id,text:"Заказ отменён. Чтобы начать заново, нажмите «💬 Быстрый заказ».",reply_markup:keyboard("order",env)}); return; }
  if (cmd === "/quick") { await quickPrompt(env,update.message.chat.id,{i:0,d:{startId:update.message.message_id}}); return; }
  if (!cmd.startsWith("/") && await quickReply(env,update)) return;
  if (!cmd.startsWith("/") && update.message.text) {
    const reply = await reminderCall(env,update.message.from,update.message.chat,{
      type:"reply",text:update.message.text,replyTo:update.message.reply_to_message?.message_id,eventId:"message:"+update.message.message_id
    });
    if (reply.handled) return;
  }
  const map = { "/start": "home", "/menu": "home", "/how": "how", "/services": "services", "/reviews": "reviews", "/order": "order", "/faq": "faq" };
  if (cmd === "/manager") {
    await telegram(env, "sendMessage", { chat_id: update.message.chat.id, text: "💬 Менеджер: @DameCamelias", reply_markup: { inline_keyboard: [[{ text: "Написать менеджеру", url: MANAGER_URL }], ...back] } });
    return;
  }
  if (!map[cmd] && !cmd.startsWith("/")) {
    await telegram(env,"sendMessage",{chat_id:update.message.chat.id,text:"💬 Для быстрого заказа нажимайте предложенные кнопки, а текстовые ответы отправляйте через «Ответить» на вопрос бота. Если оформление прервалось, нажмите «💬 Быстрый заказ» и начните заново.",reply_markup:keyboard("order",env)});
    return;
  }
  const key = cmd === "/start" ? "welcome" : (map[cmd] || "home");
  await sendPage(env, update.message.chat.id, key);
}
const ORDER_MANAGER_CHAT_ID = 5866034656;
const encoder = new TextEncoder();
const toHex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
const plain = value => String(value ?? "").slice(0, 2000).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
async function validWebApp(initData, token, maxAge = 600) {
  if (!initData || initData.length > 12000) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const date = Number(params.get("auth_date"));
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(date) || Math.abs(Date.now()/1000 - date) > maxAge) return false;
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
  const escape = s => plain(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const empty = value => plain(value) || "нет пожеланий";
  const receivedAt = new Intl.DateTimeFormat("ru-RU", {timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date());
  const telegramName = plain(order.telegram);
  const handleName = telegramName.replace(/^https?:\/\/t\.me\//i,"").replace(/^@/,"").split(/[/?#]/)[0];
  const telegramLink = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(handleName)
    ? '<a href="https://t.me/'+handleName+'">'+escape(telegramName)+'</a>'
    : escape(telegramName);
  const rawRole = plain(order.role).toLowerCase();
  const role = /самостоятель|индивидуал|сама|self/.test(rawRole) ? "Индивидуалка" : /менеджер|manager/.test(rawRole) ? "Менеджер" : plain(order.role);
  const message = [
    "💎 <b>DAME CAMELIAS — НОВАЯ ЗАЯВКА</b> 💎",
    "📅 <b>Дата и время:</b> "+receivedAt+" (МСК)",
    "",
    "👤 <b>Клиент:</b> "+escape(order.name),
    "📲 <b>Telegram:</b> "+telegramLink,
    "📋 <b>Статус:</b> "+escape(role)
  ].join("\n");
  const blocks = order.profiles.map((p, i) => {
    if (!["intimcity","ashoo"].includes(p.platform) || !p.url || !["create","edit"].includes(p.kind)) throw Error("Invalid profile");
    const dates = Object.entries(p.schedule || {}).filter(([date,mode]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && ["review","rating","both"].includes(mode)).sort(([a],[b]) => a.localeCompare(b)).slice(0,100).map(([date,mode]) => escape(date)+" — "+({review:"отзыв",rating:"оценка",both:"отзыв + оценка"}[mode]));
    return [
      "🌹 <b>АНКЕТА №"+(i+1)+" — "+(p.platform === "ashoo" ? "ASHOO" : "Intimcity")+"</b>",
      "🔗 "+escape(p.url),
      "💬 Отзывов: "+escape(p.count)+" ("+(p.kind === "create" ? "подготовка" : "текст клиента")+")",
      ...(p.platform === "intimcity" ? ["⭐ Оценок: "+escape(p.ratings), "✍️ Описание: "+(p.description?"да":"нет")] : []),
      "📅 Даты:\n"+(dates.join("\n") || "не выбраны"),
      "💌 Пожелания: "+escape(empty(p.services)),
      "📝 Тексты: "+escape(empty((p.reviewTexts || []).join(" | "))),
      "📋 Ответы: "+escape(empty(p.answers))
    ].join("\n\n");
  });
  const tail = "💬 <b>Общие пожелания:</b> "+escape(plain(order.notes) || "нету")+"\n\n💰 <b>Предварительная сумма: "+escape(order.total)+" ₽</b>";
  const parts = [message,...blocks,tail];
  const batches=[];let current="";
  for(const part of parts){if(part.length>3400)return new Response("Order field too long", {status:400});if(current && current.length+part.length+2>3600){batches.push(current);current="";}current+=(current?"\n\n":"")+part;}
  if(current)batches.push(current);
  try {for(const text of batches) await telegram(env,"sendMessage",{chat_id:ORDER_MANAGER_CHAT_ID,text,parse_mode:"HTML",disable_web_page_preview:true});}
  catch(e){console.error("Order delivery failed",e);return new Response("Delivery failed", {status:502});}
  const person = JSON.parse(new URLSearchParams(input.initData).get("user") || "null");
  await reminderCall(env,person,{id:person?.id,type:"private"},{type:"complete"});
  return Response.json({ok:true});
}

const VISITOR_REPORT_CHAT_ID = 5866034656;
const reportEscape = value => String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function reportSlot(now) {
  const moscow=new Date(now.getTime()+3*3600000);
  const hour=moscow.getUTCHours();
  const ending=hour<10?10:hour<16?16:hour<22?22:10;
  if(hour>=22)moscow.setUTCDate(moscow.getUTCDate()+1);
  const date=moscow.toISOString().slice(0,10);
  return date+"_"+String(ending).padStart(2,"0");
}
function moscowTime(value) {
  return new Intl.DateTimeFormat("ru-RU",{timeZone:"Europe/Moscow",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
}
function visitorInterest(update) {
 const action=update.callback_query?.data || (update.message?.text||"").split(/\s+/)[0].split("@")[0];
 const groups={
  how:"Как мы работаем",how_terms:"Условия",how_deadlines:"Сроки",
  services:"Цены и услуги",service_city:"Цены Intimcity",service_ashoo:"Цены ASHOO",
  reviews:"Отзывы и оценки",review_text:"Тексты отзывов",review_profile:"Описания анкет",
  faq:"Популярные вопросы",faq_safe:"Безопасность",faq_accounts:"Репутация",
  faq_schedule:"Сроки",faq_writing:"Тексты отзывов",faq_payment:"Оплата",
  faq_about:"О компании",order:"Оформление заказа",quick_order:"Заказ через бота",
  "/how":"Как мы работаем","/services":"Цены и услуги","/reviews":"Отзывы и оценки",
  "/faq":"Популярные вопросы","/order":"Оформление заказа","/quick":"Заказ через бота",
  "/manager":"Связь с менеджером"
 };
 if(action?.startsWith("quick:"))return "Заполнял заказ через бота";
 return groups[action]||null;
}
async function trackVisitor(env, person, chat, interest) {
 if(!env.VISITORS_KV || !person || person.is_bot || chat?.type!=="private" || !Number.isSafeInteger(person.id))return;
 const id=String(person.id),now=new Date().toISOString();
 const firstKey="first:"+id;
 const first=await env.VISITORS_KV.get(firstKey,"json");
 const firstSeen=first?.firstSeen||now;
 if(!first)await env.VISITORS_KV.put(firstKey,JSON.stringify({firstSeen}));
 const key="visit:"+reportSlot(new Date())+":"+id;
 const existing=await env.VISITORS_KV.get(key,"json");
 const interests=Array.isArray(existing?.interests)?existing.interests:[];
 if(existing && (!interest || interests.includes(interest)))return;
 const entry={
  id,username:person.username||existing?.username||"",
  name:[person.first_name,person.last_name].filter(Boolean).join(" ")||existing?.name||"",
  firstSeen,visitedAt:existing?.visitedAt||now,
  interests:interest?[...interests,interest].slice(0,8):interests
 };
 await env.VISITORS_KV.put(key,JSON.stringify(entry),{expirationTtl:90*86400});
}
async function scheduledVisitorReport(env, at) {
  if(!env.VISITORS_KV || !env.BOT_TOKEN){console.error("Visitor reports need VISITORS_KV and BOT_TOKEN");return;}
  const slot=reportSlot(new Date(at-60000));
  const prefix="visit:"+slot+":";
  const visitors=[];let cursor;
  do{
    const page=await env.VISITORS_KV.list({prefix,limit:1000,...(cursor?{cursor}:{})});
    for(const key of page.keys){
      const record=await env.VISITORS_KV.get(key.name,"json");
      if(record)visitors.push(record);
    }
    cursor=page.list_complete?undefined:page.cursor;
  }while(cursor && visitors.length<10000);
  visitors.sort((a,b)=>a.visitedAt.localeCompare(b.visitedAt));
  const end=slot.slice(11);
  const start=end==="10"?"22:00 предыдущего дня":end==="16"?"10:00":"16:00";
  const header="💎 <b>DAME CAMELIAS — ОТЧЁТ ПО ПОСЕТИТЕЛЯМ</b>\n📅 "+slot.slice(0,10)+" · "+start+"–"+end+":00 (МСК)\n👥 <b>Уникальных посетителей: "+visitors.length+"</b>";
  const lines=visitors.map((p,i)=>{
    const link=p.username && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(p.username)?'https://t.me/'+p.username:'tg://user?id='+p.id;
    const label=p.username?'@'+p.username:p.name||"Открыть профиль";
    return (i+1)+". <a href=\""+link+"\">"+reportEscape(label)+"</a>\n   🕐 Первый контакт: "+reportEscape(moscowTime(p.firstSeen))+"\n   💎 Интересовался: "+reportEscape((p.interests||[]).join(", ")||"пока только заходил");
  });
  let current=header;
  for(const line of lines){
    if(current.length+line.length+2>3500){
      await telegram(env,"sendMessage",{chat_id:VISITOR_REPORT_CHAT_ID,text:current,parse_mode:"HTML",disable_web_page_preview:true});
      current="📋 <b>Продолжение списка</b>\n"+line;
    }else current+="\n\n"+line;
  }
  await telegram(env,"sendMessage",{chat_id:VISITOR_REPORT_CHAT_ID,text:current,parse_mode:"HTML",disable_web_page_preview:true});
}
export default {
  async scheduled(controller,env,ctx) {
    ctx.waitUntil(scheduledVisitorReport(env,controller.scheduledTime).catch(err=>console.error("Scheduled visitor report failed",err)));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return new Response("DAME CAMELIAS bot is ready");
    if (request.method === "GET" && url.pathname === "/order") {
      const result = await fetch("https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/order/index.html");
      if (!result.ok) return new Response("Form unavailable", { status: 502 });
      return new Response(result.body, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
    }
    if (request.method === "GET" && url.pathname === "/anketa/ratings") {
      const result = await fetch("https://raw.githubusercontent.com/miqiduzavow369-ui/dame-camelias/main/anketa/ratings.html");
      if (!result.ok) return new Response("Form unavailable",{status:502});
      return new Response(result.body,{headers:{"Content-Type":"text/html; charset=utf-8","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"}});
    }
    if (request.method === "GET" && /^\/api\/anketa\/(?:photo|card)\/\d{1,9}$/.test(url.pathname))
      return serveProfileThumbnail(request,env);
    if (request.method === "POST" && url.pathname === "/api/anketa/ratings")
      return ownerRatingFormApi(request,env,telegram,validWebApp);
    if (url.pathname === "/api/order" && request.method === "OPTIONS") return new Response(null, {status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
    if (url.pathname === "/api/order/activity" && request.method === "POST") {
      let input;
      try { input = await request.json(); } catch { return new Response("Invalid JSON",{status:400}); }
      if (!await validWebApp(input.initData,env.BOT_TOKEN,86400)) return new Response("Forbidden",{status:403});
      const person = JSON.parse(new URLSearchParams(input.initData).get("user") || "null");
      await reminderCall(env,person,{id:person?.id,type:"private"},{type:"activity",opensOrder:true,navigation:true});
      return Response.json({ok:true});
    }
    if (url.pathname === "/api/order" && request.method === "POST") { const result = await receiveOrder(request, env); const headers = new Headers(result.headers); headers.set("Access-Control-Allow-Origin","*"); return new Response(result.body,{status:result.status,headers}); }
    if (request.method === "GET" && url.pathname === "/api/anketa/health")
      return new Response("anketa-handler-v2", {headers:{"Content-Type":"text/plain","Cache-Control":"no-store"}});
    if (request.method === "POST" && url.pathname === "/api/anketa/review-stage")
      return ownerReviewStage(request,env);
    if (request.method === "GET" && url.pathname === "/api/anketa/review-payload")
      return ownerReviewPayload(request,env);
    if (request.method === "GET" && url.pathname === "/api/anketa/dryfill-payload")
      return ownerDryfillPayload(request,env);
    if (request.method === "POST" && url.pathname === "/api/anketa/result")
      return handleAnketaLookupResult(request,env,telegram);
    if (request.method !== "POST" || url.pathname !== "/webhook") return new Response("Not found", { status: 404 });
    if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) return new Response("Not configured", { status: 503 });
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
    let update;
    try { update = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
    ctx.waitUntil(handle(update, env).catch(err => console.error("Update failed", err)));
    return new Response("ok");
  }
};

