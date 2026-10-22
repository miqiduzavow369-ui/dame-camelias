#!/usr/bin/env python3
"""One-shot, account-locked, private-secondary-rating executor.

Never fall back to Yan First; an ambiguous site submission cannot be retried.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from secondary_man_rating_publish import validate_publish_grant
from secondary_man_result_signing import result_signing_key, build_rating_result

ACCOUNT=re.compile(r"^(?:yan_second|yan_(?:0[3-9]|[12][0-9]|30))$")
USER=re.compile(r"^\d{5,16}$")
PROFILE=re.compile(r"^\d{1,9}$")
NONCE=re.compile(r"^[a-f0-9]{12}$")
TOKEN=re.compile(r"^[a-f0-9]{32}$")

def required(key):
    x=os.environ.get(key)
    if not x:raise RuntimeError("Runner configuration missing")
    return x

def endpoint(path):
    parsed=urlsplit(required("ANKETA_CALLBACK_URL"))
    if parsed.scheme!="https" or parsed.path!="/api/anketa/result" or not parsed.hostname or parsed.username or parsed.password or parsed.port:
        raise RuntimeError("Untrusted callback endpoint")
    return urlunsplit(("https",parsed.netloc,path,"",""))

def call(path,payload=None,query=None):
    address=endpoint(path)+(("?"+urlencode(query)) if query else "")
    data=json.dumps(payload,ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers={"Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),
             "Accept":"application/json","User-Agent":"DameCameliasSecondaryRating/1.0"}
    if data is not None:headers["Content-Type"]="application/json"
    req=Request(address,data=data,headers=headers,method="POST" if data is not None else "GET")
    with urlopen(req,timeout=25) as response:
        if response.status!=200:raise RuntimeError("Runner coordinator rejected operation")
        return json.loads(response.read(950000).decode("utf-8"))

def main():
    account=required("SECONDARY_ACCOUNT_ID")
    uid=required("SECONDARY_USER_ID")
    pid=required("SECONDARY_PROFILE_ID")
    nonce=required("SECONDARY_RATING_NONCE")
    ticket=required("SECONDARY_CALLBACK_TICKET")
    host=required("SECONDARY_SITE_HOST")
    if not ACCOUNT.fullmatch(account) or not USER.fullmatch(uid) or not PROFILE.fullmatch(pid) or not NONCE.fullmatch(nonce) or not TOKEN.fullmatch(ticket):
        raise RuntimeError("Invalid personal rating identifiers")
    if host not in ("a.intimcity.rip","b.intimcity.rip","c.intimcity.rip"):
        raise RuntimeError("Untrusted personal host")
    grant=call("/api/secondary-man/rating-payload",query={
        "account_id":account,"user_id":uid,"profile_id":pid,
        "nonce":nonce,"callback_ticket":ticket})
    if validate_publish_grant(grant,account,pid)!=host or grant.get("userId")!=uid or grant.get("nonce")!=nonce or grant.get("callbackTicket")!=ticket:
        raise RuntimeError("Private rating grant mismatched")
    if grant.get("siteIdentityVerified") is not True or str(grant.get("verifiedSiteLogin","")).casefold()!=str(grant.get("siteLogin","")).casefold() or grant.get("siteUrl") is None:
        raise RuntimeError("Authenticated site identity missing")
    result_signing_key(grant)  # Fail before any site action if signing is unavailable.
    print("SECONDARY_RATING_STAGE: result_signing_ready",flush=True)
    payload=grant["selections"]
    identity={"userId":uid,"accountId":account,"profileId":pid,
              "kind":"rating","nonce":nonce}
    def boundary(stage):
        if stage!="rating_submit_boundary":raise RuntimeError("Unexpected submit stage")
        status=call("/api/secondary-man/rating-stage",{
            "identity":identity,"token":ticket,
            "approvedSelectionsSha256":grant["approvedSelectionsSha256"]})
        if status.get("ok") is not True or status.get("stage")!=stage:
            raise RuntimeError("Single-use pre-submit boundary refused")
        print("SECONDARY_RATING: durable boundary consumed",flush=True)
    from intimcity_profile_lookup import inspect
    import intimcity_profile_lookup as legacy
    vars={
        "PROXY_HOST":grant["proxyHost"],"PROXY_PORT":str(grant["proxyPort"]),
        "PROXY_USERNAME":grant["proxyUsername"],"PROXY_PASSWORD":grant["proxyPassword"],
        "EXPECTED_EGRESS_IP":grant["expectedIp"],"INTIMCITY_LOGIN":grant["siteLogin"],
        "SECONDARY_EXPECTED_SITE_LOGIN":grant["verifiedSiteLogin"],
        "INTIMCITY_PASSWORD":grant["sitePassword"],"INTIMCITY_SITE_HOST":host,
        "SECONDARY_RATING_ACCOUNT_ID":account
    }
    previous={k:os.environ.get(k) for k in vars}
    oldhost=legacy.OWNER_HOST
    try:
        os.environ.update(vars)
        legacy.OWNER_HOST=host
        result=inspect(pid,"publish",secondary_rating_selections=payload,
                       secondary_rating_boundary=boundary)
    finally:
        legacy.OWNER_HOST=oldhost
        for k,v in previous.items():
            if v is None:os.environ.pop(k,None)
            else:os.environ[k]=v
    posted=result.get("publication") if isinstance(result,dict) else None
    if not isinstance(posted,dict) or posted.get("attempted") is not True or posted.get("confirmedBy")!="authenticated-checked-list":
        print("SECONDARY_RATING: outcome uncertain; manual reconciliation required",flush=True)
        return 2
    payload=build_rating_result(grant,posted.get("proof"))
    print("SECONDARY_RATING_STAGE: original_proof_ready",flush=True)
    response=call("/api/secondary-man/result",payload)
    if response.get("ok") is not True or response.get("status")!="completed":
        raise RuntimeError("Verified proof not fully settled")
    print("SECONDARY_RATING: confirmed archived and credit completed",flush=True)
    return 0

if __name__=="__main__":
    try:sys.exit(main())
    except Exception as exc:
        # Never leak proxy credentials/site passwords in traceback or logs.
        print("SECONDARY_RATING: unavailable; "+type(exc).__name__,file=sys.stderr,flush=True)
        sys.exit(1)

