#!/usr/bin/env python3
"""Strict secondary-man review grant validation and read-only execution boundary.

This module deliberately does not submit a review. The authenticated coordinator,
one-use secret grant, original proof, callback and ledger integration must be
wired and verified before a live POST can be enabled. Yan First is never used.
"""
import hashlib
import hmac
import re
from secondary_man_profile_readonly import validated_readonly_grant

TICKET = re.compile(r"^[a-f0-9]{32}$")
NONCE = re.compile(r"^[a-f0-9]{12,32}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")


def validate_secondary_review_grant(grant, account_id, profile_id, approved_text):
    """Validate an account-pinned, already claimed, moderator-approved review.

    Return the pinned site host, but never grant site-submit authority.
    """
    host = validated_readonly_grant(grant, account_id, profile_id,
                                    expected_mode="publish")
    if grant.get("accountId") != account_id or grant.get("profileId") != str(profile_id):
        raise RuntimeError("Review account or profile mismatch")
    if grant.get("kind") != "review" or grant.get("status") != "attempted":
        raise RuntimeError("Review publication not claimed")
    for field in ("oneUseClaimConsumed", "ownerOperationConfirmed",
                  "independentAuthorConfirmed", "moderatorApproved",
                  "creditReserved", "siteIdentityVerified"):
        if grant.get(field) is not True:
            raise RuntimeError("Review prerequisite missing")
    if (not isinstance(grant.get("nonce"), str) or
            not NONCE.fullmatch(grant["nonce"]) or
            not isinstance(grant.get("callbackTicket"), str) or
            not TICKET.fullmatch(grant["callbackTicket"])):
        raise RuntimeError("Invalid one-use callback identification")
    if (not isinstance(approved_text, str) or
            not 10 <= len(approved_text) <= 3000 or
            approved_text != approved_text.strip()):
        raise RuntimeError("Invalid independently approved review text")
    expected_hash = grant.get("approvedTextSha256")
    actual_hash = hashlib.sha256(approved_text.encode("utf-8")).hexdigest()
    if (not isinstance(expected_hash, str) or
            not SHA256.fullmatch(expected_hash) or
            not hmac.compare_digest(expected_hash, actual_hash)):
        raise RuntimeError("Review content not bound to approved grant")
    if grant.get("siteLogin") != grant.get("verifiedSiteLogin"):
        raise RuntimeError("Site identity does not match the selected man")
    return host


def review_preflight_status(grant, account_id, profile_id, approved_text):
    """Pure authorization check; no browser launch and no external POST."""
    host = validate_secondary_review_grant(
        grant, account_id, profile_id, approved_text)
    return {"accountId": account_id, "profileId": str(profile_id),
            "siteHost": host, "reviewBound": True,
            "siteSubmitted": False, "publicationEnabled": False,
            "reason": "trusted_review_runner_and_result_settlement_not_connected"}
