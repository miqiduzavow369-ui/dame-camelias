import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const worker=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const runtime=readFileSync(new URL("../src/cabinet_runtime.js",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/owner_anketa.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../anketa/mini-preview.html",import.meta.url),"utf8");
test("Mini rating form UI parses",()=>assert.doesNotThrow(()=>new Script(html.split("<script>").at(-1).split("</script>")[0])));
test("new endpoint requires Telegram and cabinet authorization",()=>{
 assert.match(worker,/mini-rating-form/);
 assert.match(worker,/validWebApp\(body\?\.initData/);
 assert.match(runtime,/event.kind==="mini_rating_form"/);
 assert.match(runtime,/agreementStatus\(env,uid\)/);
 assert.match(runtime,/session.version!==client.authVersion/);
});
test("form loads existing selected draft, never publishes",()=>{
 const begin=engine.indexOf("async function miniRatingFormLoad");
 const end=engine.indexOf("async function miniRatingAction",begin);
 const code=engine.slice(begin,end);
 assert.match(code,/publicationStatus/);
 assert.match(code,/selectedAccount/);
 assert.match(code,/organizeCatalog\(state.catalog\)/);
 assert.match(code,/selected:state.selected/);
 assert.doesNotMatch(code,/statePut|dispatchLookup|savedPut|say\(env/);
 assert.match(html,/Публикация отдельно и только после подтверждения/);
});
