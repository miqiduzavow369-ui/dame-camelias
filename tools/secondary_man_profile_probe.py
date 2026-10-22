#!/usr/bin/env python3
"""Secure, read-only secondary-man profile probe. Never publishes or logs credentials."""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from secondary_man_profile_readonly import run_readonly_profile_check

def required(key):
    val=os.environ.get(key,"")
    if not val: raise RuntimeError("Missing runtime configuration")
    return val

def endpoint(path):
    parsed=urllib.parse.urlsplit(required("ANKETA_CALLBACK_URL"))
    if parsed.scheme!="https" or parsed.path!="/api/anketa/result" or not parsed.hostname:
        raise RuntimeError("Invalid callback origin")
    return urllib.parse.urlunsplit(("https",parsed.netloc,path,"",""))

def request_json(url,payload=None):
    headers={"Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),
             "Accept":"application/json","User-Agent":"DameCameliasBot/1.0"}
    if payload is not None:headers["Content-Type"]="application/json"
    req=urllib.request.Request(url,data=json.dumps(payload).encode() if payload is not None else None,
                               headers=headers,method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(req,timeout=25) as response:
        if response.status!=200:raise RuntimeError("Secure probe endpoint rejected")
        return json.loads(response.read(8000).decode("utf8"))

def main():
    account=required("SECONDARY_ACCOUNT_ID")
    profile=required("SECONDARY_PROFILE_ID")
    nonce=required("SECONDARY_PROBE_NONCE")
    site_host=required("SECONDARY_SITE_HOST")
    if not re.fullmatch(r"(yan_second|yan_(?:0[3-9]|[12][0-9]|30))",account) or not re.fullmatch(r"[0-9]{1,9}",profile) or not re.fullmatch(r"[a-f0-9]{32}",nonce):
        raise RuntimeError("Invalid probe identifiers")
    if site_host not in ("intimcity.rip","a.intimcity.rip","b.intimcity.rip","c.intimcity.rip"):
        raise RuntimeError("Invalid host")
    query=urllib.parse.urlencode({"account_id":account,"profile_id":profile,"nonce":nonce})
    grant=request_json(endpoint("/api/secondary-profile-probe/payload")+"?"+query)
    if grant.get("accountId")!=account or grant.get("nonce")!=nonce or grant.get("profileId")!=profile or not grant.get("ok"):
        raise RuntimeError("Account-bound grant mismatch")
    if urllib.parse.urlsplit(grant["siteUrl"]).hostname!=site_host:
        raise RuntimeError("Approved site host mismatch")
    code="browser_failed"
    catalog=[]
    try:
        outcome=run_readonly_profile_check(grant,account,profile)
        found=outcome.get("profile",outcome) if isinstance(outcome,dict) else None
        code="profile_verified" if isinstance(found,dict) and str(found.get("id"))==profile else "profile_unavailable"
        catalog=outcome.get("catalog",[]) if isinstance(outcome,dict) else []
        if not isinstance(catalog,list) or not 1<=len(catalog)<=120:
            catalog=[]
        else:
            catalog=[{"label":str(x.get("label",""))[:110],"group":str(x.get("group",""))[:90],
                      "subgroup":str(x.get("subgroup",""))[:90],
                      "options":x.get("options",[])[:20],
                      "control":x.get("control")} for x in catalog if isinstance(x,dict)]
    except Exception:
        # Playwright exceptions may contain URL or form data; never log details.
        print("PROFILE_PROBE_STAGE: read_only_browser_unavailable",flush=True)
    result=request_json(endpoint("/api/secondary-profile-probe/result"),{
        "account_id":account,"profile_id":profile,"nonce":nonce,"code":code,
        "catalog":catalog if code=="profile_verified" else []})
    if result.get("ok") is not True:raise RuntimeError("Probe result was rejected")
    print("PROFILE_PROBE_RESULT: "+code,flush=True)
    return 0 if code=="profile_verified" else 1

if __name__=="__main__":
    try:sys.exit(main())
    except Exception:
        print("PROFILE_PROBE_RESULT: unavailable",file=sys.stderr)
        sys.exit(1)

