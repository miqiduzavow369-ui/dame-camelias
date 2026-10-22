"""Render real ADMIN HTML using synthetic state and intercepted, offline-only requests."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"admin/preview-v3.html").read_text()
OUT=ROOT/"registration-ui-check"
OUT.mkdir(exist_ok=True)

def sample(phase):
    proxy=phase>=1
    login=phase>=2
    ready=phase>=3
    return dict(ok=True,accountId="yan_03",connection=dict(accountId="yan_03",ready=ready,
        browserVerified=proxy,siteConfigured=login,siteIdentityVerified=login,ownerApproved=ready),
        proxy=dict(accountId="yan_03",version=1,configured=proxy,expectedIp="8.8.8.8"),
        site=dict(accountId="yan_03",version=1,configured=login,siteUrl="https://c.intimcity.rip/"),
        browser=dict(accountId="yan_03",version=1,status="verified" if proxy else "not_started"),
        login=dict(accountId="yan_03",status="completed" if login else "not_started",technicalReady=login,
            siteIdentityVerified=login,code="login_authenticated_identity_verified" if login else None),
        approval=dict(approved=ready,version=1))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport=dict(width=390,height=900),device_scale_factor=1)
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    calls=[]
    current=sample(0)
    def route(request_route):
        request=request_route.request
        if request.url=="https://registration.test/":
            return request_route.fulfill(status=200,content_type="text/html",body=HTML)
        if request.url=="https://telegram.org/js/telegram-web-app.js":
            return request_route.fulfill(status=200,content_type="text/javascript",body="window.Telegram={WebApp:{initData:'synthetic',ready(){},expand(){}}}")
        if request.url=="https://registration.test/api/admin/app":
            data=request.post_data_json
            calls.append(data["action"])
            action=data["action"]
            if action=="clients":result=dict(ok=True,clients=[])
            elif action=="man_registration_status":result=current
            elif action=="man_private_status":result=dict(ok=True,accountId="yan_03",configured=False)
            elif action=="man_proxy_status":result=current["proxy"]
            elif action=="man_browser_status":result=current["browser"]
            elif action=="man_site_status":result=current["site"]
            elif action=="man_site_login_status":result=current["login"]
            else:raise AssertionError("Unexpected live operation in visual check: "+action)
            return request_route.fulfill(status=200,content_type="application/json",body=json.dumps(result))
        raise AssertionError("External network request forbidden: "+request.url)
    page.route("**/*",route)
    page.goto("https://registration.test/",wait_until="networkidle")
    for width in (320,390):
        page.set_viewport_size(dict(width=width,height=900))
        for phase in range(4):
            current=sample(phase)
            page.evaluate("""data=>{
                manAccounts=[{id:'yan_03',name:'Даниил Оболенский',number:3,technicalName:'daniil@example.test'}];
                selectedManId='yan_03';wizardData={id:'yan_03',...data};wizardLoading=false;wizardError='';
                state.page='man-detail';render();
            }""",current)
            assert page.locator(".registration-step").count()==3
            assert page.locator(".registration-step .primary").count()==(1 if phase<3 else 0)
            assert page.locator(".registration-ready").count()==(1 if phase==3 else 0)
            body=page.locator("main").inner_text()
            for forbidden in ("nonce","Chromium","Диагностика","Согласовать отзыв","Билет подтверждения"):
                assert forbidden not in body,forbidden
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth"),"Mobile horizontal overflow"
            page.screenshot(path=str(OUT/f"registration-{width}-step-{phase+1}.png"),full_page=True)
    page.set_viewport_size(dict(width=390,height=900))
    current=sample(1)
    page.evaluate("openManProxy()")
    page.get_by_role("heading",name="🌐 Личный прокси",exact=True).wait_for()
    page.get_by_text("✓ Личный прокси сохранён",exact=True).wait_for()
    assert page.locator("#proxySingleLine").is_hidden(),"Saved proxy should not require re-entry"
    page.screenshot(path=str(OUT/"proxy-saved-390.png"),full_page=True)
    current=sample(2)
    page.evaluate("openManSite()")
    page.get_by_text("✓ Логин и пароль сохранены",exact=True).wait_for()
    page.get_by_role("button",name="✅ К подтверждению в ADMIN",exact=True).wait_for()
    assert page.locator("#manSitePassword").is_hidden(),"Saved password should not require re-entry"
    page.screenshot(path=str(OUT/"site-verified-390.png"),full_page=True)
    assert not errors,errors
    assert not any(x in calls for x in ("man_proxy_save","man_site_stage","secondary_man_approval_set")),"Opening a card must not save or approve"
    browser.close()
print("MAN_REGISTRATION_UI: offline mobile rendering and saved-data navigation passed")
