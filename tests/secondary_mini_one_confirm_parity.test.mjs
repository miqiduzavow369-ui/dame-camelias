import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("secondary men use Yan First's single visible rating publication confirmation",()=>{
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match);
 assert.doesNotThrow(()=>new vm.Script(match[1]));
 assert.ok(html.includes('send.textContent="✅ Подтвердить публикацию"'));
 assert.ok(html.includes('confirmed:action==="publish"&&selectedAccount!=="yan_first"'));
 assert.ok(html.includes('send.onclick=async()=>{'));
 assert.ok(!html.includes('window.confirm("Подтвердить однократную публикацию выбранных оценок'));
 assert.ok(!html.includes('confirm("Подтверждаете однократную публикацию согласованного авторского отзыва'));
 assert.ok(html.includes('send.textContent="✅ Отправить отзыв"'));
 assert.ok(!html.includes('send.textContent="💾 Сохранить отзыв"'));
 assert.ok(html.includes('return engine.miniRatingAction(')===false);
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 assert.ok(runtime.includes('event.confirmed!==true'));
 assert.ok(runtime.includes('return engine.miniRatingAction('));
});
