import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const runtime=readFileSync(new URL('../src/cabinet_runtime.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../anketa/mini-preview.html',import.meta.url),'utf8');
test('read-only preview parses',()=>assert.doesNotThrow(()=>new Script(html.split('<script>').at(-1).split('</script>')[0])));
test('rating draft is constrained to saved profile and authenticated cabinet',()=>{
 assert.match(runtime,/allowed\.has\(pid\)/);
 assert.match(runtime,/agreementStatus\(env,uid\)/);
 assert.match(runtime,/workflow\.ratingDraft=selections\.map/);
 assert.match(runtime,/value:value\.slice\(0,50\)/);
});
test('draft preview does not mutate publication',()=>{
 assert.match(html,/Черновик оценок/);
 assert.match(html,/Публикация отдельно и только после подтверждения/);
 assert.match(html,/Публикация пока выполняется только через рабочий Telegram-кабинет/);
});
