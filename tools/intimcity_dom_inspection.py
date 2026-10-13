#!/usr/bin/env python3
"""Read-only DOM structure audit via approved egress. No login or publication."""
import json, os, ipaddress, sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

HOME = "https://a.intimcity.rip/"
EXPECTED_ID = "750206"
ALLOWED_HOSTS = ("a.intimcity.rip", "intimcity.rip")

def require(key):
    value = os.getenv(key, "")
    if not value: raise ValueError("Missing configuration")
    return value

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, proxy={
            "server": "http://"+require("PROXY_HOST")+":6408",
            "username": require("PROXY_USERNAME"),
            "password": require("PROXY_PASSWORD"),
        })
        context = browser.new_context(locale="ru-RU", service_workers="block")
        try:
            page = context.new_page()
            page.goto("https://api.ipify.org?format=json", wait_until="domcontentloaded", timeout=30000)
            ip = ipaddress.ip_address(json.loads(page.locator("body").inner_text())["ip"])
            if ip != ipaddress.ip_address(require("EXPECTED_EGRESS_IP")):
                raise ValueError("IP mismatch")
            print("PASS: egress IP match")
            page.goto(HOME, wait_until="domcontentloaded", timeout=45000)
            if urlparse(page.url).hostname not in ALLOWED_HOSTS:
                raise ValueError("Unexpected host")
            # Emit only safe, allowlisted input attributes and form/button structure.
            structure = page.evaluate("""() => {
              const isVisible=e=>!!(e.getClientRects().length);
              const one = e => ({
                tag:e.tagName.toLowerCase(),
                type:(e.getAttribute('type')||'').slice(0,30),
                name:(e.getAttribute('name')||'').slice(0,65),
                id:(e.id||'').slice(0,65),
                placeholder:(e.getAttribute('placeholder')||'').slice(0,65),
                text:(['BUTTON'].includes(e.tagName)?e.textContent.trim().slice(0,30):''),
                visible:isVisible(e)
              });
              return {
                loginForms:[...document.querySelectorAll('form')].filter(f=>f.querySelector('input[type=password]')).map(f=>({
                  fields:[...f.querySelectorAll('input')].map(one),
                  buttons:[...f.querySelectorAll('button,input[type=submit],input[type=button]')].map(one)
                })),
                searchInputs:[...document.querySelectorAll('input')].filter(e=>/ID|телефон/i.test(e.placeholder||'')).map(e=>({
                  field:one(e),
                  parentForm:!!e.closest('form'),
                  formButtons:e.closest('form')?[...e.closest('form').querySelectorAll('button,input[type=submit],input[type=button]')].map(one):[]
                }))
              };
            }""")
            print("DOM_STRUCTURE: "+json.dumps(structure,ensure_ascii=False))
            # No credentials, no login submission; perform navigation-only search.
            search=page.locator('input[placeholder*="ID"], input[placeholder*="телефон"]')
            visible=[x for x in search.all() if x.is_visible()]
            if len(visible)!=1:
                print("NEEDS_REVIEW: expected single visible search field")
                return 2
            field=visible[0]
            form=field.locator("xpath=ancestor::form[1]")
            if form.count()!=1:
                print("NEEDS_REVIEW: search input has no ancestor form")
                return 2
            button=form.locator('button, input[type="submit"], input[type="button"]').filter(has_text="Найти")
            if button.count()!=1:
                button=form.locator('input[value="Найти"], button:has-text("Найти")')
            if button.count()!=1:
                print("NEEDS_REVIEW: find button not uniquely identified")
                return 2
            field.fill(EXPECTED_ID)
            button.click(timeout=10000)
            try: page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception: pass
            candidates=page.locator('a[href*="anketa750206"]')
            count=sum(1 for x in candidates.all() if x.is_visible())
            print("SEARCH_DIAGNOSTIC: "+json.dumps({
                "matching_profile_links":count,
                "expected_profile_found":count>0,
                "result_heading_present":page.get_by_text("Поиск анкет", exact=True).count()>0
            },ensure_ascii=False))
            return 0 if count>0 else 2
        finally:
            context.close();browser.close()

if __name__=="__main__":
    try: sys.exit(run())
    except Exception as e:
        print("FAIL: "+type(e).__name__)
        sys.exit(1)
