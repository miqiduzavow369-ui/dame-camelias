import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
const adapter=fs.readFileSync("tools/secondary_man_profile_readonly.py","utf8");
const base={
 mode:"profile",proxyHost:"176.56.35.167",proxyPort:6408,
 proxyVersion:2,siteVersion:3,siteUrl:"https://b.intimcity.rip/",
 expectedIp:"176.56.35.167",proxyUsername:"user",proxyPassword:"placeholder",
 siteLogin:"login",sitePassword:"placeholder"
};
test("shared secondary browser adapter uses original Yan profile search in read-only mode",()=>{
 assert.match(adapter,/from intimcity_profile_lookup import inspect/);
 assert.match(adapter,/return inspect\(str\(profile_id\), "ratings"\)/);
 assert.doesNotMatch(adapter,/inspect\([^\n]+,\s*["'](?:publish|review_publish)["']/);
 assert.match(adapter,/legacy\.OWNER_HOST = host/);
 assert.match(adapter,/finally:/);
 assert.match(adapter,/SECONDARY_ID/);
});
test("all secondary accounts accept their OWN read-only grants; spoofed identities reject",()=>{
 const input=JSON.stringify({ids:["yan_second",...Array.from({length:28},(_,i)=>"yan_"+String(i+3).padStart(2,"0"))],base});
 const code=`import json,sys
sys.path.insert(0,"tools")
from secondary_man_profile_readonly import validated_readonly_grant
d=json.load(sys.stdin)
for account in d["ids"]:
  g=dict(d["base"],accountId=account)
  assert validated_readonly_grant(g,account,"2468")=="b.intimcity.rip"
  for wrong in ("yan_first","yan_02","yan_31"):
    try:validated_readonly_grant(g,wrong,"2468")
    except RuntimeError:pass
    else:raise AssertionError("cross-account grant accepted")
  for key,value in (("mode","publish"),("proxyPort",0),("siteUrl","https://example.com/"),("proxyVersion",0)):
    x=dict(g,**{key:value})
    try:validated_readonly_grant(x,account,"2468")
    except (RuntimeError,ValueError):pass
    else:raise AssertionError("untrusted grant accepted")
print("29-account-read-only-contract-ok")`;
 const result=spawnSync("python3",["-c",code],{input,encoding:"utf8"});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/29-account-read-only-contract-ok/);
});
