import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const lookup=fs.readFileSync("tools/intimcity_profile_lookup.py","utf8");
const review=fs.readFileSync("tools/review_live_workflow.py","utf8");
const typing=fs.readFileSync("tools/review_text_entry.py","utf8");
const legacyWorkflow=fs.readFileSync(".github/workflows/intimcity-profile-lookup.yml","utf8");
const newLogin=fs.readFileSync("tools/man_site_login_preflight.py","utf8");

// Record actual Yan First browser invariants before any shared-executor refactor.
// These tests assert stage order and safety boundaries, not approval for new accounts.
test("legacy browser verifies its proxy before site login and performs on-site search",()=>{
 const stages=["LOOKUP_STAGE: proxy-egress","LOOKUP_STAGE: open-site","LOOKUP_STAGE: locate-login",
               "LOOKUP_STAGE: search-profile","LOOKUP_STAGE: check-search-count",
               "LOOKUP_STAGE: locate-profile-link","LOOKUP_STAGE: open-profile-tab"];
 let at=-1;
 for(const stage of stages){const next=lookup.indexOf(stage);assert.ok(next>at,`Stage missing or reordered: ${stage}`);at=next;}
 assert.match(lookup,/EXPECTED_EGRESS_IP/);
 assert.match(lookup,/if seen != ipaddress\.ip_address/);
 assert.match(lookup,/input#searchStr\[name="phones"\]/);
 assert.match(lookup,/input#searchPS\[name="phonesearch"\]/);
 assert.match(lookup,/profile_page\.wait_for_load_state\("domcontentloaded"/);
 assert.match(lookup,/Unexpected profile location/);
});
test("approved review is filled in two parts on one page without reload or duplicate submit",()=>{
 assert.match(typing,/field\.fill\(first\)/);
 assert.match(typing,/field\.press\("End"\)/);
 assert.match(typing,/field\.type\(second, delay=0\)/);
 assert.match(typing,/field\.input_value\(\) != approved_text/);
 assert.doesNotMatch(typing,/\b(?:page|field)\.(?:reload|goto)\(/);
 assert.doesNotMatch(typing,/\.click\(/);
 assert.match(review,/Verified search-result profile tab required/);
 assert.match(review,/report_stage\("review_submit_boundary"\)/);
 assert.equal((review.match(/submit\.click\(/g)||[]).length,1);
 assert.match(review,/One external POST, never automatically repeat it on timeout/);
});
test("legacy workflow secrets are not confused with per-man secure credential claims",()=>{
 assert.match(legacyWorkflow,/PROXY_HOST: \$\{\{ secrets\.PROXY_HOST \}\}/);
 assert.match(legacyWorkflow,/INTIMCITY_LOGIN: \$\{\{ secrets\.INTIMCITY_LOGIN \}\}/);
 assert.match(newLogin,/account_id/);
 assert.match(newLogin,/\/api\/man-site-login\/payload/);
 assert.match(newLogin,/details\["accountId"\]|details\.get\("accountId"\)/);
 assert.match(newLogin,/str\(ip\)!=details\["expectedIp"\]/);
});
