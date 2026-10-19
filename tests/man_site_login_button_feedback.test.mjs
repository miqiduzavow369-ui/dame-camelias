import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync("admin/preview-v3.html","utf8");
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test("ADMIN script parses after Chromium UI feedback fix",()=>{
 assert.ok(script);
 new vm.Script(script);
});
test("login errors stay visible when refreshing server state after failed launch",()=>{
 const start=html.indexOf("async function refreshManSiteLoginCheck(");
 const end=html.indexOf("async function openManSite()",start);
 const code=html.slice(start,end);
 assert.match(code,/async function refreshManSiteLoginCheck\(preserveError=false\)/);
 assert.match(code,/if\(!preserveError\)\{siteLoginError=''/);
 assert.match(code,/await refreshManSiteLoginCheck\(true\)/);
 assert.match(code,/siteLoginError=siteLoginProblem\(e\.message\)/);
 assert.match(html,/role="alert"/);
});
test("login action gives visible progress and avoids double presses",()=>{
 assert.match(html,/Отправляем запрос на проверку в Chromium/);
 assert.match(html,/Задание Chromium запущено/);
 assert.match(html,/siteLoginRefreshing\?'⏳ Обновляем…'/);
 assert.match(html,/!present\|\|siteLoginBusy\|\|siteLoginRefreshing/);
});
