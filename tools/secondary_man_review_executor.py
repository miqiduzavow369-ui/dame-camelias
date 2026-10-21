#!/usr/bin/env python3
"""Secondary account review execution seam; no credential lookup or fallback.

Only a trusted coordinator may supply a pinned and already authenticated page.
Caller is responsible for one-use server claim, durable audit callback and
authenticated result settlement. This module never retries a site submission.
"""
from urllib.parse import urlsplit
from secondary_man_review_publish import validate_secondary_review_grant


def execute_secondary_review(grant, account_id, profile_id, approved_text, *,
                             browser_context, profile_page, authenticated_account,
                             authenticated_site_login, record_submit_boundary):
    """Attempt one review using the original review form implementation.

    `record_submit_boundary` MUST durably audit the claim before a click.
    Result is only diagnostic: it never means proof/credit settlement succeeded.
    """
    host = validate_secondary_review_grant(
        grant, account_id, profile_id, approved_text)
    if (authenticated_account != account_id or
            authenticated_site_login != grant["siteLogin"]):
        raise RuntimeError("Browser account identity mismatch")
    if (browser_context is None or profile_page is None or
            not callable(record_submit_boundary)):
        raise RuntimeError("Trusted browser and durable submission audit required")
    parsed = urlsplit(profile_page.url)
    if (parsed.scheme != "https" or parsed.hostname != host or
            parsed.path != f"/indi/anketa{profile_id}.htm" or
            parsed.username or parsed.password or parsed.port or
            parsed.query or parsed.fragment):
        raise RuntimeError("Verified search-result profile page required")
    # Import only after every identity, URL and grant check has passed.
    from review_live_workflow import run_review

    def audit(stage):
        if stage != "review_submit_boundary":
            raise RuntimeError("Unexpected execution stage")
        result = record_submit_boundary({
            "accountId": account_id, "profileId": str(profile_id),
            "kind": "review", "nonce": grant["nonce"],
            "approvedTextSha256": grant["approvedTextSha256"]
        })
        if result is not True:
            raise RuntimeError("Durable submission audit failed")

    result = run_review(browser_context, str(profile_id), host,
                        "review_publish", approved_text,
                        report_stage=audit, profile_page=profile_page)
    attempted = result.get("attempted") is True if isinstance(result, dict) else False
    return {
        "accountId": account_id, "profileId": str(profile_id),
        "attempted": attempted,
        "proofObserved": bool(result.get("confirmed")) if isinstance(result, dict) else False,
        "published": False, "settled": False,
        "requiresAuthenticatedCallbackAndOriginalProof": True
    }
