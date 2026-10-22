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
 assert.match(block,/connection\?\.browserVerified===true/);
 assert.match(block,/browser\?\.version===data\.proxy\.version/);
 assert.doesNotMatch(block,/siteProbeResult\?\.reachable/);
 assert.match(block,/const steps=\[/);
 assert.match(block,/registration-step/);
 assert.match(block,/Текущий шаг/);
 assert.match(block,/Подтвердите проверенные данные/);
});
test("legacy Yan First is immutable and remains on its own screen",()=>{
 const block=html.slice(html.indexOf("function renderManConsole(){"),html.indexOf("function renderManSiteForm(){"));
 assert.match(block,/if\(legacy\)\{/);
 assert.match(block,/Настройки и публикации работают по прежнему маршруту/);
 assert.match(block,/login\?\.technicalReady===true/);
 assert.match(block,/const legacy=x\.id==='yan_first'/);
});
test("wizard refresh loads browser status from authenticated endpoint",()=>{
 const refresh=html.slice(html.indexOf("async function refreshManWizard("),html.indexOf("async function reloadManHistory("));
 assert.match(refresh,/man_registration_status/);
 assert.match(refresh,/wizardData=\{id,\.\.\.data\}/);
});
