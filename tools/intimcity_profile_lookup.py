#!/usr/bin/env python3
"""Read live profile identity via the approved proxy and notify the bot.
No ratings or reviews are submitted. Never print site HTML or credentials.
"""
import ipaddress
import json
import os
import re
import sys
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright

OWNER_HOST = "a.intimcity.rip"

def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError("Required runtime configuration missing")
    return value

def callback(data):
    url = required("ANKETA_CALLBACK_URL")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path != "/api/anketa/result":
        raise RuntimeError("Invalid callback destination")
    request = Request(url, method="POST", headers={
        "Authorization": "Bearer " + required("ANKETA_CALLBACK_TOKEN"),
        "Content-Type": "application/json",
    }, data=json.dumps(data,ensure_ascii=False).encode("utf-8"))
    with urlopen(request, timeout=20) as res:
        if res.status != 200:
            raise RuntimeError("Callback failed")

def extract(page, profile_id):
    # Never infer missing fields from other profiles.
    raw = page.evaluate("""() => {
        const normalize = s => (s || '').replace(/\s+/g,' ').trim();
        const h1 = [...document.querySelectorAll('h1')].find(e => e.getClientRects().length);
        const title = normalize(h1?.textContent);
        const heading = title || normalize(document.querySelector('meta[property="og:title"]')?.content);
        const container = h1?.closest('section,article,.anketa,.profile') || document.body;
        const excerpt = normalize(container.innerText).slice(0,12000);
        return {heading, excerpt};
    }""")
    title = raw["heading"]
    if not title:
        return None
    # All identifying details must be found on the selected profile itself.
    name = re.split(r"[,|—]", title)[0].strip()
    age = re.search(r"(?<!\d)(\d{2})\s*(?:год|года|лет)\b", title+" "+raw["excerpt"])
    metro = re.search(r"(?:м\.|метро)\s*([^,;\n•|]{2,55})", title+" "+raw["excerpt"], re.I)
    if not name or len(name) > 100 or not age:
        return None
    years = int(age.group(1))
    if not 18 <= years <= 99:
        return None
    location = metro.group(1).strip() if metro else ""
    return {"id": profile_id, "name": name, "age": years, "metro": location,
            "url": f"https://{OWNER_HOST}/indi/anketa{profile_id}.htm"}

def inspect(pid):
    host = required("PROXY_HOST")
    server = "http://" + host + ":6408"
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,proxy={
            "server":server,"username":required("PROXY_USERNAME"),
            "password":required("PROXY_PASSWORD")})
        ctx=browser.new_context(locale="ru-RU",service_workers="block")
        try:
            page=ctx.new_page()
            page.goto("https://api.ipify.org?format=json",wait_until="domcontentloaded",timeout=30000)
            seen=ipaddress.ip_address(json.loads(page.locator("body").inner_text())["ip"])
            if seen != ipaddress.ip_address(required("EXPECTED_EGRESS_IP")):
                raise RuntimeError("Proxy egress mismatch")
            page.goto("https://a.intimcity.rip/",wait_until="domcontentloaded",timeout=45000)
            found=False
            for form in page.locator("form").all():
                email=form.locator('input[name="login"][placeholder="E-mail"]')
                pw=form.locator('input[name="password"][type="password"]')
                if form.is_visible() and email.count() and pw.count() and email.first.is_visible():
                    email.first.fill(required("INTIMCITY_LOGIN"))
                    pw.first.fill(required("INTIMCITY_PASSWORD"))
                    submit=form.locator('input[type="submit"]')
                    if submit.count() and submit.first.is_visible():
                        submit.first.click(timeout=8000)
                    else:
                        pw.first.press("Enter")
                    found=True
                    break
            if not found:
                raise RuntimeError("Login form not found")
            page.wait_for_timeout(2200)
            if not page.locator('a[href*="logout"], a[href*="exit"], a:has-text("Выйти"), a:has-text("Выход")').count():
                raise RuntimeError("Authentication not confirmed")
            url=f"https://{OWNER_HOST}/indi/anketa{pid}.htm"
            page.goto(url,wait_until="domcontentloaded",timeout=45000)
            page.wait_for_timeout(1800)
            target=urlparse(page.url)
            if target.hostname != OWNER_HOST or target.path != f"/indi/anketa{pid}.htm":
                raise RuntimeError("Unexpected profile location")
            return extract(page,pid)
        finally:
            ctx.close()
            browser.close()

def main():
    pid=required("INTIMCITY_PROFILE_ID")
    nonce=required("ANKETA_LOOKUP_NONCE")
    if not re.fullmatch(r"\d{1,9}",pid) or not re.fullmatch(r"[a-f0-9]{12}",nonce):
        raise RuntimeError("Invalid lookup arguments")
    result=None
    try:
        result=inspect(pid)
        print("LOOKUP:", "profile identity detected" if result else "profile identity unavailable")
    except Exception as e:
        print("LOOKUP: failed to verify profile identity")
    callback({"profile_id":pid,"nonce":nonce,"profile":result})
    print("PASS: result delivered to existing bot")

if __name__=="__main__":
    main()
