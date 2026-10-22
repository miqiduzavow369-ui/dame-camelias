"""Actual client Mini App rendered offline: review state, buttons and original proof."""
import base64
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"anketa/mini-preview.html").read_text()
OUT=ROOT/"review-ui-check"
OUT.mkdir(exist_ok=True)
PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6uzQAAAAASUVORK5CYII=")
phase="moderation"
def snapshot():
    return dict(men=[dict(id="yan_first" if i==0 else "yan_second" if i==1 else "yan_"+str(i+1).zfill(2),name="Михаил Корсаков" if i==1 else "Ян Первый" if i==0 else "Synthetic man "+str(i+1),visible=True,cabinetReady=True) for i in range(30)],
        profiles=[dict(id="690230",name="Synthetic profile",daily=dict(remaining=1),counts=dict(rating=0,review=0,total=0),capabilities={},statuses={})],
        secondaryStatuses={"690230":{"yan_second":{"review":phase}}},balance=dict(available=9,reserved=0,spent=1),
        history=[dict(id="690230",account="yan_second",kind="review",date="20261022",hasProof=True)] if phase=="published" else [],activities=[])
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport=dict(width=390,height=900))
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    def route(r):
        req=r.request
        if req.url=="https://review.test/":return r.fulfill(status=200,content_type="text/html",body=HTML)
        if req.url=="https://telegram.org/js/telegram-web-app.js":
            return r.fulfill(status=200,content_type="text/javascript",body="window.Telegram={WebApp:{initData:'synthetic',ready(){},expand(){},BackButton:{show(){},hide(){},onClick(){}}}}")
        if req.url.endswith("/api/anketa/mini-preview"):
            return r.fulfill(status=200,content_type="application/json",body=json.dumps(snapshot()))
        if req.url.endswith("/api/anketa/mini-review-action"):
            data=req.post_data_json
            assert data["action"]=="status","Client must never auto-publish"
            stage={"moderation":"saved","checking":"waiting","rejected":"rejected"}[phase]
            return r.fulfill(status=200,content_type="application/json",body=json.dumps(dict(ok=True,stage=stage,rejectedAt=1792670000000)))
        if req.url.endswith("/api/anketa/mini-proof"):
            return r.fulfill(status=200,content_type="image/png",body=PNG)
        # Synthetic artwork only; external resources never leave this interceptor.
        if req.resource_type=="image":return r.fulfill(status=200,content_type="image/png",body=PNG)
        if req.url.startswith("https://fonts."):return r.fulfill(status=200,content_type="text/css",body="")
        raise AssertionError("Unexpected network operation: "+req.url)
    page.route("**/*",route)
    page.goto("https://review.test/",wait_until="networkidle")
    for width in (320,390):
        page.set_viewport_size(dict(width=width,height=900))
        for phase in ("moderation","checking","rejected","published"):
            page.evaluate("data=>{render(data);selectedAccount='yan_second';openDetail(profiles[0]);}",snapshot())
            assert page.locator("#detailAccount").inner_text()=="Михаил Корсаков"
            button=page.locator('[data-sub="review"]')
            assert button.is_visible(),phase
            if phase=="published":assert "Подтверждение" in button.inner_text() or "подтверждение" in button.inner_text()
            elif phase in ("moderation","checking"):assert "статус" in button.inner_text()
            else:assert "Оставить" in button.inner_text()
            page.screenshot(path=str(OUT/f"review-{width}-{phase}-card.png"),full_page=True)
            button.click()
            if phase!="published":
                page.get_by_role("button",name="✅ Опубликовать отзыв",exact=True).wait_for(state="hidden")
                if phase=="rejected":
                    page.get_by_role("button",name="↺ Попробовать снова",exact=True).wait_for()
                    assert page.get_by_text("Дата недоступна",exact=False).count()==0
                else:
                    page.get_by_role("button",name="🔄 Посмотреть результат",exact=True).wait_for()
                    assert page.locator("#subContent textarea:visible").count()==0
            else:page.locator('[data-inline-proof="review"] img').wait_for()
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth"),"Horizontal mobile overflow"
            page.screenshot(path=str(OUT/f"review-{width}-{phase}-result.png"),full_page=True)
    assert not errors,errors
    browser.close()
print("Review mobile states verified; 16 screenshots; no live publication or Telegram calls")
