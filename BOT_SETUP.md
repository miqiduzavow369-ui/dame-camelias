# DAME CAMELIAS — Telegram bot

Telegram: [@DameCameliasConsultantBot](https://t.me/DameCameliasConsultantBot)

## Бесплатный запуск через Google Apps Script

1. Откройте https://script.google.com/ и создайте новый проект.
2. Замените содержимое файла `Code.gs` кодом из [bot/Code.gs](bot/Code.gs).
3. Откройте **Project Settings → Script Properties** и добавьте:
   - `BOT_TOKEN`: токен **только нового** бота от BotFather (не публиковать).
   - `WEBHOOK_KEY`: длинная случайная строка (минимум 24 символа; не публиковать).
   - `FORM_URL`: необязательная HTTPS-ссылка на HTML-анкету, добавим позже.
4. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Разрешите доступы Google.
5. Запустите функцию `checkBot` в редакторе — в журнале должно появиться имя бота.
6. Запустите функцию `setupWebhook` — она зарегистрирует адрес веб-приложения в Telegram.
7. Откройте бота и отправьте `/start`. Проверьте все шесть разделов.

**Внимание:** не вставляйте токен в репозиторий, README, чат или HTML. После изменения кода Apps Script обновляйте развертывание через Manage deployments → Edit → New version. У бота пока нет автоматической передачи заказов менеджеру: эта функция появится при подключении HTML-анкеты и обработчика заявок.

## Команды BotFather

Отправьте `/setcommands`, выберите нужного бота и вставьте:

```
start - Главное меню
how - Как это работает
services - Наши услуги
reviews - Отзывы и оценки
order - Оставить заявку
faq - Вопросы и ответы
manager - Связь с менеджером
```

Меню с шестью кнопками создаёт **код**, а BotFather настраивает только список команд. Форма заказов и календарь пока не опубликованы.
