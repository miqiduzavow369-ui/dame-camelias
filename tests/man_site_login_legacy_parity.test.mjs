import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const legacy=fs.readFileSync("tools/intimcity_profile_lookup.py","utf8");
const next=fs.readFileSync("tools/man_site_login_preflight.py","utf8");
const coordinator=fs.readFileSync("src/man_site_login_preflight.js","utf8");
test("site login mirrors proven Yan First form fields",()=>{
 for(const selector of ['input[name="login"][placeholder="E-mail"]',
  'input[name="password"][type="password"]', 'input[type="submit"]']){
  assert.ok(legacy.includes(selector));assert.ok(next.includes(selector));
 }
 assert.match(next,/for form in page.locator\("form"\).all\(\)/);
 assert.match(next,/pw.first.press\("Enter"\)/);
});
test("successful login evidence does not certify identity or enable publications",()=>{
 assert.match(next,/logout or \(account and not password_visible\)/);
 assert.match(next,/login_authenticated_identity_unconfirmed/);
 assert.match(coordinator,/login_authenticated_identity_unconfirmed/);
 assert.match(coordinator,/siteIdentityVerified:false,canPublish:false/);
 assert.doesNotMatch(next,/submit.click\(timeout=15000\)/);
});
