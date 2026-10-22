#!/usr/bin/env python3
"""Reuse Yan First's exact browser profile-search flow for a secondary man.

Read-only adapter. The caller must obtain an account-bound, one-use grant from
an authenticated server. This script never dispatches itself, never submits a
rating/review, and never falls back to the legacy Yan First credentials.
"""
import ipaddress
import os
import re
import json
from urllib.parse import urlsplit

SECONDARY_ID = re.compile(r"^(?:yan_second|yan_(?:0[3-9]|[12][0-9]|30))$")
PROFILE = re.compile(r"^[0-9]{1,9}$")
SAFE_HOSTS = {"intimcity.rip", "a.intimcity.rip", "b.intimcity.rip","c.intimcity.rip"}

def validated_readonly_grant(grant, account_id, profile_id, *, expected_mode="profile"):
    if not isinstance(grant, dict) or not SECONDARY_ID.fullmatch(account_id):
        raise RuntimeError("Secondary account authorization unavailable")
    if not PROFILE.fullmatch(str(profile_id)):
        raise RuntimeError("Invalid profile")
    if grant.get("accountId") != account_id or grant.get("mode") != expected_mode:
        raise RuntimeError("Account-bound read-only grant required")
    if expected_mode not in ("profile", "dryfill", "publish") or (expected_mode == "dryfill" and grant.get("profileId") != str(profile_id)):
        raise RuntimeError("Unsupported or unbound browser grant")
    if type(grant.get("proxyPort")) is not int or not 1 <= grant["proxyPort"] <= 65535 or not isinstance(grant.get("proxyHost"), str):
        raise RuntimeError("Invalid pinned proxy port")
    if not grant.get("proxyVersion") or not grant.get("siteVersion"):
        raise RuntimeError("Pinned configuration versions required")
    url = urlsplit(grant.get("siteUrl", ""))
    if url.scheme != "https" or url.hostname not in SAFE_HOSTS or url.username or url.password or url.port:
        raise RuntimeError("Untrusted Intimcity destination")
    ipaddress.ip_address(grant.get("expectedIp", ""))
    for key in ("proxyUsername","proxyPassword","siteLogin","sitePassword"):
        if not isinstance(grant.get(key), str) or not grant[key]:
            raise RuntimeError("Incomplete personal credentials")
    if not isinstance(grant.get("proxyHost"), str) or not re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", grant["proxyHost"]):
        raise RuntimeError("Invalid proxy host")
    return url.hostname

def run_readonly_profile_check(grant, account_id, profile_id, *, mode="ratings", selections=None):
    if mode not in ("ratings", "dryfill"):
        raise RuntimeError("Read-only secondary browser mode required")
    if mode == "dryfill":
        if grant.get("mode") != "dryfill" or grant.get("profileId") != str(profile_id):
            raise RuntimeError("Account-bound dryfill grant required")
        if not isinstance(selections, dict) or not isinstance(selections.get("selections"), list) or not 1 <= len(selections["selections"]) <= 120 or type(selections.get("metElsewhere", False)) is not bool:
            raise RuntimeError("Invalid dryfill payload")
        for item in selections["selections"]:
            if not isinstance(item, dict) or type(item.get("index")) is not int or item["index"] < 0 or item["index"] >= 120 or not isinstance(item.get("label"), str) or not isinstance(item.get("value"), str):
                raise RuntimeError("Invalid dryfill selection")
        if len({item["index"] for item in selections["selections"]}) != len(selections["selections"]):
            raise RuntimeError("Duplicate field index")
    elif grant.get("mode") != "profile":
        raise RuntimeError("Account-bound profile grant required")
    host = validated_readonly_grant(grant, account_id, profile_id, expected_mode="dryfill" if mode == "dryfill" else "profile")
    # Exact same site-search, result-card click, verified profile tab and login
    # selectors as Yan First; no independent duplicate browser implementation.
    from intimcity_profile_lookup import inspect
    names = {
        "PROXY_HOST": grant["proxyHost"],
        "PROXY_PORT": str(grant["proxyPort"]),
        "PROXY_USERNAME": grant["proxyUsername"],
        "PROXY_PASSWORD": grant["proxyPassword"],
        "EXPECTED_EGRESS_IP": grant["expectedIp"],
        "INTIMCITY_LOGIN": grant["siteLogin"],
        "SECONDARY_EXPECTED_SITE_LOGIN": grant["siteLogin"],
        "INTIMCITY_PASSWORD": grant["sitePassword"],
        "INTIMCITY_SITE_HOST": host
    }
    if mode == "dryfill":
        names["ANKETA_DRYFILL_SELECTIONS"] = json.dumps(selections, ensure_ascii=False)
    saved = {key:os.environ.get(key) for key in names}
    try:
        os.environ.update(names)
        # The legacy module resolves OWNER_HOST at import time. We explicitly
        # match the verified grant host instead of inheriting Yan's default.
        import intimcity_profile_lookup as legacy
        previous_host = legacy.OWNER_HOST
        legacy.OWNER_HOST = host
        try:
            if mode == "ratings":
                return inspect(str(profile_id), "ratings")
            return inspect(str(profile_id), "dryfill")
        finally:
            legacy.OWNER_HOST = previous_host
    finally:
        for key,value in saved.items():
            if value is None: os.environ.pop(key,None)
            else: os.environ[key]=value

