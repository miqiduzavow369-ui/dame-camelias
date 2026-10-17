import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";

const runtime=readFileSync(new URL("../src/cabinet_runtime.js",import.meta.url),"utf8");
const index=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../anketa/mini-preview.html",import.meta.url),"utf8");
test("mini-app inline JS parses",()=>assert.doesNotThrow(()=>new Script(html.split("<script>").at(-1).split("</script>")[0])));
test("mini-app workflow reflects existing state only and is scoped to saved profiles",()=>{
 assert.match(runtime,/allowed\.has\(pid\)/);
 assert.match(runtime,/owner_anketa_state:/);
 assert.match(runtime,/permitted\.has\(stage\)/);
 assert.match(runtime,/workflow=\{profileId:pid,stage,account:/);
 assert.doesNotMatch(runtime,/workflow=\{[^\n]*nonce/);
});
test("mini-preview endpoint remains Telegram-authorized and only returns sanitized stage",()=>{
 const start=index.indexOf('url.pathname==="/api/anketa/mini-preview"');
 const end=index.indexOf('url.pathname==="/api/anketa/mini-add"',start);
 const code=index.slice(start,end);
 assert.match(code,/validWebApp/);
 assert.match(code,/cabinetRPC/);
 assert.match(code,/workflow:result\.workflow/);
});
test("no Mini App publication button is created from an unverified status",()=>{
 assert.match(html,/Публикация пока выполняется только через рабочий Telegram-кабинет/);
 assert.match(html,/legacyWorkflow/);
 assert.match(html,/prepublish_ready/);
});
