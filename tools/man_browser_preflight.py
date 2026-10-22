#!/usr/bin/env python3
"""One-time, read-only browser proxy/IP preflight for men 02-30.

Credentials are claimed via the authenticated Worker endpoint, never workflow inputs,
browser logs, command arguments, or source control. Yan First remains on its legacy path.
"""
import ipaddress
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from playwright.sync_api import sync_playwright

ACCOUNT = re.compile(r"^(yan_second|yan_(?:0[3-9]|[12]\d|30))$")
NONCE = re.compile(r"^[a-f0-9]{32}$")
ALLOWED_HOSTS = {"intimcity.rip", "a.intimcity.rip", "b.intimcity.rip","c.intimcity.rip"}

def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError("Configuration unavailable")
    return value

def endpoint(path):
    base = urllib.parse.urlsplit(required("ANKETA_CALLBACK_URL"))
    if base.scheme != "https" or base.path != "/api/anketa/result" or not base.hostname:
        raise RuntimeError("Invalid callback configuration")
    return urllib.parse.urlunsplit(("https", base.netloc, path, "", ""))

def request_json(url, payload=None):
    headers = {
        "Authorization": "Bearer " + required("ANKETA_CALLBACK_TOKEN"),
        "Accept": "application/json",
        "User-Agent": "DameCameliasBrowserPreflight/1.0",
    }
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers,
                                     method="POST" if body is not None else "GET")
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError("Coordinator rejected request")
        return json.loads(response.read(5000).decode("utf-8"))

def main():
    account = required("MAN_BROWSER_ACCOUNT_ID")
    nonce = required("MAN_BROWSER_NONCE")
    host = required("MAN_BROWSER_SITE_HOST")
    if not ACCOUNT.fullmatch(account) or not NONCE.fullmatch(nonce) or host not in ALLOWED_HOSTS:
        raise RuntimeError("Invalid preflight identifier")
    query = urllib.parse.urlencode({"account_id": account, "nonce": nonce})
    details = request_json(endpoint("/api/man-browser/payload") + "?" + query)
    if not details.get("ok") or details.get("accountId") != account or details.get("nonce") != nonce:
        raise RuntimeError("Unexpected coordinator response")
    if details.get("host") != host:
        raise RuntimeError("Requested target mismatch")
    code = "executor_error"
    observed_ip = None
    site_reachable = False
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, proxy={
                "server": f"http://{details['proxyHost']}:{details['proxyPort']}",
                "username": details["proxyUsername"],
                "password": details["proxyPassword"],
            })
            try:
                context = browser.new_context(locale="ru-RU", service_workers="block")
                page = context.new_page()
                try:
                    page.goto("https://api.ipify.org?format=json",
                              wait_until="domcontentloaded", timeout=30000)
                    raw = json.loads(page.locator("body").inner_text(timeout=8000))
                    observed = ipaddress.ip_address(raw.get("ip", ""))
                    expected = ipaddress.ip_address(details["expectedIp"])
                    if observed.version != 4 or observed != expected:
                        code = "ip_mismatch"
                    else:
                        observed_ip = str(observed)
                        response = page.goto("https://" + host + "/",
                                             wait_until="domcontentloaded", timeout=45000)
                        current = urllib.parse.urlsplit(page.url)
                        allowed = current.scheme == "https" and current.hostname in ALLOWED_HOSTS
                        site_reachable = bool(allowed and response and 200 <= response.status < 400)
                        code = "verified" if site_reachable else "site_error"
                finally:
                    context.close()
            finally:
                browser.close()
    except Exception:
        # Do not log exception strings: they can contain credentials or proxy URLs.
        if code != "ip_mismatch" and code != "site_error":
            code = "proxy_error" if observed_ip is None else "site_error"
    result = request_json(endpoint("/api/man-browser/result"), {
        "account_id": account, "nonce": nonce, "code": code,
        "observed_ip": observed_ip, "site_reachable": site_reachable,
    })
    if not result.get("ok"):
        raise RuntimeError("Coordinator did not accept preflight result")
    print("BROWSER_PREFLIGHT: " + ("PASS" if result.get("status") == "verified" else "NOT_VERIFIED"))
    return 0 if result.get("status") == "verified" else 1

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("BROWSER_PREFLIGHT: coordinator or executor unavailable", file=sys.stderr)
        sys.exit(1)

