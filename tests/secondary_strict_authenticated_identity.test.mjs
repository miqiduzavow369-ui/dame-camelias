import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("secondary browser operations require exact live authenticated account identity",()=>{
 const legacy=readFileSync("tools/intimcity_profile_lookup.py","utf8");
 const readonly=readFileSync("tools/secondary_man_profile_readonly.py","utf8");
 const publisher=readFileSync("tools/secondary_man_rating_publish.py","utf8");
 const loginGuard=legacy.indexOf('secondary_expected = os.environ.get("SECONDARY_EXPECTED_SITE_LOGIN", "")');
 const authenticated=legacy.indexOf('authenticated_identity_status(page, secondary_expected)');
 const formSearch=legacy.indexOf('print("LOOKUP_STAGE: search-profile")');
 const siteSubmit=legacy.indexOf('btn.first.click(timeout=15000');
 assert.ok(loginGuard>0&&authenticated>loginGuard&&formSearch>authenticated&&siteSubmit>authenticated);
 assert.match(legacy,/if authenticated_identity_status\(page, secondary_expected\) != "identity_verified":\s+raise RuntimeError/);
 assert.match(readonly,/"SECONDARY_EXPECTED_SITE_LOGIN": grant\["siteLogin"\]/);
 assert.match(publisher,/"SECONDARY_EXPECTED_SITE_LOGIN": grant\["siteLogin"\]/);
 assert.match(legacy,/if secondary_expected:/);
 // Yan First's legacy workflow does not set the new opt-in guard.
 const yaml=readFileSync(".github/workflows/intimcity-profile-lookup.yml","utf8");
 assert.doesNotMatch(yaml,/SECONDARY_EXPECTED_SITE_LOGIN/);
});
