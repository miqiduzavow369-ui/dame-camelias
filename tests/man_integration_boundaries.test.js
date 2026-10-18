import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Static checks ensure no staging branch can inadvertently hook new men into
// the legacy publication workflow or create an unauthenticated ADMIN endpoint.
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("owner auth precedes all new ADMIN man actions",()=>{
 const api=read("src/admin_app_api.js");
 const checked=api.indexOf("if(!await authenticatedOwner(body,env))");
 assert.ok(checked>=0);
 for(const action of ["man_accounts","man_setup_draft","man_setup_history"]){
   const pos=api.indexOf('if(action==="'+action+'")');
   assert.ok(pos>checked,action+" must follow Telegram owner authentication");
 }
});
test("owner cabinet guards all new man event handlers before storage",()=>{
 const runtime=read("src/cabinet_runtime.js");
 for(const kind of ["admin_man_registry","admin_man_setup_draft","admin_man_setup_history"]){
   const start=runtime.indexOf('if(event.kind==="'+kind+'")');
   assert.ok(start>=0);
   const block=runtime.slice(start,start+260);
   assert.match(block,/uid!==OWNER_ID\|\|event.actorId!==OWNER_ID/);
 }
});
test("legacy publication dispatch remains scoped to first man",()=>{
 const legacy=read("src/owner_anketa.js");
 assert.match(legacy,/const ACTIVE_ACCOUNT = "yan_first"/);
 const workflow=read(".github/workflows/intimcity-profile-lookup.yml");
 assert.ok(!workflow.includes("man_setup_draft"));
 assert.ok(!workflow.includes("man_setup_history"));
});
test("new setup cannot activate or set credentials",()=>{
 const source=read("src/man_setup_store.js");
 assert.match(source,/action!=="plan"&&action!=="reset"/);
 assert.match(source,/if\(accountId==="yan_first"\)throw Error/);
 assert.ok(!source.includes("PROXY_PASSWORD"));
 assert.ok(!source.includes("INTIMCITY_PASSWORD"));
 const registry=read("src/man_admin_registry.js");
 assert.ok(!registry.includes("PROXY_PASSWORD"));
 assert.ok(!registry.includes("INTIMCITY_PASSWORD"));
});
test("feature tests do not deploy Worker or access secrets",()=>{
 const ci=read(".github/workflows/multi-man-foundation-tests.yml");
 assert.match(ci,/feature\/yan-multiaccount-foundation/);
 assert.ok(!/wrangler[^\n]*deploy/i.test(ci));
 assert.ok(!/secrets\.[A-Z_]+/.test(ci));
 assert.ok(!ci.includes("INTIMCITY_LOGIN"));
});
