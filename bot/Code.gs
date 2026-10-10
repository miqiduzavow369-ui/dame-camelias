/**
 * DAME CAMELIAS — Telegram consultant bot
 * Google Apps Script (free hosting). No secrets in GitHub.
 *
 * Script Properties required:
 * BOT_TOKEN      Telegram BotFather token
 * WEBHOOK_KEY    long random secret (at least 24 characters)
 * MANAGER_CHAT_ID optional numeric chat ID for future notifications
 * FORM_URL       optional HTTPS link to the order form
 */
const BRAND = '✦ DAME CAMELIAS ✦';
const MANAGER = 'https://t.me/DameCamelias';
const API = 'https://api.telegram.org/bot';

function props_() { return PropertiesService.getScriptProperties(); }
function telegram_(method, payload) {
  const token = props_().getProperty('BOT_TOKEN');
  if (!token) throw new Error('Set BOT_TOKEN in Script Properties');
  const response = UrlFetchApp.fetch(API + token + '/' + method, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const body = JSON.parse(response.getContentText());
  if (!body.ok) throw new Error(method + ': ' + response.getContentText());
  return body.result;
}
function menu_() {
  return { inline_keyboard: [
    [{text:'✨ Как это работает',callback_data:'how'}, {text:'💎 Наши услуги',callback_data:'services'}],
    [{text:'⭐ Отзывы и оценки',callback_data:'reviews'}, {text:'📝 Оставить заявку',callback_data:'order'}],
    [{text:'❓ Вопросы и ответы',callback_data:'faq'}, {text:'💬 Связь с менеджером',url:MANAGER}]
  ]};
}
function back_() { return {inline_keyboard:[[{text:'← Главное меню',callback_data:'home'}]]}; }
function send_(chatId, text, keyboard) {
  return telegram_('sendMessage', {chat_id:chatId, text:text, parse_mode:'HTML',
    disable_web_page_preview:true, reply_markup:keyboard||back_()});
}
function escape_(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function page_(key) {
  switch(key) {
    case 'how': return '<b>✨ Как это работает</b>\n\n1. Вы выбираете услугу и заполняете анкету.\n2. Указываете площадку, профиль и пожелания.\n3. Проверяете итог заказа.\n4. Менеджер связывается с вами для согласования деталей.\n\nМы помогаем оформлять и редактировать подлинную обратную связь.';
    case 'services': return '<b>💎 Наши услуги</b>\n\n<b>Intimcity</b>\n• Подготовка текста по реальному отзыву клиента — 500 ₽\n• Редактирование предоставленного текста — 400 ₽\n• Описание профиля — 2 000 ₽\n\n<b>ASHOO</b>\n• Подготовка текста по реальному отзыву — 1 000 ₽\n• Редактирование предоставленного текста — 800 ₽\n\nИтог зависит от выбранных редакционных услуг. Размещение отзывов и выставление оценок не включены в этот прайс.';
    case 'reviews': return '<b>⭐ Отзывы и оценки</b>\n\nРаботаем с обратной связью реальных клиентов и достоверными оценками. Поможем структурировать впечатления и отредактировать текст без изменения смысла.\n\nДля Intimcity в анкете можно указать отзывы и оценки услуг; для ASHOO — отзывы. Фиктивные отзывы и искусственное повышение рейтинга не предлагаем.';
    case 'faq': return '<b>❓ Вопросы и ответы</b>\n\n<b>Как оформить заявку?</b>\nНажмите «Оставить заявку» в главном меню.\n\n<b>Можно указать несколько анкет?</b>\nДа, в форме предусмотрено несколько профилей.\n\n<b>Какой минимальный заказ?</b>\n8 позиций суммарно.\n\n<b>Когда ответит менеджер?</b>\nПосле получения и проверки заявки; точное время согласуется индивидуально.\n\n<b>Как связаться напрямую?</b>\nЧерез @DameCamelias.';
    case 'order': {
      const url = props_().getProperty('FORM_URL');
      return url
        ? '<b>📝 Оставить заявку</b>\n\nОткройте фирменную анкету по кнопке ниже. Минимальный заказ — 8 позиций.'
        : '<b>📝 Оставить заявку</b>\n\nФорма с календарём готовится к подключению. Пока напишите менеджеру: @DameCamelias.';
    }
    default: return '<b>' + BRAND + '</b>\n\nДобро пожаловать в персональный сервис DAME CAMELIAS.\n\nВнимание к деталям, деликатная коммуникация и элегантное оформление. Выберите интересующий раздел:';
  }
}
function keyboardFor_(key) {
  if (key === 'home') return menu_();
  if (key === 'order') {
    const url = props_().getProperty('FORM_URL');
    if (url && /^https:\/\//i.test(url)) return {inline_keyboard:[
      [{text:'📝 Открыть анкету',web_app:{url:url}}],
      [{text:'💬 Написать менеджеру',url:MANAGER}],
      [{text:'← Главное меню',callback_data:'home'}]
    ]};
    return {inline_keyboard:[
      [{text:'💬 Написать менеджеру',url:MANAGER}],
      [{text:'← Главное меню',callback_data:'home'}]
    ]};
  }
  return back_();
}
function doPost(e) {
  try {
    const expected = props_().getProperty('WEBHOOK_KEY');
    if (!expected || expected.length < 24 || !e || !e.parameter || e.parameter.key !== expected) {
      return ContentService.createTextOutput('ignored');
    }
    const update = JSON.parse(e.postData.contents);
    if (update.callback_query) {
      const cb = update.callback_query;
      telegram_('answerCallbackQuery',{callback_query_id:cb.id});
      const key = ['home','how','services','reviews','order','faq'].includes(cb.data) ? cb.data : 'home';
      telegram_('editMessageText',{chat_id:cb.message.chat.id,message_id:cb.message.message_id,
        text:page_(key),parse_mode:'HTML',disable_web_page_preview:true,reply_markup:keyboardFor_(key)});
    } else if (update.message && update.message.chat) {
      const raw = (update.message.text||'').split(' ')[0].split('@')[0];
      const commands = {'/start':'home','/menu':'home','/how':'how','/services':'services',
        '/reviews':'reviews','/order':'order','/faq':'faq','/manager':'manager'};
      const key = commands[raw] || 'home';
      if (key === 'manager') send_(update.message.chat.id,'💬 Менеджер: @DameCamelias',
        {inline_keyboard:[[{text:'Написать менеджеру',url:MANAGER}],[{text:'← Главное меню',callback_data:'home'}]]});
      else send_(update.message.chat.id,page_(key),keyboardFor_(key));
    }
  } catch (err) { console.error(err); }
  return ContentService.createTextOutput('ok');
}
/** Run once after deploying as Web App (Execute as: Me; Access: Anyone). */
function setupWebhook() {
  const key = props_().getProperty('WEBHOOK_KEY');
  if (!key || key.length < 24) throw new Error('WEBHOOK_KEY must be at least 24 characters');
  const base = ScriptApp.getService().getUrl();
  if (!base) throw new Error('Deploy as Web App before running setupWebhook');
  const url = base + '?key=' + encodeURIComponent(key);
  telegram_('setWebhook',{url:url,allowed_updates:['message','callback_query'],drop_pending_updates:false});
  console.log('Webhook configured (secret URL hidden).');
}
function checkBot() {
  const me = telegram_('getMe',{});
  console.log('Connected to @' + me.username);
}
