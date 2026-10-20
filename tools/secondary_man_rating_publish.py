#!/usr/bin/env python3
"""Secondary-man, account-pinned publish executor.

This is a library, NOT a CLI or GitHub dispatch endpoint. It can be called only
after an authenticated server provides a consumed, account-bound one-use grant
for a specific owner-approved publication. It never falls back to Yan First.
"""
import json
import os
import re
from secondary_man_profile_readonly import validated_readonly_grant

TICKET=re.compile(r"^[a-f0-9]{32}$")
NONCE=re.compile(r"^[a-f0-9]{12}$")

def validate_publish_grant(grant, account_id, profile_id):
    host=validated_readonly_grant(grant,account_id,profile_id,expected_mode="publish")
    if (grant.get("profileId")!=str(profile_id) or
        grant.get("accountId")!=account_id or
        grant.get("kind")!="rating" or
        grant.get("status")!="attempted" or
        grant.get("oneUseClaimConsumed") is not True or
        grant.get("ownerOperationConfirmed") is not True or
        grant.get("independentAuthorConfirmed") is not True or
        grant.get("creditReserved") is not True or
        not isinstance(grant.get("callbackTicket"),str) or
        not TICKET.fullmatch(grant["callbackTicket"]) or
        not isinstance(grant.get("nonce"),str) or
        not NONCE.fullmatch(grant["nonce"])):
        raise RuntimeError("Publication authorization has not been consumed")
    selections=grant.get("selections")
    if (not isinstance(selections,dict) or
        type(selections.get("metElsewhere",False)) is not bool or
        not isinstance(selections.get("selections"),list) or
        not 1<=len(selections["selections"])<=120):
        raise RuntimeError("Invalid pinned publication selections")
    ids=[]
    for item in selections["selections"]:
        if (not isinstance(item,dict) or type(item.get("index")) is not int or
            not 0<=item["index"]<120 or
            not isinstance(item.get("label"),str) or not item["label"] or
            not isinstance(item.get("value"),str) or not item["value"]):
            raise RuntimeError("Invalid pinned rating entry")
        ids.append(item["index"])
    if len(set(ids))!=len(ids):
        raise RuntimeError("Duplicate rating entry")
    return host

def run_secondary_rating_publish(grant,account_id,profile_id):
    host=validate_publish_grant(grant,account_id,profile_id)
    # Shared DOM/HTML form verification and single submit are implemented in
    # legacy inspect(); no selectors or submission mechanics are duplicated.
    # A caller MUST NOT invoke this more than once for the same consumed grant.
    from intimcity_profile_lookup import inspect
    names={
        "PROXY_HOST":grant["proxyHost"],
        "PROXY_PORT":str(grant["proxyPort"]),
        "PROXY_USERNAME":grant["proxyUsername"],
        "PROXY_PASSWORD":grant["proxyPassword"],
        "EXPECTED_EGRESS_IP":grant["expectedIp"],
        "INTIMCITY_LOGIN":grant["siteLogin"],
        "INTIMCITY_PASSWORD":grant["sitePassword"],
        "INTIMCITY_SITE_HOST":host,
        "ANKETA_DRYFILL_SELECTIONS":json.dumps(grant["selections"],ensure_ascii=False)
    }
    saved={key:os.environ.get(key) for key in names}
    try:
        os.environ.update(names)
        import intimcity_profile_lookup as legacy
        previous_host=legacy.OWNER_HOST
        legacy.OWNER_HOST=host
        try:
            result=inspect(str(profile_id),"publish")
        finally:
            legacy.OWNER_HOST=previous_host
    finally:
        for key,value in saved.items():
            if value is None:os.environ.pop(key,None)
            else:os.environ[key]=value
    publication=result.get("publication") if isinstance(result,dict) else None
    # The result is diagnostic ONLY; proof and credit settlement must be verified
    # through the authenticated receiver and stored original screenshot.
    return {
        "accountId":account_id,"profileId":str(profile_id),
        "attempted":publication.get("attempted") is True if isinstance(publication,dict) else False,
        "siteAcknowledged":publication.get("confirmed") is True if isinstance(publication,dict) else False,
        "published":False,
        "requiresProofAndSettlement":True
    }
