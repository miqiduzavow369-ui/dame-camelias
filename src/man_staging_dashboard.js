// Static staging-only owner dashboard. No credentials and no production API calls.
export const STAGING_DASHBOARD_HTML=String.raw`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>DAME CAMELIAS · LAB</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0c0c0e;color:#eae4d9}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#161311,#08090b 60%);min-height:100vh}
main{max-width:900px;margin:auto;padding:24px 16px 60px}
header{padding:24px 0;border-bottom:1px solid #493e30;display:flex;justify-content:space-between;align-items:center;gap:16px}
h1{font-family:Georgia,serif;font-weight:500;letter-spacing:.06em;margin:6px 0;font-size:26px}
h2{font:500 19px Georgia,serif;margin:0 0 12px}
.eyebrow{color:#c7a76b;text-transform:uppercase;letter-spacing:.2em;font-size:10px}
.lab{font-size:11px;border:1px solid #8d7040;color:#e0bd7b;padding:6px 10px;border-radius:20px;white-space:nowrap}
p{color:#aaa093;font-size:13px;line-height:1.6}
.panel{background:rgba(29,27,27,.95);border:1px solid #514334;border-radius:14px;padding:20px;margin-top:18px}
.summary{display:flex;justify-content:space-between;gap:12px;align-items:center}
small{color:#aa9c88}.muted{color:#9d948b}
button,input,select{font:inherit;background:#131315;color:#e9ddcb;border:1px solid #625239;border-radius:8px;padding:10px 12px}
button{cursor:pointer}button:disabled{cursor:wait;opacity:.5}
button.gold{background:#c4a36e;color:#111;border-color:#c4a36e;font-weight:650}
button:hover:not(:disabled){border-color:#f3cc8c}
.fieldrow{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.fieldrow>*{min-width:0}
#man{flex:1 1 180px}#profile{flex:1 1 140px}#kind{flex:0 0 140px}
.item{border-top:1px solid #423b33;padding:15px 0;display:flex;align-items:center;justify-content:space-between;gap:12px}
.item strong{font-weight:550;font-size:14px}.item small{display:block;margin-top:6px}
.item .buttons{display:flex;gap:6px;flex-wrap:wrap}.item button{padding:7px 9px;font-size:12px}
#notice{min-height:20px}#notice.error{color:#ed9c91}#notice.good{color:#e6c68c}
@media(max-width:560px){.item{align-items:flex-start;flex-direction:column}main{padding:18px 12px}}
</style></head><body>
<main><header><div><div class="eyebrow">DAME CAMELIAS · тестовый контур</div>
<h1>♙ Очередь мужчин</h1></div><span class="lab">SIMULATION ONLY</span></header>
<p>Демонстрационные задания не публикуются на сайте, не списывают баланс и не запускают реальные мужские аккаунты. Доступ к данным — только владельцу через отдельного тестового Telegram-бота.</p>
<section class="panel"><div class="summary"><h2>Тестовая операция</h2><small>29 аккаунтов · отключены</small></div>
<div class="fieldrow"><select id="man" aria-label="Мужчина"></select>
<input id="profile" type="text" inputmode="numeric" maxlength="9" placeholder="ID анкеты" aria-label="ID анкеты">
<select id="kind" aria-label="Тип"><option value="rating">Оценка</option><option value="review">Отзыв</option></select>
<button class="gold" id="seed">Создать тест</button></div><p id="notice" role="status"></p></section>
<section class="panel"><div class="summary"><h2>История заданий</h2><button id="refresh">Обновить</button></div><p class="muted" id="empty">История ещё не загружена</p><div id="jobs"></div></section>
</main><script>
(function(){
"use strict";
var web=window.Telegram&&window.Telegram.WebApp;
if(web&&typeof web.ready==="function")web.ready();
var auth=web&&web.initData||"";
var select=document.getElementById("man"),list=document.getElementById("jobs"),empty=document.getElementById("empty");
var notice=document.getElementById("notice"),refresh=document.getElementById("refresh"),seed=document.getElementById("seed");
var busy=false;
function message(text,error){notice.textContent=text;notice.className=error?"error":"good";}
async function api(action,payload){
 if(!auth)throw Error("Откройте экран через отдельного тестового Telegram-бота");
 var response=await fetch("/api/man-staging",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},
 body:JSON.stringify(Object.assign({initData:auth,action:action},payload||{}))});
 var data=await response.json();
 if(!response.ok||data.ok!==true)throw Error(data.reason||"Сервер не ответил");
 return data;
}
function element(name,value,cls){var x=document.createElement(name);if(value!==undefined)x.textContent=String(value);if(cls)x.className=cls;return x;}
function setBusy(value){busy=value;seed.disabled=value;refresh.disabled=value;select.disabled=value;}
function jobRow(job){
 var row=element("div",undefined,"item"),details=element("div"),actions=element("div",undefined,"buttons");
 details.appendChild(element("strong",job.accountId+" · анкета "+job.profileId+" · "+(job.kind==="rating"?"Оценка":"Отзыв")));
 var labels={queued:"В очереди",completed:"Тест выполнен",rejected:"Тест отклонён"};
 var when=Number.isFinite(job.createdAt)?new Date(job.createdAt).toLocaleString("ru-RU"):"";
 details.appendChild(element("small",(labels[job.status]||"Неизвестно")+" · "+when));
 if(job.status==="queued"){
  [["mock_success","Тест: успех"],["mock_rejected","Тест: отказ"]].forEach(function(pair){
   var button=element("button",pair[1]);
   button.addEventListener("click",async function(){
    if(busy)return;setBusy(true);
    try{await api("mock_finish",{correlationKey:job.correlationKey,outcome:pair[0]});message("Тестовая операция завершена");await load();}
    catch(e){message(e.message,true)}finally{setBusy(false)}
   });actions.appendChild(button);
  });
 }
 row.appendChild(details);row.appendChild(actions);return row;
}
async function load(){
 var data=await api("mock_queue",{accountId:select.value});
 list.replaceChildren();data.items.forEach(function(job){list.appendChild(jobRow(job))});
 empty.textContent=data.items.length?"":"Заданий пока нет. Создайте демонстрационную операцию.";
}
async function boot(){
 if(!auth){message("Для входа откройте приложение из тестового Telegram-бота",true);return}
 setBusy(true);
 try{
  var data=await api("list");select.replaceChildren();
  data.accounts.filter(function(x){return x.id!=="yan_first"}).forEach(function(x){
   var option=element("option",x.name);option.value=x.id;select.appendChild(option);
  });
  await load();
 }catch(e){message(e.message,true)}finally{setBusy(false)}
}
select.addEventListener("change",function(){setBusy(true);load().catch(function(e){message(e.message,true)}).finally(function(){setBusy(false)})});
refresh.addEventListener("click",function(){setBusy(true);load().catch(function(e){message(e.message,true)}).finally(function(){setBusy(false)})});
seed.addEventListener("click",async function(){
 if(busy)return;var profile=document.getElementById("profile").value.trim();
 if(!/^[0-9]{1,9}$/.test(profile)){message("Введите ID анкеты от 1 до 9 цифр",true);return}
 setBusy(true);
 try{await api("mock_seed",{accountId:select.value,profileId:profile,kind:document.getElementById("kind").value});
 message("Создано тестовое задание. Никаких публикаций не выполняется.");await load()}
 catch(e){message(e.message,true)}finally{setBusy(false)}
});
boot();
})();
</script></body></html>`;
