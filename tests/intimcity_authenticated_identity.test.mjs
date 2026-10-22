import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";

test("account identity inspector accepts exact authenticated header identity only",()=>{
 const code=String.raw`
import sys
sys.path.insert(0,"tools")
from intimcity_authenticated_identity import authenticated_identity_status, matches_verified_account, observed_authenticated_site_email
class Element:
 def __init__(self,text):self.text=text
 def is_visible(self):return True
 def get_attribute(self,key):return None
 def inner_text(self):return self.text
class Locator:
 def __init__(self,items):self.items=items
 def count(self):return len(self.items)
 def all(self):return self.items
class Page:
 url="https://b.intimcity.rip/"
 def __init__(self,identity,logged_in=True,password=False):
  self.identity=identity
  self.logged_in=logged_in
  self.password=password
 def locator(self,selector):
  if "logout" in selector:return Locator([Element("logout")] if self.logged_in else [])
  if 'password' in selector:return Locator([Element("password")] if self.password else [])
  if selector=='header [data-account-email]':return Locator([Element(self.identity)] if self.identity else [])
  return Locator([])
assert matches_verified_account("owner@example.com"," OWNER@EXAMPLE.COM ")
assert not matches_verified_account("owner@example.com","different@example.com")
for host in ("a.intimcity.rip","b.intimcity.rip","c.intimcity.rip"):
 Page.url="https://"+host+"/"
 assert authenticated_identity_status(Page("OWNER@example.com"),"owner@example.com")=="identity_verified"
 assert observed_authenticated_site_email(Page("OWNER@example.com"),"owner@example.com")=="OWNER@example.com"
 assert authenticated_identity_status(Page("someone@example.com"),"owner@example.com")=="identity_mismatch"
 assert observed_authenticated_site_email(Page("someone@example.com"),"owner@example.com") is None
 assert authenticated_identity_status(Page("owner@example.com",False),"owner@example.com")=="identity_unverified"
 assert authenticated_identity_status(Page("owner@example.com",True,True),"owner@example.com")=="identity_unverified"
 assert authenticated_identity_status(Page(""),"owner@example.com")=="identity_unverified"
for url in ("http://c.intimcity.rip/","https://c.intimcity.rip.evil.test/","https://evil.test/"):
 Page.url=url
 assert authenticated_identity_status(Page("owner@example.com"),"owner@example.com")=="identity_unverified"
 assert observed_authenticated_site_email(Page("owner@example.com"),"owner@example.com") is None
Page.url="https://c.intimcity.rip/"
diagnostics=[]
assert authenticated_identity_status(Page(""),"owner@example.com",lambda *v:diagnostics.append(v))=="identity_unverified"
assert diagnostics==[("identity_unverified","account_email_missing")]
diagnostics=[]
assert authenticated_identity_status(Page("someone@example.com"),"owner@example.com",lambda *v:diagnostics.append(v))=="identity_mismatch"
assert diagnostics==[("identity_mismatch","account_email_mismatch")]
assert "@" not in str(diagnostics)
print("identity-evidence-tests-ok")
`;
 const run=spawnSync("python3",["-c",code],{encoding:"utf8"});
 assert.equal(run.status,0,run.stderr);
 assert.match(run.stdout,/identity-evidence-tests-ok/);
});
test("auth inspector never treats sign-in field contents as proof",()=>{
 const file=fs.readFileSync("tools/intimcity_authenticated_identity.py","utf8");
 assert.match(file,/header \[data-account-email\]/);
 assert.match(file,/form input\[type="password"\]:visible/);
 assert.doesNotMatch(file,/\.fill\(|\.click\(/);
});

