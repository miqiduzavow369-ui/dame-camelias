import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";

const runtime=readFileSync("src/cabinet_runtime.js","utf8");
const html=readFileSync("admin/preview-v3.html","utf8");
test("30-men admin list decrypts only the owner's saved technical name",()=>{
 const start=runtime.indexOf('if(event.kind==="admin_man_registry")');
 const end=runtime.indexOf('if(event.kind==="admin_man_setup_history")',start);
 assert.ok(start>0&&end>start);
 const scope=runtime.slice(start,end);
 assert.match(scope,/uid!==OWNER_ID\|\|event\.actorId!==OWNER_ID/);
 assert.match(scope,/await privateDraftStatus\(storage,rawEnv/);
 assert.match(scope,/actorId:event\.actorId,cabinetId:uid,ownerId:OWNER_ID,accountId:x\.id/);
 assert.match(scope,/technicalName:technicalMap\.get\(x\.id\)\?\?null/);
 assert.doesNotMatch(scope,/settings:row\.settings/);
 assert.doesNotMatch(scope,/siteLogin:|proxyPassword:|sitePassword:|username:row/);
});
test("each admin man tile labels the email under current name, safely escaped",()=>{
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,"admin script expected");
 assert.doesNotThrow(()=>new Script(script));
 const idx=html.indexOf('function renderMenDashboard()');
 const end=html.indexOf('function renderManDiagnostic(',idx);
 const block=html.slice(idx,end);
 assert.ok(idx>0&&end>idx);
 assert.match(block,/sq-name.*esc\(x\.name\)/);
 assert.match(block,/sq-technical/);
 assert.match(block,/esc\(x\.technicalName\)/);
 assert.match(block,/Email не задан/);
 assert.match(block,/String\(x\.technicalName\|\|""\)/);
 assert.match(html,/Техническое имя \/ Email/);
});
