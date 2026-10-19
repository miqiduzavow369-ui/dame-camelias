import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
const site=fs.readFileSync("src/man_site_vault.js","utf8");
const login=fs.readFileSync("src/man_site_login_preflight.js","utf8");
const browser=fs.readFileSync("src/man_browser_preflight.js","utf8");
const ui=fs.readFileSync("admin/preview-v3.html","utf8");
const executor=fs.readFileSync("tools/man_site_login_preflight.py","utf8");
test("all men owner registry initializes proxy status before readiness projection",()=>{
 const begin=runtime.indexOf('if(event.kind==="admin_man_registry")');
 const end=runtime.indexOf('if(event.kind==="admin_man_setup_history")',begin);
 const block=runtime.slice(begin,end);
 assert.ok(block.indexOf('const proxyMap=new Map(proxyEntries)')>=0);
 assert.ok(block.indexOf('const proxyMap=new Map(proxyEntries)')<block.indexOf('const readinessEntries='));
 assert.ok(block.includes('p?.proxyVerified===true&&p?.ipVerified===true'));
 assert.ok(block.includes('login.technicalReady===true'));
 assert.ok(block.includes('canPublish:false'));
});
test("stored site credentials are invalidated when proxy version or account changes",()=>{
 const status=site.slice(site.indexOf("export async function readSiteStatus("),site.indexOf("export async function saveSiteCredentials("));
 assert.match(status,/raw\?\.accountId===accountId/);
 assert.match(status,/raw\?\.boundProxyVersion===proxy\.version/);
 assert.match(status,/needsProxyVerification:!validProxy/);
});
test("authentication never continues without current verified browser and matching pinned proxy",()=>{
 assert.match(login,/browser\.status==="verified"/);
 assert.match(login,/browser\.version===proxy\.version/);
 assert.match(login,/site\?\.boundProxyVersion===proxy\?\.version/);
 assert.match(login,/p\.protocol!=="http"/);
 assert.match(browser,/observedIp===proxy\.expectedIp/);
 assert.match(executor,/if str\(ip\)!=details\["expectedIp"\]:/);
 assert.match(executor,/"server":f"http:\/\/\{details\['proxyHost'\]\}:\{details\['proxyPort'\]\}"/);
 assert.match(executor,/"User-Agent":"DameCameliasBot\/1\.0"/);
});
test("already saved credentials do not require re-entry and site indicator is honest",()=>{
 assert.match(ui,/present\?'✓ Сохранено'/);
 assert.match(ui,/Изменить логин или пароль \(сбросит подтверждение входа\)/);
 assert.match(ui,/x\.readiness\?\.technicalReady===true\?'ok':'unknown'/);
 assert.match(ui,/siteLoginState\?\.retryAvailable===true/);
 assert.match(ui,/Проверить вход через Chromium/);
 assert.match(ui,/Публикации закрыты/);
 const script=ui.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script);
 new vm.Script(script);
});
