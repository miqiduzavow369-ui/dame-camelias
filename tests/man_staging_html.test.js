import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {STAGING_DASHBOARD_HTML} from "../src/man_staging_dashboard.js";

function scriptParts(){
 const html=STAGING_DASHBOARD_HTML;
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
 return {html,scripts};
}
test("staging dashboard always loads Telegram SDK before its own inline script",()=>{
 const {html,scripts}=scriptParts();
 assert.equal(scripts.length,2);
 assert.match(scripts[0][1],/src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"/);
 assert.equal(scripts[0][2].trim(),"");
 assert.equal(scripts[1][1].trim(),"");
 assert.ok(html.indexOf("telegram-web-app.js")<html.indexOf("var web=window.Telegram"));
});
test("staging dashboard inline JavaScript compiles under Node vm",()=>{
 const {scripts}=scriptParts();
 assert.doesNotThrow(()=>new vm.Script(scripts[1][2],{filename:"staging-admin-inline.js"}));
});
test("staging dashboard exposes simulation controls only, no production endpoints",()=>{
 const {html}=scriptParts();
 assert.match(html,/SIMULATION ONLY/);
 assert.match(html,/\/api\/man-staging/);
 assert.doesNotMatch(html,/api\.telegram\.org|api\/admin\/app|github\.com\/repos/);
 assert.doesNotMatch(html,/MAN_STAGING_BOT_TOKEN|PROXY_PASSWORD|INTIMCITY_PASSWORD|BOT_TOKEN/);
});
test("staging dashboard safeguards cross-account response and stale requests",()=>{
 const {scripts}=scriptParts(),code=scripts[1][2];
 assert.match(code,/queueRequestVersion/);
 assert.match(code,/accountId!==select\.value/);
 assert.match(code,/job\.accountId===accountId/);
 assert.match(code,/job\.sitePublished===false/);
 assert.match(code,/job\.creditsDebited===false/);
});
