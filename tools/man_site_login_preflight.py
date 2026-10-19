#!/usr/bin/env python3
"""Isolated, owner-triggered Chromium login attempt. No publications or identity certification."""
import ipaddress
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

ACCOUNT = re.compile(r"^(yan_second|yan_(?:0[3-9]|[12]\\d|30))$")
NONCE = re.compile(r"^[a-f0-9]{32}$")
HOSTS = {"intimcity.rip","a.intimcity.rip","b.intimcity.rip"}

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
    headers={"Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),"Accept":"application/json"}
    if data is not None: headers["Content-Type"]="application/json"
    req=urllib.request.Request(url,data=data,headers=headers,method="GET" if data is None else "POST")
    with urllib.request.urlopen(req,timeout=25) as response:
        return json.loads(response.read(6000))

def safe_host(url):
    p=urllib.parse.urlsplit(url)
    return p.scheme=="https" and p.hostname in HOSTS and not p.username and not p.password

def inspect_login(page,site_url):
    # Unknown markup fails closed: never guess that a redirect certifies identity.
    page.goto(site_url,wait_until="domcontentloaded",timeout=45000)
    if not safe_host(page.url): return "site_error"
    password=page.locator('input[type="password"]').first
    if password.count()==0:
        links=page.locator('a[href*="login"],a[href*="auth"],a[href*="signin"]').first
        if links.count():
            candidate=links.get_attribute("href") or ""
            target=urllib.parse.urljoin(page.url,candidate)
            if safe_host(target): page.goto(target,wait_until="domcontentloaded",timeout=30000)
    if not safe_host(page.url): return "site_error"
    password=page.locator('input[type="password"]').first
    if password.count()==0: return "login_form_unavailable"
    login=page.locator('input[type="email"],input[name="email"],input[name="login"],input[name="username"]').first
    if login.count()==0: return "login_form_unavailable"
    return "login_form_found"

def main():
    account=required("MAN_SITE_ACCOUNT_ID")
    nonce=required("MAN_SITE_NONCE")
    site_host=required("MAN_SITE_HOST")
    if not ACCOUNT.fullmatch(account) or not NONCE.fullmatch(nonce) or site_host not in HOSTS:
        raise RuntimeError("Invalid identifiers")
    query=urllib.parse.urlencode({"account_id":account,"nonce":nonce})
    details=request_json(endpoint("/api/man-site-login/payload")+"?"+query)
    if not details.get("ok") or details.get("accountId")!=account or details.get("nonce")!=nonce:
        raise RuntimeError("Invalid claim")
    if not safe_host(details["siteUrl"]) or urllib.parse.urlsplit(details["siteUrl"]).hostname!=site_host:
        raise RuntimeError("Invalid target")
    code="executor_error"
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,proxy={
                "server":f"http://{details['proxyHost']}:{details['proxyPort']}",
                "username":details["proxyUsername"],"password":details["proxyPassword"]})
            try:
                context=browser.new_context(locale="ru-RU",service_workers="block")
                try:
                    page=context.new_page()
                    page.goto("https://api.ipify.org?format=json",wait_until="domcontentloaded",timeout=30000)
                    ip=ipaddress.ip_address(json.loads(page.locator("body").inner_text())["ip"])
                    if str(ip)!=details["expectedIp"]:
                        code="ip_mismatch"
                    else:
                        form=inspect_login(page,details["siteUrl"])
                        if form!="login_form_found":
                            code=form
                        else:
                            user=page.locator('input[type="email"],input[name="email"],input[name="login"],input[name="username"]').first
                            password=page.locator('input[type="password"]').first
                            user.fill(details["siteLogin"])
                            password.fill(details["sitePassword"])
                            submit=page.locator('button[type="submit"],input[type="submit"]').first
                            if submit.count()==0: code="login_form_unavailable"
                            else:
                                submit.click(timeout=15000)
                                page.wait_for_timeout(1500)
                                if not safe_host(page.url): code="site_error"
                                else:
                                    # Submission is never treated as identity verification.
                                    code="login_attempted_unconfirmed"
                finally: context.close()
            finally: browser.close()
    except Exception:
        # Never log raw exceptions; Playwright errors may contain form values/URLs.
        code="proxy_error" if code=="executor_error" else "site_error"
    result=request_json(endpoint("/api/man-site-login/result"),{
        "account_id":account,"nonce":nonce,"code":code})
    if not result.get("ok"): raise RuntimeError("Coordinator rejected result")
    print("SITE_LOGIN_PREFLIGHT: "+code)
    return 0 if code=="login_attempted_unconfirmed" else 1

if __name__=="__main__":
    try: sys.exit(main())
    except Exception:
        print("SITE_LOGIN_PREFLIGHT: unavailable",file=sys.stderr)
        sys.exit(1)
