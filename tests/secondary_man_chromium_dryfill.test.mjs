import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

test("secondary Chromium dryfill shares Yan First DOM implementation, never submits, restores credentials",()=>{
 const source=String.raw`
import json, os, sys, types
sys.path.insert(0, "tools")
from secondary_man_profile_readonly import run_readonly_profile_check
legacy=types.ModuleType("intimcity_profile_lookup")
legacy.OWNER_HOST="intimcity.rip"
calls=[]
def inspect(pid,mode):
    calls.append((pid,mode,legacy.OWNER_HOST,json.loads(os.environ["ANKETA_DRYFILL_SELECTIONS"]),os.environ["INTIMCITY_LOGIN"]))
    return {"dryfill":{"verified":1},"publication":None}
legacy.inspect=inspect
sys.modules["intimcity_profile_lookup"]=legacy
g={"accountId":"yan_second","mode":"dryfill","profileId":"2468",
   "proxyHost":"proxy.example","proxyPort":8000,"proxyUsername":"u",
   "proxyPassword":"p","expectedIp":"127.0.0.1","proxyVersion":2,
   "siteVersion":3,"siteUrl":"https://b.intimcity.rip/",
   "siteLogin":"mikhail","sitePassword":"p"}
payload={"selections":[{"index":0,"label":"Тест","value":"Да"}],"metElsewhere":False}
os.environ["INTIMCITY_LOGIN"]="before"
result=run_readonly_profile_check(g,"yan_second","2468",mode="dryfill",selections=payload)
assert result["publication"] is None
assert calls==[("2468","dryfill","b.intimcity.rip",payload,"mikhail")]
assert os.environ["INTIMCITY_LOGIN"]=="before"
assert "ANKETA_DRYFILL_SELECTIONS" not in os.environ
assert legacy.OWNER_HOST=="intimcity.rip"
for mode in ("publish","review_publish"):
    try:run_readonly_profile_check(g,"yan_second","2468",mode=mode,selections=payload)
    except RuntimeError:pass
    else:raise AssertionError("unsafe mode enabled")
try:run_readonly_profile_check(g,"yan_second","2468",mode="dryfill",
    selections={"selections":[payload["selections"][0]]*2,"metElsewhere":False})
except RuntimeError:pass
else:raise AssertionError("duplicate field accepted")
try:run_readonly_profile_check(g,"yan_03","2468",mode="dryfill",selections=payload)
except RuntimeError:pass
else:raise AssertionError("cross-account grant accepted")
print("secondary dryfill assertions passed")
`;
 const result=spawnSync("python3",["-c",source],{encoding:"utf8"});
 assert.equal(result.status,0,result.stderr||result.stdout);
 assert.match(result.stdout,/assertions passed/);
});
