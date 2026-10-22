import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("secondary men use Yan First's browser dryfill before any publication with unchanged UI",()=>{
 const source=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const from=source.indexOf('if(event.kind==="mini_rating_action")');
 const to=source.indexOf('if(event.kind==="mini_rating_open")',from);
 const route=source.slice(from,to);
 assert.ok(route.includes('startSecondaryRatingDryfill(storage,env'));
 assert.ok(route.includes('requireFreshSecondaryRatingDryfill(storage,env'));
 assert.ok(route.indexOf('requireFreshSecondaryRatingDryfill(storage,env,{')<
   route.indexOf('launchApprovedSecondaryRating(storage,env'));
 assert.ok(route.includes('secondary_man_rating_dryfill_payload')===false);
 assert.ok(source.includes('if(event.kind==="secondary_man_rating_dryfill_payload"'));
 assert.ok(source.includes('kind:"secondary_publication_account_version_check"'));
 assert.ok(route.includes('return engine.miniRatingAction('));
 const index=fs.readFileSync("src/index.js","utf8");
 assert.ok(index.includes('/api/secondary-man/rating-dryfill-payload'));
 assert.ok(index.includes('/api/secondary-man/rating-dryfill-result'));
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 new vm.Script(script[1]);
 assert.ok(!html.includes('window.confirm("Подтвердить однократную публикацию выбранных оценок'));
});
test("Yan First's same Chromium inspection is reused and site POST is forbidden in dryfill",()=>{
 const job=fs.readFileSync("tools/secondary_man_rating_dryfill_job.py","utf8");
 const engine=fs.readFileSync("tools/intimcity_profile_lookup.py","utf8");
 assert.ok(job.includes('legacy.inspect(pid,"dryfill")'));
 assert.ok(job.includes('SECONDARY_ACCOUNT_ID'));
 assert.ok(job.includes('SECONDARY_EXPECTED_SITE_LOGIN'));
 assert.ok(job.includes('report.get("finalAudit",{}).get("ok") is True'));
 assert.ok(engine.includes('if mode=="publish":'));
 assert.ok(engine.includes('return {"profile":profile,"catalog":[],"dryfill":report}'));
 assert.ok(fs.readFileSync(".github/workflows/secondary-man-rating-dryfill.yml","utf8")
   .includes("run: python tools/secondary_man_rating_dryfill_job.py"));
});
test("dryfill state is private, expiring, one-use and never reserves credits",()=>{
 const s=fs.readFileSync("src/secondary_man_rating_dryfill.js","utf8");
 assert.ok(s.includes('scope:"selection"'));
 assert.ok(s.includes('row.claimed'));
 assert.ok(s.includes('status:"running"'));
 assert.ok(s.includes('status:"verified"')||s.includes('row.status!=="verified"'));
 assert.ok(s.includes('now-row.completedAt>TTL'));
 assert.ok(s.includes('ready.fingerprint'));
 assert.ok(!s.includes('reserveSecondaryFeedbackCredit('));
 assert.ok(!s.includes('btn.first.click('));
 assert.ok(!s.includes('submit('));
});

