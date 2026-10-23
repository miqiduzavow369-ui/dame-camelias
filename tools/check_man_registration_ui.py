"""Render real ADMIN HTML using synthetic state and intercepted, offline-only requests."""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"admin/preview-v3.html").read_text()
NAMES=json.loads(re.search(r"const DISPLAY_NAMES = Object.freeze\((\[[\s\S]*?\])\);",
    (ROOT/"src/man_accounts.js").read_text()).group(1))
ACCOUNTS=[dict(id="yan_first" if i==0 else "yan_second" if i==1 else f"yan_{i+1:02}",
    number=i+1,name=name,technicalName=f"member.{i+1}@example.test",
    displayIp=None if i==0 else f"45.39.104.{i+1}",
    connection="legacy_active" if i==0 else "not_configured",
    visibility=dict(visible=True,version=0)) for i,name in enumerate(NAMES)]
ACCOUNTS[1]["readiness"]=dict(connectionReady=True,technicalReady=True)
ACCOUNTS[1]["networkStatus"]=dict(configured=True,proxyVerified=True,ipVerified=True)
ACCOUNTS[2]["readiness"]=dict(technicalReady=True,siteIdentityVerified=True)
CLIENTS=[dict(id=f"92000000{i}",username=f"avatar_{name}",active=i!=4,available=4 if i!=4 else 0,
    spent=1,reserved=0,grant=5,revision=1,avatarAvailable=i!=3)
    for i,name in enumerate(("alpha","beta","private","missing"),1)]
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
    avatar_calls=[]
    current=sample(0)
    def route(request_route):
        request=request_route.request
        if request.url=="https://registration.test/":
            return request_route.fulfill(status=200,content_type="text/html",body=HTML)
        if request.url=="https://telegram.org/js/telegram-web-app.js":
            return request_route.fulfill(status=200,content_type="text/javascript",body="window.Telegram={WebApp:{initData:'synthetic',ready(){},expand(){}}}")
        assert "raw.githubusercontent.com" not in request.url,"Browser must not depend on public GitHub"
        portrait=re.fullmatch(r"https://registration\.test/media/assets/admin_men/(dc_man_\d{2}\.webp)",request.url)
        if portrait:
            return request_route.fulfill(status=200,content_type="image/webp",
                body=(ROOT/"assets/admin_men"/portrait.group(1)).read_bytes())
        if request.url=="https://registration.test/api/admin/app":
            data=request.post_data_json
            calls.append(data["action"])
            action=data["action"]
            if action=="clients":result=dict(ok=True,clients=CLIENTS)
            elif action=="client_avatar":
                uid=data["userId"];avatar_calls.append(uid)
                assert uid in ("920000001","920000002","920000004")
                if uid=="920000004":return request_route.fulfill(status=204)
                return request_route.fulfill(status=200,content_type="image/webp",
                    body=(ROOT/"assets/admin_men"/f"dc_man_{int(uid[-1]):02}.webp").read_bytes())
            elif action=="client":result=dict(ok=True,client=next(c for c in CLIENTS if c["id"]==data["userId"]))
            elif action=="man_registration_status":result=current
            elif action=="man_private_status":result=dict(ok=True,accountId="yan_03",configured=False)
            elif action=="man_proxy_status":result=current["proxy"]
            elif action=="man_browser_status":result=current["browser"]
            elif action=="man_site_status":result=current["site"]
            elif action=="man_site_login_status":result=current["login"]
            else:raise AssertionError("Unexpected live operation in visual check: "+action)
            result={"ok":True,**result}
            return request_route.fulfill(status=200,content_type="application/json",body=json.dumps(result))
        raise AssertionError("External network request forbidden: "+request.url)
    page.route("**/*",route)
    page.goto("https://registration.test/",wait_until="networkidle")
    page.wait_for_function("Array.from(document.querySelectorAll('.client-avatar img')).length===2&&Array.from(document.querySelectorAll('.client-avatar img')).every(img=>img.naturalWidth>0)")
    for width in (320,390):
        page.set_viewport_size(dict(width=width,height=900))
        assert page.locator('.client-avatar').count()==4
        for uid in ("920000001","920000002"):
            slot=page.locator(f'.client-avatar[data-avatar-id="{uid}"]')
            assert slot.locator('img').get_attribute('src').startswith('blob:')
            box=slot.bounding_box();assert box['width']==43 and box['height']==43
        for uid in ("920000003","920000004"):
            assert page.locator(f'.client-avatar[data-avatar-id="{uid}"] img').count()==0
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),"Client avatars must not overflow"
        page.screenshot(path=str(OUT/f'client-avatars-{width}.png'),full_page=True)
    page.locator('#search').fill('avatar_beta')
    assert page.locator('.client-list-row').count()==1
    assert page.locator('.client-avatar').get_attribute('data-avatar-id')=='920000002'
    page.locator('#search').fill('')
    assert page.locator('.client-list-row').count()==4
    assert sorted(avatar_calls)==["920000001","920000002","920000004"],"Render/search cannot refetch or mix avatars"
    assert page.locator('.client-list-row').first.locator('a.client-chat').get_attribute('href')=='https://t.me/avatar_alpha'
    page.locator('.client-open').first.click()
    page.wait_for_function("state.page==='client'&&state.client==='920000001'")
    assert page.locator('.detail-chat').get_attribute('href')=='https://t.me/avatar_alpha'
    for width in (320,360,390,430):
        page.set_viewport_size(dict(width=width,height=900))
        page.evaluate("""accounts=>{
            manAccounts=accounts;state.page='men';render();
            document.querySelectorAll('.sq-photo').forEach(img=>img.loading='eager');
        }""",ACCOUNTS)
        page.wait_for_function("Array.from(document.querySelectorAll('.sq-photo')).every(img=>img.complete&&img.naturalWidth>0)")
        assert page.locator(".men-square").count()==30
        assert page.locator(".man-visibility-wrap.connected").count()==2
        assert page.locator(".man-visibility-wrap.connected .sq-name").all_text_contents()==NAMES[:2]
        assert page.locator(".sq-number").count()==0
        assert page.locator(".sq-ip").first.inner_text()=="176.56.35.167"
        for i,account in enumerate(ACCOUNTS):
            tile=page.locator(".men-square").nth(i)
            assert tile.locator(".sq-name").inner_text()==account["name"]
            assert tile.locator(".sq-technical").inner_text()==f"member.{i+1}"
            assert f"dc_man_{i+1:02}.webp" in tile.locator("img").get_attribute("src")
            if i:assert tile.locator(".sq-ip").inner_text()==account["displayIp"]
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth"),"Catalogue horizontal overflow"
        page.screenshot(path=str(OUT/f"men-catalogue-{width}.png"),full_page=True)
        overlaps=page.evaluate("""Array.from(document.querySelectorAll('.men-square')).map(tile=>({
            name:tile.querySelector('.sq-name').textContent,
            horizontal:tile.scrollWidth>tile.clientWidth+1,vertical:tile.scrollHeight>tile.clientHeight+1,
            labelOverlap:tile.querySelector('.sq-name').getBoundingClientRect().bottom>
            tile.querySelector('.sq-technical').getBoundingClientRect().top+1
        })).filter(x=>x.horizontal||x.vertical||x.labelOverlap)""")
        assert not overlaps,f"Catalogue content overlap at {width}: {overlaps}"
        heights=page.locator('.man-visibility-wrap').evaluate_all('cards=>cards.map(x=>x.getBoundingClientRect().height)')
        assert max(heights)<185,f"Cards must be compact at {width}: {max(heights)}"
        print(f"Compact cards at {width}: maximum height {max(heights):.1f}px")
    before=page.locator(".men-square").first.bounding_box()
    page.locator(".sq-photo").evaluate_all("imgs=>imgs.forEach(img=>img.dispatchEvent(new Event('error')))")
    after=page.locator(".men-square").first.bounding_box()
    assert before==after,"Photo failure must preserve card position and size"
    assert page.locator(".sq-photo").first.evaluate("img=>getComputedStyle(img).visibility") == "hidden"
    page.screenshot(path=str(OUT/"men-catalogue-photo-failure.png"),full_page=True)
    for width in (320,390):
        page.set_viewport_size(dict(width=width,height=900))
        for phase in range(4):
            current=sample(phase)
            page.evaluate("""data=>{
                manAccounts=[{id:'yan_03',name:'Даниил Оболенский',number:3,technicalName:'daniil@example.test',displayIp:'45.39.104.3'}];
                selectedManId='yan_03';wizardData={id:'yan_03',...data};wizardLoading=false;wizardError='';
                state.page='man-detail';render();
            }""",current)
            assert page.locator(".registration-step").count()==3
            assert page.locator(".registration-step .primary").count()==(1 if phase<3 else 0)
            assert page.locator(".registration-ready").count()==(1 if phase==3 else 0)
            assert page.locator('.man-identity-email').inner_text()=='daniil'
            assert page.locator('.man-identity-ip').inner_text()==('8.8.8.8' if phase else '45.39.104.3')
            page.wait_for_function("document.querySelector('.man-identity-photo').naturalWidth>0")
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
    for width in (320,390):
        page.set_viewport_size(dict(width=width,height=900))
        page.evaluate("""()=>{
            manAccounts=[{id:'yan_first',name:'Ян Первый',number:1,technicalName:'yan.kon1@example.test'}];
            selectedManId='yan_first';wizardData=null;wizardLoading=false;wizardError='';state.page='man-detail';render();
        }""")
        assert page.locator('.man-identity-email').inner_text()=='yan.kon1'
        assert page.locator('.man-identity-ip').inner_text()=='176.56.35.167'
        assert page.locator('.registration-step').count()==0
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(OUT/f'legacy-identity-{width}.png'),full_page=True)
    assert not errors,errors
    assert not any(x in calls for x in ("man_proxy_save","man_site_stage","secondary_man_approval_set")),"Opening a card must not save or approve"
    browser.close()
print("MAN_REGISTRATION_UI: all 30 catalogue cards, photo failures, mobile rendering and saved-data navigation passed")
