#!/usr/bin/env python3
"""A new man's PREPUBLICATION dry-fill using Yan First's exact Chromium engine.

Never submit a form, reserve credits, or fall back to the first man's account.
"""
import json
import os
import re
import sys
from urllib.parse import urlencode,urlsplit,urlunsplit
from urllib.request import Request,urlopen

ACCOUNT=re.compile(r"^(?:yan_second|yan_(?:0[3-9]|[12][0-9]|30))$")
ID=re.compile(r"^\d{5,16}$")
PROFILE=re.compile(r"^\d{1,9}$")
NONCE=re.compile(r"^[a-f0-9]{12}$")

def required(key):
    val=os.environ.get(key)
    if not val:raise RuntimeError("Runner configuration missing")
    return val

def call(path,*,data=None,params=None):
    u=urlsplit(required("ANKETA_CALLBACK_URL"))
    if u.scheme!="https" or u.path!="/api/anketa/result" or not u.hostname or u.username or u.password or u.port:
        raise RuntimeError("Invalid callback origin")
    url=urlunsplit(("https",u.netloc,path,"",""))
    if params:url+="?"+urlencode(params)
    body=json.dumps(data).encode() if data is not None else None
    headers={"Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),
             "Accept":"application/json","User-Agent":"DameCameliasDryfill/1.0"}
    if body is not None:headers["Content-Type"]="application/json"
    with urlopen(Request(url,data=body,headers=headers,method="POST" if body is not None else "GET"),timeout=25) as resp:
        if resp.status!=200:raise RuntimeError("Dryfill coordinator rejected request")
        return json.loads(resp.read(800000).decode())

def main():
    account,uid,pid,nonce,host=(required(x) for x in (
        "SECONDARY_ACCOUNT_ID","SECONDARY_USER_ID","SECONDARY_PROFILE_ID",
        "SECONDARY_DRYFILL_NONCE","SECONDARY_SITE_HOST"))
    if not ACCOUNT.fullmatch(account) or not ID.fullmatch(uid) or not PROFILE.fullmatch(pid) or not NONCE.fullmatch(nonce):
        raise RuntimeError("Account-bound dryfill identifiers invalid")
    if host not in ("a.intimcity.rip","b.intimcity.rip","c.intimcity.rip"):
        raise RuntimeError("Untrusted personal site host")
    grant=call("/api/secondary-man/rating-dryfill-payload",params={
        "account_id":account,"user_id":uid,"profile_id":pid,"nonce":nonce
    })
    if grant.get("ok") is not True or grant.get("mode")!="dryfill" or (
        grant.get("accountId"),grant.get("userId"),grant.get("profileId"),grant.get("nonce")
    )!=(account,uid,pid,nonce) or urlsplit(grant.get("siteUrl","")).hostname!=host:
        raise RuntimeError("Dryfill grant account mismatch")
    values=grant.get("selections")
    if not isinstance(values,dict) or not isinstance(values.get("selections"),list) or not values["selections"]:
        raise RuntimeError("Dryfill choices missing")
    import intimcity_profile_lookup as legacy
    vars={
        "PROXY_HOST":grant["proxyHost"],"PROXY_PORT":str(grant["proxyPort"]),
        "PROXY_USERNAME":grant["proxyUsername"],"PROXY_PASSWORD":grant["proxyPassword"],
        "EXPECTED_EGRESS_IP":grant["expectedIp"],
        "INTIMCITY_LOGIN":grant["siteLogin"],"INTIMCITY_PASSWORD":grant["sitePassword"],
        "SECONDARY_EXPECTED_SITE_LOGIN":grant["siteLogin"],
        "INTIMCITY_SITE_HOST":host,"ANKETA_DRYFILL_SELECTIONS":json.dumps(values,ensure_ascii=False)
    }
    before={key:os.environ.get(key) for key in vars}
    oldhost=legacy.OWNER_HOST
    verified=False
    try:
        os.environ.update(vars)
        legacy.OWNER_HOST=host
        # The shared engine's dryfill mode audits DOM/serialized fields and
        # explicitly returns WITHOUT invoking form.submit or button.click.
        outcome=legacy.inspect(pid,"dryfill")
        report=outcome.get("dryfill") if isinstance(outcome,dict) else None
        verified=(isinstance(report,dict) and report.get("finalAudit",{}).get("ok") is True
                  and report.get("verified")==len(values["selections"]))
    finally:
        legacy.OWNER_HOST=oldhost
        for key,value in before.items():
            if value is None:os.environ.pop(key,None)
            else:os.environ[key]=value
    response=call("/api/secondary-man/rating-dryfill-result",data={
        "identity":{"userId":uid,"accountId":account,"profileId":pid,
                    "kind":"rating","nonce":"000000000000"},
        "nonce":nonce,"code":"verified" if verified else "failed"
    })
    if response.get("ok") is not True:raise RuntimeError("Dryfill result not accepted")
    print("YAN_SHARED_DRYFILL: "+("verified" if verified else "failed"),flush=True)
    return 0 if verified else 2

if __name__=="__main__":
    try:sys.exit(main())
    except Exception as exc:
        print("YAN_SHARED_DRYFILL: failed "+type(exc).__name__,file=sys.stderr,flush=True)
        sys.exit(1)

