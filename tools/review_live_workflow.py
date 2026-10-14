"""Single owner-confirmed authentic review attempt, with independent read-only proof.

Never retries an ambiguous POST. The caller must secure a permanent atomic claim,
then issue exactly one private text grant before invoking this mode.
"""
import os
import re
from urllib.parse import urlparse, urljoin
from review_text_entry import stage_review_text
from review_proof_capture import capture_review_proof

def run_review(ctx, pid, host, mode, approved_text, report_stage=None, profile_page=None):
    if mode not in ("review_publish","review_proof"):
        raise ValueError("Unsupported review mode")
    if not re.fullmatch(r"\d{1,9}",str(pid)) or not re.fullmatch(r"[a-z0-9-]+\.intimcity\.rip",host):
        raise ValueError("Invalid review target")
    if not isinstance(approved_text,str) or not 10<=len(approved_text)<=3000:
        raise ValueError("Invalid private review")
    # Proof-only checks remain strictly read-only.
    if mode=="review_proof":
        proof=capture_review_proof(ctx,host,pid,approved_text)
        return {"attempted":False,"confirmed":bool(proof),"proof":proof,
                "already_exists":bool(proof)}
    # Publish mode starts on the profile tab opened from the search results.
    # Do not leave that tab for "My reviews" until after the single submit.
    # The tab must come from the same search-result click as rating publication.
    # Never silently navigate directly to the profile as a fallback.
    if profile_page is None:
        raise RuntimeError("Verified search-result profile tab required")
    page=profile_page
    attempted=False
    try:
        print("REVIEW_PREFLIGHT: verify-profile-url",flush=True)
        parsed=urlparse(page.url)
        if parsed.scheme!="https" or parsed.hostname!=host or parsed.path!=f"/indi/anketa{pid}.htm":
            raise RuntimeError("Unexpected review form destination")
        print("REVIEW_PREFLIGHT: locate-new-comment-field",flush=True)
        field=page.locator('textarea[name="personcomment"]')
        if field.count()!=1 or not field.is_visible():
            raise RuntimeError("New review field unavailable")
        print("REVIEW_PREFLIGHT: locate-form",flush=True)
        form=field.locator("xpath=ancestor::form[1]")
        if form.count()!=1 or form.get_attribute("method").lower()!="post":
            raise RuntimeError("Review form invalid")
        action=form.get_attribute("action") or ""
        # HTML form actions can be relative; browser resolves against current page.
        dest=urlparse(urljoin(page.url,action))
        print("REVIEW_PREFLIGHT: validate-submit-action",flush=True)
        if dest.scheme!="https" or dest.hostname!=host or dest.path!=f"/indi/anketa{pid}.htm":
            raise RuntimeError("Unexpected review submit target")
        print("REVIEW_PREFLIGHT: locate-submit-button",flush=True)
        submit=form.locator('input[name="submit"][type="submit"]')
        if submit.count()!=1 or not submit.is_visible():
            raise RuntimeError("Submit button unavailable")
        print("REVIEW_PREFLIGHT: enter-approved-text",flush=True)
        stage_review_text(page,approved_text)
        print("REVIEW_PREFLIGHT: verify-approved-text",flush=True)
        if field.input_value()!=approved_text:
            raise RuntimeError("Approved review not preserved")
        # The durable stage audit MUST succeed before any external POST.
        # If it fails, the site submit is never clicked.
        if not callable(report_stage):
            raise RuntimeError("Missing mandatory submission audit")
        print("REVIEW_PREFLIGHT: audit-boundary",flush=True)
        report_stage("review_submit_boundary")
        # One external POST, never automatically repeat it on timeout.
        attempted=True
        print("REVIEW: one confirmed submission attempt",flush=True)
        try:
            submit.click(timeout=15000,no_wait_after=True)
            page.wait_for_timeout(4000)
        except Exception as exc:
            print("REVIEW: submission uncertain; exception_type="+type(exc).__name__,flush=True)
        for i in range(3):
            try:
                proof=capture_review_proof(ctx,host,pid,approved_text)
                if proof:
                    return {"attempted":True,"confirmed":True,"proof":proof}
            except Exception as exc:
                print("REVIEW: proof not ready; exception_type="+type(exc).__name__,flush=True)
            if i<2:page.wait_for_timeout(3500)
        return {"attempted":True,"confirmed":False,"proof":None}
    except Exception as exc:
        print("REVIEW_PREFLIGHT: failed; exception_type="+type(exc).__name__+"; reason="+str(exc)[:160],flush=True)
        if attempted:
            return {"attempted":True,"confirmed":False,"proof":None}
        raise
    finally:
        # Caller owns this tab; do not close the shared ratings-style context.
        pass
