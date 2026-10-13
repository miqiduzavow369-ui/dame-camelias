#!/usr/bin/env python3
"""One-off Intimcity login diagnostic. Never posts comments, ratings, or reviews.

Secrets are consumed only at runtime. No screenshots, traces, cookies, or page HTML
are written to disk or printed to GitHub Actions logs.
"""
import ipaddress
import json
import os
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

HOME = "https://a.intimcity.rip/"
PROFILE_ID = "750206"
TARGET = f"https://a.intimcity.rip/indi/anketa{PROFILE_ID}.htm"
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
            seen = ipaddress.ip_address(json.loads(page.locator("body").inner_text(timeout=8000))["ip"])
            if seen != expected:
                raise RuntimeError("Egress IP mismatch; aborted before site access")
            print("PASS: browser egress IP matches allowlist")

            # Follow the same navigation path as a visitor:
            # home -> search by profile ID -> single search result -> profile.
            page.goto(HOME, wait_until="domcontentloaded", timeout=45000)
            if urlparse(page.url).hostname not in ("a.intimcity.rip", "intimcity.rip"):
                raise RuntimeError("Unexpected home destination")
            print("PASS: home page loaded via approved proxy")

            # Authenticate on home page before searching. Only accept a visible form containing
            # both an email input and a password input. Never click rating/comment forms.
            pair = None
            for form in page.locator("form").all():
                if not form.is_visible():
                    continue
                emails = form.locator('input[name="login"][placeholder="E-mail"]')
                passwords = form.locator('input[name="password"][type="password"]')
                if emails.count() and passwords.count() and emails.first.is_visible() and passwords.first.is_visible():
                    pair = (emails.first, passwords.first, form)
                    break
            if pair is None:
                print("NEEDS_REVIEW: No unambiguous visible login form; no credentials submitted")
                return 2

            email_field, password_field, form = pair
            email_field.fill(login)
            password_field.fill(password)
            submit = form.locator('input[type="submit"]').first
            if submit.count() and submit.is_visible():
                submit.click(timeout=8000)
            else:
                password_field.press("Enter")
            # Allow asynchronous login to complete; only print fixed, non-sensitive
            # diagnostic labels. Never log URLs, HTML, credentials, or cookies.
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(2500)
            if urlparse(page.url).hostname not in ("a.intimcity.rip", "intimcity.rip"):
                print("NEEDS_REVIEW: redirected to a different host")
                return 2

            indicators = {
                "logout_control": 'a[href*="logout"], a[href*="exit"], button:has-text("Выйти"), a:has-text("Выйти"), a:has-text("Выход")',
                "account_control": 'a:has-text("Личный кабинет"), a:has-text("Мой профиль")',
                "challenge": 'iframe[src*="captcha"], input[name*="captcha"], input[name*="code"]',
            }
            matched = {}
            for key, selector in indicators.items():
                matched[key] = page.locator(selector).count() > 0
            login_still_visible = False
            for candidate in page.locator('input[type="password"]').all():
                if candidate.is_visible():
                    login_still_visible = True
                    break
            print("DIAGNOSTIC: " + json.dumps({
                "logout_control": matched["logout_control"],
                "account_control": matched["account_control"],
                "challenge_present": matched["challenge"],
                "password_field_visible": login_still_visible,
            }, ensure_ascii=False))
            if matched["logout_control"]:
                print("PASS: authenticated logout control detected")
                authenticated = True
            if matched["account_control"] and not login_still_visible:
                print("PASS: account navigation detected without login form")
                authenticated = True
            if not locals().get("authenticated", False):
                print("NEEDS_REVIEW: login outcome uncertain; search not attempted")
                return 2

            search = page.locator('input#searchStr[name="phones"]')
            visible_search = [item for item in search.all() if item.is_visible()]
            if len(visible_search) != 1:
                print("NEEDS_REVIEW: expected one visible search input")
                return 2
            field = visible_search[0]
            field.fill(PROFILE_ID)
            # Prefer the search button belonging to this input's form.
            parent_form = field.locator("xpath=ancestor::form[1]")
            if parent_form.count() != 1:
                print("NEEDS_REVIEW: search form not identified")
                return 2
            find_button = parent_form.locator('input#searchPS[name="phonesearch"][type="submit"]')
            if find_button.count() != 1:
                print("NEEDS_REVIEW: search button not identified")
                return 2
            find_button.click(timeout=10000)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception:
                pass

            # Read-only search-result diagnostics. Avoid page text, full URLs,
            # cookies and account details in logs.
            from urllib.parse import urlparse, parse_qs
            page.wait_for_timeout(1800)
            result_links = page.locator(f'a[href*="anketa{PROFILE_ID}"]')
            try:
                result_links.first.wait_for(state="visible", timeout=12000)
            except Exception:
                all_profile_links = page.locator('a[href*="anketa"]')
                print("SEARCH_DIAGNOSTIC: " + json.dumps({
                    "on_expected_profile": urlparse(page.url).path.endswith(f"anketa{PROFILE_ID}.htm"),
                    "search_field_present": page.locator("#searchStr").count() > 0,
                    "result_heading_present": page.get_by_text("Поиск анкет", exact=True).count() > 0,
                    "profile_like_links_count": min(all_profile_links.count(), 100),
                    "expected_id_in_links": page.locator(f'a[href*="{PROFILE_ID}"]').count() > 0,
                }, ensure_ascii=False))
                print("NEEDS_REVIEW: expected profile link not found; no navigation attempted")
                return 2
            visible_links = [item for item in result_links.all() if item.is_visible()]
            if not visible_links:
                print("NEEDS_REVIEW: search result not visible")
                return 2
            # Ensure search results contain no other profile IDs.
            other_profiles = page.locator('a[href*="/indi/anketa"][href$=".htm"]')
            ids = set()
            import re
            for item in other_profiles.all():
                href = item.get_attribute("href") or ""
                match = re.search(r"anketa(\d+)\.htm", href)
                if match and item.is_visible():
                    ids.add(match.group(1))
            if ids != {PROFILE_ID}:
                print("NEEDS_REVIEW: search results ambiguous; no profile opened")
                return 2
            print("PASS: search returned only the expected profile ID")
            visible_links[0].click(timeout=10000)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception:
                pass
            parsed = urlparse(page.url)
            if parsed.hostname not in ("a.intimcity.rip", "intimcity.rip") or parsed.path != f"/indi/anketa{PROFILE_ID}.htm":
                print("NEEDS_REVIEW: opened URL is not the requested profile")
                return 2
            print("PASS: target profile opened from search results")
            return 0
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
