import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";import {Script} from "node:vm";
const owner=readFileSync(new URL("../src/owner_anketa.js",import.meta.url),"utf8");
const runtime=readFileSync(new URL("../src/cabinet_runtime.js",import.meta.url),"utf8");
const worker=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../anketa/mini-preview.html",import.meta.url),"utf8");
test("Mini App editor syntax and save UI",()=>{assert.doesNotThrow(()=>new Script(html.split("<script>").at(-1).split("</script>")[0]));assert.match(html,/Сохранить черновик/);assert.match(html,/mini-rating-save/);});
test("Cabinet save endpoint is authenticated and isolated",()=>{assert.match(worker,/mini-rating-save/);assert.match(runtime,/event.kind==="mini_rating_save"/);assert.match(runtime,/session.version!==client.authVersion/);});
test("Draft save is restricted to legacy rating state and selection validation",()=>{const start=owner.indexOf("async function miniRatingDraftSave");const stop=owner.indexOf("async function miniDeleteProfile",start);const s=owner.slice(start,stop);assert.match(s,/miniRatingFormLoad/);assert.match(s,/!\["ratings","ratings_agreed"\]\.includes\(state\.step\)/);assert.match(s,/miniRatingFormLoad/);assert.match(s,/statePut\(env/);assert.doesNotMatch(s,/navigationSay|say\(env,send|dispatchLookup/);});
