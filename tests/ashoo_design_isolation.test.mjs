import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const mini=readFileSync(new URL('../anketa/mini-preview.html',import.meta.url),'utf8');
const admin=readFileSync(new URL('../admin/preview-v3.html',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const ashoo=readFileSync(new URL('../ashoo/design-preview.html',import.meta.url),'utf8');

test('ASHOO preview remains opt-in owner-only in the shared Mini App',()=>{
 assert.match(mini,/id="ashoo-nav-entry"[^>]*hidden/);
 assert.match(mini,/function showAshooOwnerPreview\(\)/);
 assert.match(mini,/let visible=ashooPreviewAllowed===true/);
 assert.match(mini,/action:'man_accounts'/);
 assert.match(mini,/tg\?\.initDataUnsafe\?\.user\?\.id/);
 assert.match(mini,/visible=response.ok/);
 assert.match(mini,/snapshot\.ashooPreviewEnabled===true/);
 assert.match(worker,/ashooPreviewEnabled:uid==="5866034656"/);
 assert.match(mini,/if\(!visible&&lastTab==='ashoo'\)showTab\('profiles'\)/);
 assert.match(mini,/id="tab-profiles"/);
 assert.match(mini,/data-tab="profiles"/);
 assert.match(mini,/data-tab="published"/);
 assert.match(mini,/data-tab="cabinet"/);
});
test('ASHOO review controls cannot submit or charge in preview',()=>{
 assert.match(mini,/id="tab-ashoo" hidden/);
 assert.match(mini,/Начать отзыв · недоступно/);
 assert.match(mini,/class="ashoo-btn" disabled/);
 assert.doesNotMatch(ashoo,/fetch\s*\(/);
 assert.match(ashoo,/Отправить на согласование · недоступно/);
 assert.match(ashoo,/disabled>🔒 Отправить/);
});
test('13 candidates are opt-in matches on existing admin cards without activating ASHOO',()=>{
 const names=['sv.gek','eg.egor6','zuev.dmi1','kir.sm1','bog.pop2','ign.egor1','kir.log1','and9rez','fed.alin1','ser.kalu','wong32s','ud.ale1','mil.mor1'];
 for(const name of names)assert.ok(admin.includes("'"+name+"'"),name);
 assert.match(admin,/function ashooSelected\(x\)/);
 assert.match(admin,/function renderAshooConnection\(x\)/);
 assert.match(admin,/renderAshooConnection\(identity\)/);
 assert.match(admin,/＋ Подключить ASHOO · следующий этап/);
 assert.match(admin,/Не подключён/);
 assert.doesNotMatch(admin,/function activateAshoo\(/);
});
