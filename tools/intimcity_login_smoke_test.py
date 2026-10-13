#!/usr/bin/env python3
"""One-off Intimcity login diagnostic. Never posts comments, ratings, or reviews.

Secrets are consumed only at runtime. No screenshots, traces, cookies, or page HTML
are written to disk or printed to GitHub Actions logs.
"""
import ipaddress
import os
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

TARGET = "https://a.intimcity.rip/indi/anketa721867.htm"
CHECK_URL = "https://api.ipify.org?format=json"

def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError("Missing required configuration")
    return value

def run():
    host, port = required("PROXY_HOST"), "6408"
    user, pw = required("PROXY_USERNAME"), required("PROXY_PASSWORD")
    expected = ipaddress.ip_address(required("EXPECTED_EGRESS_IP"))
    login, password = required("INTIMCITY_LOGIN"), required("INTIMCITY_PASSWORD")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            proxy={"server": f"http://{host}:{port}", "username": user, "password": pw},
        )
        context = browser.new_context(locale="ru-RU", service_workers="block")
        try:
            page = context.new_page()
            page.goto(CHECK_URL, wait_until="domcontentloaded", timeout=30000)
            seen = ipaddress.ip_address(page.locator("body").inner_text(timeout=8000).strip().split('"ip":"')[-1].split('"')[0]) if '"ip":"' in page.locator("body").inner_text() else None
            if seen != expected:
                raise RuntimeError("Egress IP mismatch; aborted before site access")
            print("PASS: browser egress IP matches allowlist")

            page.goto(TARGET, wait_until="domcontentloaded", timeout=45000)
            if urlparse(page.url).hostname not in ("a.intimcity.rip", "intimcity.rip"):
                raise RuntimeError("Unexpected login destination")
            print("PASS: target page loaded via approved proxy")

            # Multiple login widgets exist. Only accept a visible form containing
            # both an email input and a password input. Never click rating/comment forms.
            pair = None
            for form in page.locator("form").all():
                if not form.is_visible():
                    continue
                emails = form.locator('input[type="email"], input[placeholder="E-mail"], input[name="email"]')
                passwords = form.locator('input[type="password"]')
                if emails.count() and passwords.count() and emails.first.is_visible() and passwords.first.is_visible():
                    pair = (emails.first, passwords.first, form)
                    break
            if pair is None:
                print("NEEDS_REVIEW: No unambiguous visible login form; no credentials submitted")
                return 2

            email_field, password_field, form = pair
            email_field.fill(login)
            password_field.fill(password)
            submit = form.locator('button[type="submit"], input[type="submit"]').first
            if submit.count() and submit.is_visible():
                submit.click(timeout=8000)
            else:
                password_field.press("Enter")
            try:
                page.wait_for_load_state("domcontentloaded", timeout=12000)
            except Exception:
                pass
            # Never infer successful login solely from HTTP 200 or UI click.
            logout = page.get_by_text("Выйти", exact=True).or_(
                page.get_by_text("Выход", exact=True)
            )
            if logout.count() and logout.first.is_visible():
                print("PASS: authenticated interface detected")
                return 0
            print("NEEDS_REVIEW: login submitted, authentication not conclusively verified")
            return 2
        finally:
            context.close()
            browser.close()

if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception as exc:
        # No URL/proxy exception details: may contain credentials.
        print(f"FAIL: login smoke test stopped ({type(exc).__name__})", file=sys.stderr)
        sys.exit(1)
