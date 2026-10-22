#!/usr/bin/env python3
"""Isolated personal Chromium login with safe stage diagnostics. No publications."""
import ipaddress
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright
from intimcity_authenticated_identity import authenticated_identity_status, observed_authenticated_site_email

ACCOUNT = re.compile(r"^(yan_second|yan_(?:0[3-9]|[12]\d|30))$")
NONCE = re.compile(r"^[a-f0-9]{32}$")
HOSTS = {"intimcity.rip","a.intimcity.rip","b.intimcity.rip","c.intimcity.rip"}

def required(name):
    value=os.environ.get(name,"")
    if not value: raise RuntimeError("Missing configuration")
    return value

def endpoint(path):
    u=urllib.parse.urlsplit(required("ANKETA_CALLBACK_URL"))
    if u.scheme!="https" or u.path!="/api/anketa/result" or not u.hostname:
        raise RuntimeError("Invalid callback URL")
    return urllib.parse.urlunsplit(("https",u.netloc,path,"",""))

def request_json(url,body=None):
    data=None if body is None else json.dumps(body).encode()
    headers={"Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),
             "Accept":"application/json","User-Agent":"DameCameliasBot/1.0"}
    if data is not None: headers["Content-Type"]="application/json"
    req=urllib.request.Request(url,data=data,headers=headers,method="GET" if data is None else "POST")
    with urllib.request.urlopen(req,timeout=25) as response:
        return json.loads(response.read(6000))

def safe_host(url):
    p=urllib.parse.urlsplit(url)
    return (p.scheme=="https" and bool(p.hostname) and
            (p.hostname=="intimcity.rip" or p.hostname.endswith(".intimcity.rip")) and
            not p.username and not p.password and p.port is None)

LOGIN_FAILURE_CODES = {
    "site_open": "site_open_failed",
    "login_form_scan": "login_form_failed",
    "login_email_fill": "login_fill_failed",
    "login_password_fill": "login_fill_failed",
    "login_submit": "login_submit_failed",
    "login_verify": "login_verify_failed",
    "login_identity_check": "login_identity_failed",
}

class LoginStageError(RuntimeError):
    def __init__(self, stage, error_kind):
        self.stage = stage
        self.error_kind = error_kind
        super().__init__("Personal login stage failed")

def login_step(stage, action):
    # Never print exception messages: they can contain URLs or form values.
    if stage not in LOGIN_FAILURE_CODES:
        raise ValueError("Unknown login stage")
    print("SITE_LOGIN_STAGE: " + stage, flush=True)
    try:
        return action()
    except Exception as exc:
        kind = "timeout" if type(exc).__name__ == "TimeoutError" else "operation_error"
        print("SITE_LOGIN_FAILURE: stage=" + stage + "; kind=" + kind, flush=True)
        raise LoginStageError(stage, kind) from None

def inspect_login(page,site_url,login_value,password_value):
    """Reuse Yan First's site-specific login selectors and verification."""
    login_step("site_open", lambda: page.goto(site_url,wait_until="domcontentloaded",timeout=45000))
    if not safe_host(page.url): return "site_error"
    found=False
    for form in login_step("login_form_scan", lambda: page.locator("form").all()):
        email=form.locator('input[name="login"][placeholder="E-mail"]')
        pw=form.locator('input[name="password"][type="password"]')
        if form.is_visible() and email.count() and pw.count() and email.first.is_visible():
            login_step("login_email_fill", lambda: email.first.fill(login_value))
            login_step("login_password_fill", lambda: pw.first.fill(password_value))
            submit=form.locator('input[type="submit"]')
            if submit.count() and submit.first.is_visible():
                login_step("login_submit", lambda: submit.first.click(timeout=8000))
            else:
                login_step("login_submit", lambda: pw.first.press("Enter"))
            found=True
            break
    if not found: return "login_form_unavailable"
    try:
        page.wait_for_load_state("networkidle",timeout=10000)
    except Exception:
        pass
    login_step("login_verify", lambda: page.wait_for_timeout(2500))
    if not safe_host(page.url): return "site_error"
    logout=page.locator('a[href*="logout"], a[href*="exit"], button:has-text("Выйти"), a:has-text("Выйти"), a:has-text("Выход")').count()>0
    account=page.locator('a:has-text("Личный кабинет"), a:has-text("Мой профиль")').count()>0
    password_visible=any(el.is_visible() for el in page.locator('input[type="password"]').all())
    if logout or (account and not password_visible):
        identity=login_step("login_identity_check", lambda: authenticated_identity_status(page,login_value,
            diagnostic=lambda status,reason: print("SITE_IDENTITY_DIAG: status="+status+"; reason="+reason,flush=True)))
        if identity=="identity_verified":
            return "login_authenticated_identity_verified"
        if identity=="identity_mismatch":
            return "login_identity_mismatch"
        return "login_authenticated_identity_unconfirmed"
    return "login_rejected"

def main():
    account=required("MAN_SITE_ACCOUNT_ID")
    nonce=required("MAN_SITE_NONCE")
    site_host=required("MAN_SITE_HOST")
    if not ACCOUNT.fullmatch(account) or not NONCE.fullmatch(nonce) or site_host not in HOSTS:
        raise RuntimeError("Invalid identifiers")
    query=urllib.parse.urlencode({"account_id":account,"nonce":nonce})
    try:
        details=request_json(endpoint("/api/man-site-login/payload")+"?"+query)
    except urllib.error.HTTPError as exc:
        # Show only a response status, not the URL, response body or credentials.
        response_type=(exc.headers.get("Content-Type","").split(";",1)[0].lower())
        response_kind="json" if response_type=="application/json" else ("html" if response_type=="text/html" else "other")
        marker=exc.headers.get("X-DC-Callback-Handler","")
        handler="worker_token_rejected" if marker=="token_rejected" else "unconfirmed_origin"
        print(f"SITE_LOGIN_STAGE: secure_claim_http_{exc.code}; response_kind={response_kind}; handler={handler}",flush=True)
        raise RuntimeError("Secure credential claim rejected") from None
    except urllib.error.URLError:
        print("SITE_LOGIN_STAGE: secure_claim_network_failure",flush=True)
        raise RuntimeError("Secure credential claim unreachable") from None
    except (ValueError,KeyError):
        print("SITE_LOGIN_STAGE: secure_claim_invalid_response",flush=True)
        raise RuntimeError("Secure credential claim invalid response") from None
    if not details.get("ok") or details.get("accountId")!=account or details.get("nonce")!=nonce:
        print("SITE_LOGIN_STAGE: secure_claim_invalid_payload",flush=True)
        raise RuntimeError("Invalid claim")
    print("SITE_LOGIN_STAGE: credentials_claimed",flush=True)
    if not safe_host(details["siteUrl"]) or urllib.parse.urlsplit(details["siteUrl"]).hostname!=site_host:
        raise RuntimeError("Invalid target")
    code="executor_error"
    failure_stage=None
    browser_stage="chromium_start"
    observed_site_account_id=None
    print("SITE_LOGIN_STAGE: chromium_start",flush=True)
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,proxy={
                "server":f"http://{details['proxyHost']}:{details['proxyPort']}",
                "username":details["proxyUsername"],"password":details["proxyPassword"]})
            try:
                context=browser.new_context(locale="ru-RU",service_workers="block")
                try:
                    page=context.new_page()
                    browser_stage="proxy_ip_check"
                    page.goto("https://api.ipify.org?format=json",wait_until="domcontentloaded",timeout=30000)
                    ip=ipaddress.ip_address(json.loads(page.locator("body").inner_text())["ip"])
                    print("SITE_LOGIN_STAGE: proxy_ip_checked",flush=True)
                    if str(ip)!=details["expectedIp"]:
                        code="ip_mismatch"
                    else:
                        print("SITE_LOGIN_STAGE: site_login_attempt",flush=True)
                        browser_stage="site_login_attempt"
                        code=inspect_login(page,details["siteUrl"],
                            details["siteLogin"],details["sitePassword"])
                        if code=="login_authenticated_identity_verified":
                            observed_site_account_id=login_step("login_identity_check", lambda:
                                observed_authenticated_site_email(page,details["siteLogin"]))
                            if observed_site_account_id is None:
                                code="login_authenticated_identity_unconfirmed"
                finally: context.close()
            finally: browser.close()
    except LoginStageError as exc:
        failure_stage=exc.stage
        code=LOGIN_FAILURE_CODES[exc.stage]
    except Exception:
        # The IP check and site login are different failure domains.
        # Passing IP verification must never be reported as a proxy failure.
        print("SITE_LOGIN_STAGE: browser_or_site_error",flush=True)
        code={"chromium_start":"browser_start_failed",
              "proxy_ip_check":"proxy_error",
              "site_login_attempt":"login_verify_failed"}[browser_stage]
    print("SITE_LOGIN_STAGE: callback_result",flush=True)
    try:
        result=request_json(endpoint("/api/man-site-login/result"),{
            "account_id":account,"nonce":nonce,"code":code,"failure_stage":failure_stage,
            "observed_site_account_id":observed_site_account_id
            if code=="login_authenticated_identity_verified" else None})
    except urllib.error.HTTPError as exc:
        print(f"SITE_LOGIN_STAGE: callback_http_{exc.code}",flush=True)
        raise RuntimeError("Result callback rejected") from None
    except urllib.error.URLError:
        print("SITE_LOGIN_STAGE: callback_network_failure",flush=True)
        raise RuntimeError("Result callback unreachable") from None
    if not result.get("ok"): raise RuntimeError("Coordinator rejected result")
    print("SITE_LOGIN_PREFLIGHT: "+code)
    return 0 if code in ("login_authenticated_identity_verified","login_authenticated_identity_unconfirmed") else 1

if __name__=="__main__":
    try: sys.exit(main())
    except Exception:
        print("SITE_LOGIN_PREFLIGHT: unavailable",file=sys.stderr)
        sys.exit(1)

