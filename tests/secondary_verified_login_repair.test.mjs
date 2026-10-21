import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("owner-side identity repair only from the existing trusted completed login verification",()=>{
 const src=fs.readFileSync("src/man_site_login_preflight.js","utf8");
 const f=src.slice(src.indexOf("export async function restoreVerifiedSiteIdentity("));
 assert.ok(f.includes('run.code!=="login_authenticated_identity_verified"'));
 assert.ok(f.includes('run.claimed!==true'));
 assert.ok(f.includes('run.proxyVersion!==proxy?.version'));
 assert.ok(f.includes('run.siteVersion!==site?.version'));
 assert.ok(f.includes('site.boundProxyVersion!==proxy.version'));
 assert.ok(f.includes('browser.status!=="verified"'));
 assert.ok(f.includes('approvalMatchesConfiguration('));
 assert.ok(f.includes('tx.put("secondary-site-identity-v1:"+accountId'));
 assert.ok(!f.includes("fetch("));
 assert.ok(!f.includes("reserveSecondaryFeedbackCredit("));
});
test("no client UI, secondary user grant, or Yan First route changed",()=>{
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const start=runtime.indexOf('if(event.kind==="secondary_publication_account_snapshot"');
 const end=runtime.indexOf('if(event.kind==="secondary_catalog_cabinet_ready")',start);
 const block=runtime.slice(start,end);
 assert.ok(block.includes('if(uid!==OWNER_ID)return {ok:false,status:403};'));
 assert.ok(block.includes('restoreVerifiedSiteIdentity(storage,rawEnv,accountId,OWNER_ID)'));
 assert.ok(block.includes('if(accountId==="yan_first"'));
 assert.ok(block.includes('storage.get("secondary-site-identity-v1:"+accountId)'));
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 assert.ok(html.includes('send.textContent="✅ Отправить отзыв"'));
});
