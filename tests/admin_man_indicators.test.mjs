import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('ADMIN HTML parses, has mobile indicators and no false verified status',()=>{
 const html=fs.readFileSync('admin/preview-v3.html','utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script,'script');
 new vm.Script(script[1]);
 assert.match(html,/function manDiagnostics\(x\)/);
 assert.match(html,/function manChecks\(x,mini=false\)/);
 assert.match(html,/Прокси \/ IP/);
 assert.match(html,/Кабинет Intimcity/);
 assert.match(html,/Не проверено/);
 assert.match(html,/Ян Первый/);
 assert.match(html,/Не настроено/);
 assert.match(html,/Подтверждение личности мужчины пока не выполняется/);
});
test('ADMIN network indicator never trusts displayed connection status alone',()=>{
 const html=fs.readFileSync('admin/preview-v3.html','utf8');
 assert.match(html,/if\(x\?\.id==='yan_first'\)return \{proxy:'unknown',site:'unknown'\}/);
 assert.match(html,/if\(!n\|\|n\.configured!==true\)return \{proxy:'off',site:'off'\}/);
 assert.match(html,/n\.proxyVerified===true&&n\.ipVerified===true/);
 assert.match(html,/proxy==='ok'&&x\.readiness\?\.technicalReady===true/);
});
