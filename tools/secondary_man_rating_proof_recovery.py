"""Read an already-posted personal rating. Never call a publication mode."""
import os
from urllib.parse import urlsplit
from secondary_man_rating_job import ACCOUNT, USER, PROFILE, NONCE, TOKEN, required, call
from secondary_man_result_signing import result_signing_key, build_rating_result

def main():
    account, uid, pid, nonce, ticket, host = (required(k) for k in (
        "SECONDARY_ACCOUNT_ID", "SECONDARY_USER_ID", "SECONDARY_PROFILE_ID",
        "SECONDARY_RATING_NONCE", "SECONDARY_CALLBACK_TICKET", "SECONDARY_SITE_HOST"))
    if not ACCOUNT.fullmatch(account) or not USER.fullmatch(uid) or not PROFILE.fullmatch(pid) or not NONCE.fullmatch(nonce) or not TOKEN.fullmatch(ticket):
        raise RuntimeError("Invalid proof recovery identifiers")
    grant = call("/api/secondary-man/rating-proof-recovery", query={
        "account_id": account, "user_id": uid, "profile_id": pid, "nonce": nonce, "callback_ticket": ticket})
    target = urlsplit(grant.get("siteUrl", ""))
    if (grant.get("ok") is not True or grant.get("mode") != "proof-recovery" or grant.get("readOnly") is not True or
        any(grant.get(k) != v for k,v in (("accountId",account),("userId",uid),("profileId",pid),("nonce",nonce))) or
        host not in ("a.intimcity.rip","b.intimcity.rip","c.intimcity.rip") or target.scheme != "https" or
        target.hostname != host or target.username or target.password or target.port or
        str(grant.get("siteLogin", "")).casefold() != str(grant.get("verifiedSiteLogin", "")).casefold()):
        raise RuntimeError("Read-only proof recovery grant mismatched")
    result_signing_key(grant)  # Before opening a browser or using credentials.
    from intimcity_profile_lookup import inspect
    import intimcity_profile_lookup as legacy
    values = {"PROXY_HOST":grant["proxyHost"], "PROXY_PORT":str(grant["proxyPort"]),
        "PROXY_USERNAME":grant["proxyUsername"], "PROXY_PASSWORD":grant["proxyPassword"],
        "EXPECTED_EGRESS_IP":grant["expectedIp"], "INTIMCITY_LOGIN":grant["siteLogin"],
        "INTIMCITY_PASSWORD":grant["sitePassword"], "INTIMCITY_SITE_HOST":host,
        "SECONDARY_EXPECTED_SITE_LOGIN":grant["verifiedSiteLogin"], "SECONDARY_RATING_ACCOUNT_ID":account}
    previous = {k:os.environ.get(k) for k in values}
    previous_host = legacy.OWNER_HOST
    try:
        os.environ.update(values)
        legacy.OWNER_HOST = host
        result = inspect(pid, "secondary_rating_proof")
    finally:
        legacy.OWNER_HOST = previous_host
        for k,v in previous.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v
    payload = build_rating_result(grant, result.get("proof") if isinstance(result,dict) else None)
    response = call("/api/secondary-man/result", payload)
    if response.get("ok") is not True or response.get("status") != "completed":
        raise RuntimeError("Read-only proof recovery not fully settled")
    print("SECONDARY_RATING_RECOVERY: original proof archived; existing operation completed; no rating resubmitted", flush=True)
    return 0

if __name__ == "__main__":
    import sys
    try: sys.exit(main())
    except Exception as exc:
        print("SECONDARY_RATING_RECOVERY: unavailable; " + type(exc).__name__, file=sys.stderr, flush=True)
        sys.exit(1)
