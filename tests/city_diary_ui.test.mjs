import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const page=readFileSync(new URL("../anketa/city-diary-preview.html",import.meta.url),"utf8");
test("City diary preview scripts parse",()=>{
  const scripts=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
  assert.ok(scripts.length>0);
  for(const code of scripts)assert.doesNotThrow(()=>new Script(code));
});
test("preview uses existing black and gold City tokens",()=>{
  for(const token of ["#080808","#d9b46e","#ffe0a0","Мой ежедневник","Календарь"])
    assert.ok(page.includes(token),token);
  assert.ok(page.includes('classList.add("selected")'));
});
test("planning UI remains read-only for publication execution",()=>{
  assert.ok(page.includes('/api/anketa/mini-diary'));
  assert.ok(page.includes('/api/anketa/mini-preview'));
  assert.ok(page.includes('await api("cancel"'));
  assert.ok(!page.includes('api("publish"'));
  assert.ok(!page.includes('credits_complete'));
  assert.ok(!page.includes('review_publish'));
});
test("text content is inserted through DOM APIs rather than user-supplied HTML",()=>{
  assert.ok(page.includes('node.textContent=value'));
  assert.ok(!page.includes("innerHTML="));
  assert.ok(!page.includes("localStorage"));
});

test("month navigation keeps selected date in displayed month",()=>{
 assert.ok(page.includes('function moveMonth(delta)'));
 assert.ok(page.includes('selected=[year,String(month+1).padStart(2,"0"),"01"].join("-")'));
 assert.ok(page.includes('renderCalendar();renderPlans();'));
});
test("mutating retries reuse the same event and operation IDs",()=>{
 assert.ok(page.includes("pendingSave.operation"));
 assert.ok(page.includes("pendingSave.id"));
 assert.ok(page.includes("pendingCancel.get(key)"));
 assert.ok(page.includes("pendingSave.fingerprint!==fingerprint"));
});
test("calendar saves the intended local day and timezone",()=>{
 assert.ok(page.includes("timezone,profileId"));
 assert.ok(page.includes("localDate:date"));
 assert.ok(page.includes("function dayKey(e)"));
});

test("month planning offers multiple gold-selected days and atomic batch API",()=>{
 for(const token of ["План на месяц","batchDates","batchSave","renderBatch()",
   'api("batch"','pendingBatch.operation','batchDates.has(date)'])
   assert.ok(page.includes(token),token);
});
test("all plans switches from selected-day view without revealing another client",()=>{
 assert.ok(page.includes('plansView==="all"'));
 assert.ok(page.includes('id="allView"'));
 assert.ok(page.includes('id="dayView"'));
 assert.ok(!page.includes("innerHTML="));
});

test("publication readiness button is read-only and makes no site submissions",()=>{
 assert.ok(page.includes("Проверить готовность"));
 assert.ok(page.includes('api("recheck"'));
 assert.ok(page.includes("Публикация не запущена."));
 assert.ok(!page.includes('api("publish"'));
});

test("successful write cannot be repeated merely because the following list refresh fails",()=>{
 const save=page.slice(page.indexOf("async function save(){"),page.indexOf("function renderBatch(){"));
 const batch=page.slice(page.indexOf("async function saveBatch(){"),page.indexOf("async function refresh(){"));
 for(const chunk of [save,batch]){
  assert.ok(chunk.includes("accepted=true"));
  assert.ok(chunk.includes("try{await refresh();"));
  assert.ok(chunk.includes("повторно сохранять не нужно"));
  assert.ok(chunk.indexOf("pendingSave=null")!==-1||chunk.indexOf("pendingBatch=null")!==-1);
 }
});
test("editing plans in a different device timezone is blocked rather than silently shifted",()=>{
 assert.ok(page.includes("e.timezone!==timezone"));
 assert.ok(page.includes("timeInZone(e.at,e.timezone)"));
 assert.ok(page.includes("Чтобы не сдвинуть время"));
});

test("archive UI handles cancelled reminders without touching publications or deleting history",()=>{
 assert.ok(page.includes('id="archiveView"'));
 assert.ok(page.includes('api("list_archive"'));
 assert.ok(page.includes('api("archive_cancelled_reminders"'));
 assert.ok(page.includes('e.mode==="reminder"&&e.status==="cancelled"'));
 assert.ok(page.includes("История сохранится"));
});
