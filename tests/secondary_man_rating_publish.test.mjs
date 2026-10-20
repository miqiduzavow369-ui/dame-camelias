import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

test("account-pinned publication adapter reuses legacy publish only after consumed grant",()=>{
const script=String.raw`
import os,sys,types
sys.path.insert(0,"tools")
from secondary_man_rating_publish import run_secondary_rating_publish
legacy=types.ModuleType("intimcity_profile_lookup")
legacy.OWNER_HOST="intimcity.rip"
calls=[]
def inspect(profile,mode):
    calls.append((profile,mode,legacy.OWNER_HOST,os.environ.get("INTIMCITY_LOGIN")))
    return {"publication":{"attempted":True,"confirmed":True}}
legacy.inspect=inspect
sys.modules["intimcity_profile_lookup"]=legacy
base={"accountId":"yan_second","mode":"publish","kind":"rating",
 "profileId":"2468","nonce":"abcdef123456","status":"attempted",
 "oneUseClaimConsumed":True,"ownerOperationConfirmed":True,
 "independentAuthorConfirmed":True,"creditReserved":True,
 "callbackTicket":"a"*32,"proxyHost":"proxy.example","proxyPort":8000,
 "proxyUsername":"proxy-user","proxyPassword":"proxy-pass",
 "expectedIp":"127.0.0.1","proxyVersion":2,"siteVersion":3,
 "siteUrl":"https://b.intimcity.rip/",
 "siteLogin":"mikhail","sitePassword":"site-pass",
 "selections":{"selections":[{"index":0,"label":"Photo","value":"yes"}],
 "metElsewhere":False}}
for patch in [{"ownerOperationConfirmed":False},{"oneUseClaimConsumed":False},
              {"creditReserved":False},{"mode":"dryfill"},
              {"callbackTicket":"invalid"},{"accountId":"yan_03"},
              {"status":"prepared"},{"siteUrl":"https://evil.example/"}]:
    try:run_secondary_rating_publish({**base,**patch},"yan_second","2468")
    except RuntimeError:pass
    else:raise AssertionError("untrusted grant accepted")
assert calls==[]
os.environ["INTIMCITY_LOGIN"]="original"
out=run_secondary_rating_publish(base,"yan_second","2468")
assert calls==[("2468","publish","b.intimcity.rip","mikhail")]
assert out["attempted"] and out["siteAcknowledged"] and not out["published"]
assert out["requiresProofAndSettlement"]
assert os.environ["INTIMCITY_LOGIN"]=="original"
assert "ANKETA_DRYFILL_SELECTIONS" not in os.environ
assert legacy.OWNER_HOST=="intimcity.rip"
try:run_secondary_rating_publish(base,"yan_first","2468")
except RuntimeError:pass
else:raise AssertionError("Yan First route accessed")
print("publication grant and legacy reuse assertions passed")
`;
const result=spawnSync("python3",["-c",script],{encoding:"utf8"});
assert.equal(result.status,0,result.stderr||result.stdout);
assert.match(result.stdout,/assertions passed/);
});
