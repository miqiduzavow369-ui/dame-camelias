"""Single owner-confirmed authentic review attempt, with independent read-only proof.

Never retries an ambiguous POST. The caller must secure a permanent atomic claim,
then issue exactly one private text grant before invoking this mode.
"""
import os
import re
from urllib.parse import urlparse
from review_text_entry import stage_review_text
from review_proof_capture import capture_review_proof

def run_review(ctx, pid, host, mode, approved_text, report_stage=None):
    if mode not in ("review_publish","review_proof"):
        raise ValueError("Unsupported review mode")
    if not re.fullmatch(r"\d{1,9}",str(pid)) or not re.fullmatch(r"[a-z0-9-]+\.intimcity\.rip",host):
        raise ValueError("Invalid review target")
    if not isinstance(approved_text,str) or not 10<=len(approved_text)<=3000:
        raise ValueError("Invalid private review")
    # Existing public entry is checked first. No submission if it is already found.
    previous=capture_review_proof(ctx,host,pid,approved_text)
    if previous:
        return {"attempted":False,"confirmed":True,"proof":previous,"already_exists":True}
    if mode=="review_proof":
        return {"attempted":False,"confirmed":False,"proof":None}
    page=ctx.new_page()
    attempted=False
    try:
        page.goto(f"https://{host}/indi/anketa{pid}.htm",wait_until="domcontentloaded",timeout=45000)
        parsed=urlparse(page.url)
        if parsed.scheme!="https" or parsed.hostname!=host or parsed.path!=f"/indi/anketa{pid}.htm":
            raise RuntimeError("Unexpected review form destination")
        field=page.locator('textarea[name="personcomment"]')
        if field.count()!=1 or not field.is_visible():
            raise RuntimeError("New review field unavailable")
        form=field.locator("xpath=ancestor::form[1]")
        if form.count()!=1 or form.get_attribute("method").lower()!="post":
            raise RuntimeError("Review form invalid")
        action=form.get_attribute("action") or ""
        dest=urlparse(action)
        if dest.scheme!="https" or dest.hostname!=host or dest.path!=f"/indi/anketa{pid}.htm":
            raise RuntimeError("Unexpected review submit target")
        submit=form.locator('input[name="submit"][type="submit"]')
        if submit.count()!=1 or not submit.is_visible():
            raise RuntimeError("Submit button unavailable")
        stage_review_text(page,approved_text)
        if field.input_value()!=approved_text:
            raise RuntimeError("Approved review not preserved")
        # The durable stage audit MUST succeed before any external POST.
        # If it fails, the site submit is never clicked.
        if not callable(report_stage):
            raise RuntimeError("Missing mandatory submission audit")
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
    except Exception:
        if attempted:
            return {"attempted":True,"confirmed":False,"proof":None}
        raise
    finally:
        page.close()
