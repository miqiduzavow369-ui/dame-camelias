import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync("admin/preview-v3.html","utf8");
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

test("compact male wizard JS parses",()=>{
 assert.ok(script);
 new vm.Script(script);
});
test("wizard uses authoritative browser verification, not transient probe",()=>{
 const block=html.slice(html.indexOf("function renderManConsole(){"),html.indexOf("function renderManSiteForm(){"));
 assert.match(block,/browser\?\.status==='verified'/);
 assert.match(block,/browser\?\.version===data\.proxy\.version/);
 assert.doesNotMatch(block,/siteProbeResult\?\.reachable/);
 assert.match(block,/const steps=\[/);
 assert.match(block,/Пройдено:/);
 assert.match(block,/ТЕКУЩИЙ ЭТАП/);
 assert.match(block,/Публикации закрыты до отдельного разрешения/);
});
test("legacy Yan First is immutable and remains on its own screen",()=>{
 const block=html.slice(html.indexOf("function renderManConsole(){"),html.indexOf("function renderManSiteForm(){"));
 assert.match(block,/if\(legacy\)\{/);
 assert.match(block,/Настройки и публикации работают по прежнему маршруту/);
 assert.match(block,/const identityOK=false/);
});
test("wizard refresh loads browser status from authenticated endpoint",()=>{
 const refresh=html.slice(html.indexOf("async function refreshManWizard("),html.indexOf("async function reloadManHistory("));
 assert.match(refresh,/man_browser_status/);
 assert.match(refresh,/browser:get\(3\)/);
});