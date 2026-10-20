import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";import {Script} from "node:vm";
const source=readFileSync(new URL("../src/owner_anketa.js",import.meta.url),"utf8");const html=readFileSync(new URL("../anketa/mini-preview.html",import.meta.url),"utf8");
test("Mini App UI parses and draft review remains non-publishing",()=>{assert.doesNotThrow(()=>new Script(html.split("<script>").at(-1).split("</script>")[0]));assert.match(html,/Проверка черновика/);assert.match(html,/Вернуться к выбору/);assert.match(html,/Проверить результат/);});
test("rating form and saved draft use real whitespace and numeric-index regexes",()=>{const a=source.indexOf("async function miniRatingFormLoad"),b=source.indexOf("async function miniDeleteProfile",a),part=source.slice(a,b);assert.ok(a>=0&&b>a);assert.ok(part.includes(String.raw`\s*`));assert.ok(part.includes(String.raw`\d{0,2}`));assert.ok(!part.includes(String.raw`\\s`));assert.ok(!part.includes(String.raw`\\d`));});

test("rating publication actions stay hidden until verification succeeds",()=>{
 assert.match(html,/publish\.textContent="🔎 Проверить результат"/);
 assert.match(html,/back\.hidden=stage!=="ready"/);
 assert.match(html,/send\.hidden=stage!=="ready"/);
 assert.match(html,/review\.append\(publish,check,actionStatus,waitingClock,back,send\);reflect\(\{stage:"draft"\}\)/);
 assert.match(html,/requestAction\("prepare"\)/);
 assert.match(html,/requestAction\("publish"\)/);
});
