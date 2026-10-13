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
from urllib.error import HTTPError, URLError
from playwright.sync_api import sync_playwright

OWNER_HOST = os.environ.get("INTIMCITY_SITE_HOST","a.intimcity.rip")
if not re.fullmatch(r"[a-z0-9-]+\\.intimcity\\.rip", OWNER_HOST):
    raise RuntimeError("Invalid site host")

class EmptySearch(Exception):
    pass

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
        "User-Agent": "DameCameliasBot/1.0 (GitHub-Actions profile lookup)",
        "Accept": "application/json",
    }, data=json.dumps(data,ensure_ascii=False).encode("utf-8"))
    try:
        with urlopen(request, timeout=20) as res:
            if res.status != 200:
                raise RuntimeError("Callback response not successful")
    except HTTPError as exc:
        content_type = exc.headers.get("Content-Type", "").split(";")[0][:70]
        cf_ray = bool(exc.headers.get("cf-ray"))
        origin = "worker" if exc.headers.get("X-DC-Callback-Handler") == "reached" else "unknown_edge_or_previous_worker_version"
        print(f"CALLBACK_HTTP_ERROR: status={exc.code}; content_type={content_type}; cloudflare_ray_present={cf_ray}; origin={origin}")
        raise RuntimeError("Callback rejected; inspect Cloudflare request logs") from None
    except URLError:
        print("CALLBACK_NETWORK_ERROR: connection failed")
        raise RuntimeError("Callback network failure") from None

def extract(page, profile_id):
    # Never infer missing fields from other profiles.
    raw = page.evaluate(r"""() => {
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
    # Read profile details from profile-specific fields, not the site's 18+ footer.
    name = re.split(r"[,|—]", title)[0].strip()
    name = re.sub(r"^(?:Проститутки\s+Москвы\s*)?(?:Девушка\s*)", "", name, flags=re.I).strip()
    # On Intimcity the search card uses "Возраст: 23"; the site-wide 18+
    # notice is not a person's age. Require a profile-specific age label.
    age = re.search(r"\bВозраст\s*[:：]?\s*(\d{2})\b", raw["excerpt"], re.I)
    metro = re.search(r"(?:м\.|метро)\s*([^,;\n•|]{2,55})", title+" "+raw["excerpt"], re.I)
    if not name or len(name) > 100 or not age:
        return None
    years = int(age.group(1))
    if not 18 <= years <= 99:
        return None
    location = metro.group(1).strip() if metro else ""
    return {"id": profile_id, "name": name, "age": years, "metro": location,
            "url": f"https://{OWNER_HOST}/indi/anketa{profile_id}.htm"}

def inspect(pid, mode='profile'):
    host = required("PROXY_HOST")
    server = "http://" + host + ":6408"
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,proxy={
            "server":server,"username":required("PROXY_USERNAME"),
            "password":required("PROXY_PASSWORD")})
        ctx=browser.new_context(locale="ru-RU",service_workers="block")
        try:
            page=ctx.new_page()
            print("LOOKUP_STAGE: proxy-egress")
            page.goto("https://api.ipify.org?format=json",wait_until="domcontentloaded",timeout=30000)
            seen=ipaddress.ip_address(json.loads(page.locator("body").inner_text())["ip"])
            if seen != ipaddress.ip_address(required("EXPECTED_EGRESS_IP")):
                raise RuntimeError("Proxy egress mismatch")
            print("LOOKUP_STAGE: open-site")
            page.goto(f"https://{OWNER_HOST}/",wait_until="domcontentloaded",timeout=45000)
            print("LOOKUP_STAGE: locate-login")
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
                print("LOOKUP_LOGIN_DIAG: login_form=missing")
                raise RuntimeError("Login form not found")
            print("LOOKUP_STAGE: verify-login-wait",flush=True)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                print("LOOKUP_LOGIN_DIAG: networkidle=timeout_or_unavailable",flush=True)
            print("LOOKUP_STAGE: verify-login-settle",flush=True)
            page.wait_for_timeout(2500)
            print("LOOKUP_STAGE: verify-login-host",flush=True)
            host = urlparse(page.url).hostname
            # Login can legitimately redirect between subdomains of the same site.
            # Do not trust lookalike domains or any unrelated external host.
            host_ok = bool(host and (host == "intimcity.rip" or host.endswith(".intimcity.rip")))
            print("LOOKUP_LOGIN_DIAG: host_scope=%s" %
                  ("site" if host_ok else "external_or_unexpected"),flush=True)
            if not host_ok:
                raise RuntimeError("Unexpected login destination")
            print("LOOKUP_STAGE: verify-login-elements",flush=True)
            logout = page.locator('a[href*="logout"], a[href*="exit"], button:has-text("Выйти"), a:has-text("Выйти"), a:has-text("Выход")').count() > 0
            account = page.locator('a:has-text("Личный кабинет"), a:has-text("Мой профиль")').count() > 0
            password_visible = any(el.is_visible() for el in page.locator('input[type="password"]').all())
            print("LOOKUP_LOGIN_DIAG: logout_link=%s; account_link=%s; password_visible=%s; site_host_ok=true" %
                  (str(logout).lower(),str(account).lower(),str(password_visible).lower()),flush=True)
            if not (logout or (account and not password_visible)):
                raise RuntimeError("Authentication not confirmed")
            print("LOOKUP_STAGE: search-profile")
            search = page.locator('input#searchStr[name="phones"]')
            visible_search = [item for item in search.all() if item.is_visible()]
            if len(visible_search) != 1:
                raise RuntimeError("Expected one visible profile search")
            field = visible_search[0]
            field.fill(pid)
            search_form = field.locator("xpath=ancestor::form[1]")
            if search_form.count() != 1:
                raise RuntimeError("Profile search form unavailable")
            find_button = search_form.locator('input#searchPS[name="phonesearch"][type="submit"]')
            if find_button.count() != 1:
                raise RuntimeError("Profile search submit unavailable")
            find_button.click(timeout=10000)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception:
                pass
            print("LOOKUP_STAGE: check-search-count")
            counter = page.locator("#idBigSearchFindCount")
            counter.wait_for(state="attached", timeout=20000)
            if counter.get_attribute("data-findcount") == "0":
                raise EmptySearch()
            print("LOOKUP_STAGE: wait-for-result-card")
            card = page.locator(f"#ankcrd{pid}")
            card.wait_for(state="visible", timeout=20000)
            results = page.locator("#idBigSearchFindCount")
            if results.count() and results.first.get_attribute("data-arrid") not in (None, pid):
                raise RuntimeError("Search result ID does not match requested profile")
            print("LOOKUP_STAGE: locate-profile-link")
            link = card.locator(f'a[href$="/indi/anketa{pid}.htm"]')
            visible_links = [item for item in link.all() if item.is_visible()]
            if not visible_links:
                raise RuntimeError("Requested profile link missing in result card")
            # Search cards use target=_blank. Selecting the original page after click
            # incorrectly leaves us on search_ext.php, so switch to the popup.
            print("LOOKUP_STAGE: open-profile-tab")
            selected = visible_links[0]
            if (selected.get_attribute("target") or "").lower() == "_blank":
                with page.expect_popup(timeout=15000) as popup:
                    selected.click(timeout=10000)
                profile_page = popup.value
            else:
                selected.click(timeout=10000)
                profile_page = page
            profile_page.wait_for_load_state("domcontentloaded", timeout=45000)
            target = urlparse(profile_page.url)
            if target.hostname != OWNER_HOST or target.path != f"/indi/anketa{pid}.htm":
                raise RuntimeError("Unexpected profile location")
            print("LOOKUP_STAGE: extract-profile")
            profile_page.wait_for_timeout(1800)
            profile = extract(profile_page,pid)
            if mode != "ratings" or not profile:
                return profile
            print("LOOKUP_STAGE: read-visible-rating-criteria")
            form = profile_page.locator("#checked_form")
            if not form.count():
                return {"profile":profile,"catalog":[]}
            toggle = profile_page.locator("#checked_star input[type=button]")
            if toggle.count() and toggle.first.is_visible():
                toggle.first.click(timeout=8000)
                profile_page.wait_for_timeout(650)
            # Expand only disclosure controls inside the rating form. Never click
            # submit buttons or change a rating value.
            form.evaluate("""form => {
              for (const d of form.querySelectorAll('details:not([open])')) d.open=true;
            }""")
            expanders = form.locator('button[type="button"][aria-expanded="false"], a[aria-expanded="false"], [role="button"][aria-expanded="false"]')
            for el in expanders.all()[:20]:
                try:
                    if not el.is_visible():
                        continue
                    title=(el.inner_text(timeout=1000) or "").lower()
                    if any(word in title for word in ("массаж","bdsm","бдсм","дополн","услуг","показать","развернуть","ещё","еще")):
                        el.click(timeout=3000)
                except Exception:
                    pass
            profile_page.wait_for_timeout(400)
            catalog = form.evaluate("""form => {
              const items=[];
              for (const el of form.querySelectorAll('select')) {
                if (!el.id || el.disabled) continue;
                const label=[...form.querySelectorAll('label[for]')].find(x=>x.htmlFor===el.id);
                const title=(label?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,90);
                if (!title) continue;
                const options=[...el.options].filter(o=>!o.disabled && o.value).map(o=>o.textContent.trim().slice(0,50));
                if (options.length===0) continue;
                // Only expose fields visible after expanding a known section.
                // Permanently hidden fields may not be enabled for this profile.
                if (!el.getClientRects().length) continue;
                items.push({label:title,options:options.slice(0,12)});
              }
              return items.slice(0,60);
            }""")
            return {"profile":profile,"catalog":catalog}
        finally:
            ctx.close()
            browser.close()

def main():
    pid=required("INTIMCITY_PROFILE_ID")
    nonce=required("ANKETA_LOOKUP_NONCE")
    if not re.fullmatch(r"\d{1,9}",pid) or not re.fullmatch(r"[a-f0-9]{12}",nonce):
        raise RuntimeError("Invalid lookup arguments")
    result=None
    status="error"
    mode=os.environ.get("ANKETA_LOOKUP_MODE","profile")
    if mode not in ("profile","ratings"):
        raise RuntimeError("Invalid lookup mode")
    try:
        result=inspect(pid,mode)
        if result:
            status="found"
        print("LOOKUP:", "profile identity detected" if result else "profile identity unavailable")
    except EmptySearch:
        status="not_found"
        print("LOOKUP: zero search results")
    except Exception as e:
        category = ("timeout" if "Timeout" in type(e).__name__ else
                    "proxy" if "Proxy" in type(e).__name__ else
                    "navigation-or-login")
        print("LOOKUP: failed to verify profile identity; category=" + category + "; exception_type=" + type(e).__name__,flush=True)
    profile=result.get("profile") if mode=="ratings" and isinstance(result,dict) else result
    catalog=result.get("catalog",[]) if mode=="ratings" and isinstance(result,dict) else []
    callback({"profile_id":pid,"nonce":nonce,"profile":profile,"catalog":catalog,"mode":mode,"status":status})
    print("PASS: result delivered to existing bot")

if __name__=="__main__":
    main()
