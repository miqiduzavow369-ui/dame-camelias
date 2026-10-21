#!/usr/bin/env python3
"""Single-attempt secondary review runner. No Yan First fallback.

The Worker issues an atomic one-use account-bound grant; GitHub Actions
provides only identifiers, not site credentials. Every site submission must
first obtain an authenticated server-side durable submit-boundary receipt.
Only genuinely verified owner-comments screenshots are returned as evidence.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import sys
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from secondary_man_review_publish import validate_secondary_review_grant

ACCOUNT=re.compile(r"^(yan_second|yan_(?:0[3-9]|[12][0-9]|30))$")
IDENTIFIER=re.compile(r"^[a-f0-9]{12}$")
TICKET=re.compile(r"^[a-f0-9]{32}$")
PROFILE=re.compile(r"^\d{1,9}$")
USER=re.compile(r"^\d{5,16}$")

def required(key):
    value=os.environ.get(key)
    if not value:
        raise RuntimeError("Missing runner setting")
    return value

def endpoint(path):
    u=urlsplit(required("ANKETA_CALLBACK_URL"))
    if u.scheme!="https" or u.path!="/api/anketa/result" or u.hostname is None or u.username or u.password or u.port:
        raise RuntimeError("Invalid receiver origin")
    return urlunsplit(("https",u.netloc,path,"",""))

def request(path,payload=None,query=None):
    url=endpoint(path)
    if query:
        url+="?"+urlencode(query)
    data=json.dumps(payload,ensure_ascii=False).encode() if payload is not None else None
    headers={"Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),
             "Accept":"application/json","User-Agent":"DameCameliasSecondaryReview/1.0"}
    if data is not None:
        headers["Content-Type"]="application/json"
    req=Request(url,data=data,headers=headers,method="POST" if data is not None else "GET")
    with urlopen(req,timeout=25) as response:
        if response.status!=200:
            raise RuntimeError("Coordinator rejected request")
        return json.loads(response.read(950000).decode("utf-8"))

def main():
    account=required("SECONDARY_ACCOUNT_ID")
    user=required("SECONDARY_USER_ID")
    profile=required("SECONDARY_PROFILE_ID")
    nonce=required("SECONDARY_REVIEW_NONCE")
    token=required("SECONDARY_CALLBACK_TICKET")
    host=required("SECONDARY_SITE_HOST")
    if not ACCOUNT.fullmatch(account) or not USER.fullmatch(user) or not PROFILE.fullmatch(profile) or not IDENTIFIER.fullmatch(nonce) or not TICKET.fullmatch(token):
        raise RuntimeError("Invalid isolated review identifiers")
    if host not in ("intimcity.rip","a.intimcity.rip","b.intimcity.rip"):
        raise RuntimeError("Untrusted site hostname")
    grant=request("/api/secondary-man/review-payload",query={
        "account_id":account,"profile_id":profile,"user_id":user,
        "nonce":nonce,"callback_ticket":token})
    text=grant.get("approvedText")
    pinned=validate_secondary_review_grant(grant,account,profile,text)
    if pinned!=host or grant.get("userId")!=user or grant.get("nonce")!=nonce or grant.get("callbackTicket")!=token:
        raise RuntimeError("Runner identity mismatch")
    print("SECONDARY_REVIEW: one-use grant claimed; account bound",flush=True)
    identity={"userId":user,"accountId":account,"profileId":profile,
              "kind":"review","nonce":nonce}
    def record_boundary(stage):
        if stage!="review_submit_boundary":
            raise RuntimeError("Unexpected submission stage")
        response=request("/api/secondary-man/review-stage",{
            "identity":identity,"token":token,
            "approvedTextSha256":grant["approvedTextSha256"]})
        if response.get("ok") is not True or response.get("stage")!=stage:
            raise RuntimeError("Submission boundary not verified")
        print("SECONDARY_REVIEW: durable submit boundary recorded",flush=True)
        return True

    # Use Yan First's exact verified search/popup/review field implementation,
    # but with this man's own proxy, credentials and independent audit callback.
    from intimcity_profile_lookup import inspect
    import intimcity_profile_lookup as legacy
    overrides={
        "PROXY_HOST":grant["proxyHost"],"PROXY_PORT":str(grant["proxyPort"]),
        "PROXY_USERNAME":grant["proxyUsername"],"PROXY_PASSWORD":grant["proxyPassword"],
        "EXPECTED_EGRESS_IP":grant["expectedIp"],"INTIMCITY_LOGIN":grant["siteLogin"],
        "SECONDARY_EXPECTED_SITE_LOGIN":grant["verifiedSiteLogin"],
        "INTIMCITY_PASSWORD":grant["sitePassword"],"INTIMCITY_SITE_HOST":pinned
    }
    old={k:os.environ.get(k) for k in overrides}
    previous_host=legacy.OWNER_HOST
    try:
        os.environ.update(overrides)
        legacy.OWNER_HOST=pinned
        result=inspect(profile,"review_publish",secondary_review_text=text,
                       secondary_review_boundary=record_boundary)
    finally:
        legacy.OWNER_HOST=previous_host
        for k,v in old.items():
            if v is None:os.environ.pop(k,None)
            else:os.environ[k]=v
    publication=result.get("review_publication") if isinstance(result,dict) else None
    if not isinstance(publication,dict) or publication.get("confirmed") is not True or publication.get("attempted") is not True:
        print("SECONDARY_REVIEW: unverified or uncertain; manual reconciliation required",flush=True)
        return 2
    proof=publication.get("proof")
    if not isinstance(proof,dict) or proof.get("text_verified") is not True or proof.get("mime")!="image/jpeg":
        raise RuntimeError("No authenticated original proof")
    encoded=proof.get("image")
    if not isinstance(encoded,str):
        raise RuntimeError("Original proof absent")
    jpeg=base64.b64decode(encoded,validate=True)
    if not 90<=len(jpeg)<=700000 or not jpeg.startswith(b"\xff\xd8\xff") or not jpeg.endswith(b"\xff\xd9"):
        raise RuntimeError("Invalid original screenshot")
    digest=hashlib.sha256(jpeg).hexdigest()
    file_id="jpeg_"+digest[:40]
    # The site has no independently verified numeric review ID here.
    # An evidence-derived reference is used and never presented as a site ID.
    proof_reference="proof_"+hashlib.sha256(
        (user+":"+account+":"+profile+":"+grant["approvedTextSha256"]+":"+digest).encode()
    ).hexdigest()[:40]
    import time
    issued=int(time.time()*1000)
    fields=["secondary-result-v1",user,account,profile,"review",nonce,
            str(grant["proxyVersion"]),str(grant["siteVersion"]),str(issued),
            "verified_published",proof_reference,file_id]
    message=":".join(fields).encode()
    secret=bytes.fromhex(required("SECONDARY_CALLBACK_HMAC_KEY"))
    if len(secret)!=32:
        raise RuntimeError("Invalid signing key")
    signature=hmac.new(secret,message,hashlib.sha256).hexdigest()
    callback=request("/api/secondary-man/result",{
        "identity":identity,"token":token,
        "input":{"identity":identity,"proxyVersion":grant["proxyVersion"],
                 "siteVersion":grant["siteVersion"],"issuedAt":issued,
                 "status":"verified_published",
                 "sitePublicationId":proof_reference,"proofFileId":file_id},
        "signature":signature,"originalJpegBase64":encoded
    })
    if callback.get("ok") is not True or callback.get("status")!="completed":
        raise RuntimeError("Proof receiver did not confirm immutable evidence")
    print("SECONDARY_REVIEW: verified proof and credit settlement completed",flush=True)
    return 0

if __name__=="__main__":
    try:sys.exit(main())
    except Exception as e:
        # No exception text: urllib/Playwright errors could contain secrets.
        print("SECONDARY_REVIEW: unavailable; "+type(e).__name__,file=sys.stderr,flush=True)
        sys.exit(1)
