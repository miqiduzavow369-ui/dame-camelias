// Hidden, owner-only entry for future Intimcity drafts.
// Restricted to the verified owner ID and its private Telegram chat.
// No web actions, review submissions, or rating submissions.
export function ownerAllowed(update, env) {
  const from = update.callback_query?.from ?? update.message?.from;
  const chat = update.callback_query?.message?.chat ?? update.message?.chat;
  const expected = "5866034656";
  return /^\d+$/.test(expected) &&
    String(from?.id ?? "") === expected &&
    String(chat?.id ?? "") === expected &&
    chat?.type === "private";
}

export async function handleOwnerAnketa(update, env, sendTelegram) {
  const message = update.message;
  const callback = update.callback_query;
  const text = message?.text ?? "";
  const command = text.trim().split(/\s+/)[0].split("@")[0];
  const isCommand = command === "/anketa";
  const isEntry = String(callback?.data ?? "") === "owner_anketa:open";
  const isCallback = String(callback?.data ?? "").startsWith("owner_anketa:");
  if (!isCommand && !isCallback) return false;

  // This check is performed for every message and every callback, not just menus.
  if (!ownerAllowed(update, env)) {
    if (callback) await sendTelegram(env, "answerCallbackQuery", {
      callback_query_id: callback.id, text: "Недоступно", show_alert: false,
    });
    return true;
  }
  const chatId = message?.chat.id ?? callback?.message?.chat.id;
  if (callback) await sendTelegram(env, "answerCallbackQuery", { callback_query_id: callback.id });

  if (isEntry) {
    await sendTelegram(env, "sendMessage", {chat_id:chatId,text:"🔐 АНКЕТА\nВведите номер анкеты командой /anketa 750206"});
    return true;
  }
  if (isCommand) {
    const id = text.trim().split(/\s+/)[1] ?? "";
    if (!/^\d{1,9}$/.test(id)) {
      await sendTelegram(env, "sendMessage", {chat_id:chatId,text:"🔒 Личный раздел. Введите /anketa 750206"});
      return true;
    }
    await sendTelegram(env, "sendMessage", {
      chat_id: chatId,
      text: "🔒 Личный раздел\nАнкета №" + id + "\nВыберите действие для подготовки черновика:",
      reply_markup: {inline_keyboard:[
        [{text:"⭐ Оценки",callback_data:"owner_anketa:rating:"+id}],
        [{text:"✍️ Отзыв",callback_data:"owner_anketa:review:"+id}]
      ]}
    });
    return true;
  }
  const parts = callback.data.split(":");
  if (parts.length !== 3 || !["rating","review"].includes(parts[1]) || !/^\d{1,9}$/.test(parts[2])) {
    return true;
  }
  await sendTelegram(env,"sendMessage",{
    chat_id:chatId,
    text:"🔒 Анкета №"+parts[2]+"\n"+(parts[1]==="rating"?"⭐ Оценки":"✍️ Отзыв")+"\nЧерновик пока не подключён к интерфейсу Telegram. Публикации отключены."
  });
  return true;
}
