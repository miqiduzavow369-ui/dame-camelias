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
if not re.fullmatch(r"[a-z0-9-]+\.intimcity\.rip", OWNER_HOST):
    raise RuntimeError("Invalid site host")

class EmptySearch(Exception):
    pass

def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError("Required runtime configuration missing")
    return value

def load_private_dryfill(pid, nonce):
    url=required("ANKETA_CALLBACK_URL")
    parsed=urlparse(url)
    if parsed.scheme!="https" or parsed.path!="/api/anketa/result" or not parsed.netloc:
        raise RuntimeError("Invalid private payload host")
    from urllib.parse import urlencode
    address=parsed._replace(path="/api/anketa/dryfill-payload",
                             query=urlencode({"user_id":os.environ.get("INTIMCITY_LOOKUP_USER_ID",""),"profile_id":pid,"nonce":nonce}),
                             fragment="").geturl()
    req=Request(address,headers={
        "Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),
        "Accept":"application/json",
        "User-Agent":"DameCameliasBot/1.0"
    })
    with urlopen(req,timeout=20) as response:
        if response.status!=200:
            raise RuntimeError("Private rating payload unavailable")
        payload=json.loads(response.read(25000).decode("utf-8"))
    if not isinstance(payload,dict) or not isinstance(payload.get("selections"),list):
        raise RuntimeError("Invalid private rating payload")
    return payload

def report_review_stage(pid, nonce, kind):
    """Authenticated durable audit before external POST, or preflight error."""
    from urllib.parse import urlparse
    original=urlparse(required("ANKETA_CALLBACK_URL"))
    if original.scheme!="https" or original.path!="/api/anketa/result" or not original.netloc:
        raise RuntimeError("Invalid review audit URL")
    url=original._replace(path="/api/anketa/review-stage",query="",fragment="").geturl()
    body=json.dumps({"user_id":os.environ.get("INTIMCITY_LOOKUP_USER_ID",""),"profile_id":pid,"nonce":nonce,"type":kind}).encode("utf-8")
    req=Request(url,method="POST",data=body,headers={
        "Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),
        "Content-Type":"application/json","User-Agent":"DameCameliasBot/1.0"})
    with urlopen(req,timeout=20) as response:
        result=json.loads(response.read(4000).decode("utf-8"))
    if result.get("ok") is not True:
        raise RuntimeError("Review stage audit rejected")

def load_private_review(pid, nonce, mode):
    """Fetch approved text from the authenticated Worker, not Actions inputs/logs."""
    from urllib.parse import urlencode
    base=urlparse(required("ANKETA_CALLBACK_URL"))
    if base.scheme!="https" or base.path!="/api/anketa/result" or not base.netloc:
        raise RuntimeError("Invalid private review callback host")
    url=base._replace(path="/api/anketa/review-payload",
                      query=urlencode({"user_id":os.environ.get("INTIMCITY_LOOKUP_USER_ID",""),"profile_id":pid,"nonce":nonce,"mode":mode}),
                      fragment="").geturl()
    req=Request(url,headers={
        "Authorization":"Bearer "+required("ANKETA_CALLBACK_TOKEN"),
        "Accept":"application/json","User-Agent":"DameCameliasBot/1.0"})
    with urlopen(req,timeout=20) as response:
        payload=json.loads(response.read(15000).decode("utf-8"))
    value=payload.get("text") if isinstance(payload,dict) else None
    if not isinstance(value,str) or not 10<=len(value)<=3000:
        raise RuntimeError("Invalid private review text")
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
        // Select only a photo explicitly attached to the profile gallery,
        // not advertisements, icons or unrelated images elsewhere on page.
        const images=[...document.querySelectorAll('.anketa .gallery img,.profile .gallery img,.anketa .photos img,.profile .photos img,[id*="anketa"] .photo img,[id*="profile"] .photo img')]
          .filter(img=>img.naturalWidth>=120 && img.naturalHeight>=120);
        const meta=document.querySelector('meta[property="og:image"],meta[name="twitter:image"]');
        const photo=images.length?(images[0].getAttribute('data-src')||images[0].currentSrc||images[0].src):
          (meta?.content||'');
        return {heading, excerpt, photo};
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
    # Avoid foreign image hosts and ambiguous or authenticated image endpoints.
    photo = raw.get("photo", "")
    target = urlparse(photo)
    if (target.scheme != "https" or target.hostname != OWNER_HOST or
            target.username or target.password or target.port or
            not re.search(r"\\.(?:jpg|jpeg|png|webp)$",target.path,re.I)):
        photo = ""
    return {"id": profile_id, "name": name, "age": years, "metro": location,
            "url": f"https://{OWNER_HOST}/indi/anketa{profile_id}.htm", "photoUrl": photo}

def capture_verified_proof(ctx, pid, expected_date=None):
    """Read-only proof from the owner's checked list. Never interact with submission forms."""
    import base64
    page=ctx.new_page()
    try:
        page.set_viewport_size({"width":1100,"height":900})
        page.goto(f"https://{OWNER_HOST}/user_checked.php",wait_until="domcontentloaded",timeout=45000)
        if urlparse(page.url).hostname!=OWNER_HOST or urlparse(page.url).path!="/user_checked.php":
            raise RuntimeError("Unexpected checked-list destination")
        heading=page.locator("h1").first.inner_text(timeout=15000).strip()
        if "Проверенные анкеты" not in heading:
            raise RuntimeError("Authenticated checked-list heading missing")
        card=page.locator(f"#ankcrd{pid}")
        if card.count()!=1:
            print("PROOF: profile card missing or ambiguous",flush=True)
            return None
        # The site uses lazy-loaded photos. The card may be visible in the
        # screenshot clip while its photo has not been requested yet.
        photo=card.locator(".imganketa img").first
        if photo.count()!=1:
            raise RuntimeError("Checked profile photo element missing")
        photo.scroll_into_view_if_needed(timeout=10000)
        try:
            photo.evaluate("""async img => {
                img.loading='eager';
                if (!img.complete || !img.naturalWidth) {
                    await new Promise((resolve,reject)=>{
                        const timer=setTimeout(()=>reject(Error('photo-load-timeout')),12000);
                        img.addEventListener('load',()=>{clearTimeout(timer);resolve()}, {once:true});
                        img.addEventListener('error',()=>{clearTimeout(timer);reject(Error('photo-load-error'))}, {once:true});
                        if(img.complete && img.naturalWidth){clearTimeout(timer);resolve()}
                    });
                }
                if(img.decode) await img.decode();
                if(img.naturalWidth<40 || img.naturalHeight<40)
                    throw Error('profile-photo-empty');
            }""")
        except Exception:
            print("PROOF: matching record found but profile photo not loaded",flush=True)
            return None
        print("PROOF: profile photo loaded",flush=True)
        # In the provided HTML, each story card is followed by its OWN rating table.
        result=page.evaluate("""({id,date}) => {
            const card=document.getElementById('ankcrd'+id);
            if(!card)return null;
            const link=card.querySelector('a[href$="/anketa'+id+'.htm"]');
            const table=card.nextElementSibling;
            if(!link || !table || !table.matches('table.rating-block-wrapper'))return null;
            const rating=table.querySelector('.rating-block');
            const stamp=table.querySelector('[title="Дата выставления оценки"]');
            if(!rating || !stamp)return null;
            const actual=(stamp.textContent||'').trim();
            if(date && actual!==date)return null;
            const a=card.getBoundingClientRect(),b=table.getBoundingClientRect();
            return {date:actual,x:Math.max(0,Math.floor(Math.min(a.left,b.left)+scrollX)),
                y:Math.max(0,Math.floor(Math.min(a.top,b.top)+scrollY)),
                width:Math.ceil(Math.max(a.right,b.right)-Math.min(a.left,b.left)),
                height:Math.ceil(b.bottom-a.top)};
        }""",{"id":pid,"date":expected_date})
        if not result or result["width"]<200 or result["height"]<100 or result["height"]>1500 or result["width"]>1400:
            print("PROOF: missing or mismatched checked rating",flush=True)
            return None
        image=page.screenshot(type="jpeg",quality=78,clip={k:result[k] for k in ("x","y","width","height")},animations="disabled")
        if len(image)>700000:
            raise RuntimeError("Proof image too large")
        print("PROOF: matching checked entry captured",flush=True)
        return {"date":result["date"],"image":base64.b64encode(image).decode("ascii"),
                "mime":"image/jpeg","account":"yan_first","profile_id":pid}
    finally:
        page.close()

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
            if mode=="domain_probe":
                # The user supplied an exact working profile URL. Domain
                # recovery must not depend on the site's flaky search field.
                # This direct visit is read-only and cannot publish anything.
                target_url=f"https://{OWNER_HOST}/indi/anketa{pid}.htm"
                print("DOMAIN_PROBE_STAGE: open-supplied-profile",flush=True)
                page.goto(target_url,wait_until="domcontentloaded",timeout=45000)
                actual=urlparse(page.url)
                if actual.scheme!="https" or actual.hostname!=OWNER_HOST or actual.path!=f"/indi/anketa{pid}.htm":
                    raise RuntimeError("Unexpected domain probe destination")
                profile=extract(page,pid)
                if not profile:
                    raise RuntimeError("Direct domain probe identity missing")
                print("DOMAIN_PROBE_STAGE: supplied-profile-verified",flush=True)
                return profile
            if mode=="proof":
                return {"profile":{"id":pid},"proof":capture_verified_proof(ctx,pid)}
            if mode=="review_proof":
                # After authentication, inspect the authenticated owner's
                # «Ваши отзывы» directly. A hidden/unsearchable original
                # profile must not block genuine, previously posted proof.
                # Unlike review_publish, this branch never opens a form.
                from review_live_workflow import run_review
                print("REVIEW_STAGE: read-only-owner-comments",flush=True)
                approved=required("ANKETA_PRIVATE_REVIEW")
                return {"profile":{"id":pid},"review_publication":run_review(
                    ctx,pid,OWNER_HOST,mode,approved)}

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
            # Extract only the thumbnail belonging to the verified search-result card.
            # Never use unrelated gallery images or the site's advertising assets.
            card_thumbnail = ""
            photo_nodes = card.locator(".imganketa img")
            if photo_nodes.count() == 1:
                try:
                    photo_data = photo_nodes.first.evaluate("""img => ({
                        src: img.getAttribute('data-src') || img.currentSrc || img.src || '',
                        alt: img.getAttribute('alt') || ''
                    })""")
                    from urllib.parse import urljoin
                    candidate = urljoin(page.url, photo_data.get("src", ""))
                    parsed = urlparse(candidate)
                    if (parsed.scheme == "https" and not parsed.username and
                            not parsed.password and not parsed.port and
                            parsed.hostname in (OWNER_HOST, "cdn2.intimtur.com") and
                            re.search(r"\.(?:jpg|jpeg|png|webp)$", parsed.path, re.I)):
                        card_thumbnail = candidate
                except Exception:
                    pass
            # Prefer the exact ID-keyed CDN image over a hotlink-protected thumbnail.
            if True:
                try:
                    hover_src = page.evaluate("""id => {
                        const item = window.dw_Tooltip?.content_vars?.[id];
                        return typeof item?.img === 'string' ? item.img : '';
                    }""", pid)
                    hover_url = urlparse(hover_src)
                    if (hover_url.scheme == "https" and
                            hover_url.hostname == "cdn2.intimtur.com" and
                            not hover_url.username and not hover_url.password and
                            not hover_url.port and not hover_url.query and
                            re.search(r"\.(?:jpg|jpeg|png|webp)$", hover_url.path, re.I)):
                        card_thumbnail = hover_src
                except Exception:
                    pass
            print("LOOKUP_PHOTO_DIAG: source=" + ("cdn" if card_thumbnail.startswith("https://cdn2.intimtur.com/") else "site" if card_thumbnail else "missing"),flush=True)
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
            if profile and card_thumbnail:
                profile["photoUrl"] = card_thumbnail
            # Capture the actual matching search-card thumbnail as small JPEG bytes.
            # R2 stores this image once; the WebApp won't need to hotlink Intimcity.
            if profile and mode in ("profile", "ratings") and photo_nodes.count() == 1:
                try:
                    thumbnail = photo_nodes.first
                    thumbnail.scroll_into_view_if_needed(timeout=10000)
                    thumbnail.evaluate("""img => { img.loading = 'eager'; }""")
                    thumbnail.wait_for(state="visible",timeout=10000)
                    thumbnail.evaluate("""async img => {
                        if (img.complete && img.naturalWidth > 0) return;
                        await new Promise((resolve,reject) => {
                            const timeout=setTimeout(()=>reject(Error('image-timeout')),7500);
                            img.addEventListener('load',()=>{clearTimeout(timeout);resolve()}, {once:true});
                            img.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('image-error'))}, {once:true});
                        });
                    }""")
                    photo_bytes = thumbnail.screenshot(type="jpeg",quality=70,timeout=12000)
                    if 500 <= len(photo_bytes) <= 100000:
                        import base64
                        profile["photoData"] = base64.b64encode(photo_bytes).decode("ascii")
                        # Pre-render compact Telegram banner, independently of the WebApp thumbnail.
                        try:
                            from io import BytesIO
                            from PIL import Image, ImageDraw, ImageFont
                            portrait=Image.open(BytesIO(photo_bytes)).convert("RGB")
                            canvas=Image.new("RGB",(800,250),(20,17,15))
                            draw=ImageDraw.Draw(canvas)
                            gold=(216,172,99)
                            draw.rounded_rectangle((6,6,793,243),radius=23,outline=(120,87,47),width=3)
                            portrait.thumbnail((152,204))
                            px=34+(152-portrait.width)//2
                            py=23+(204-portrait.height)//2
                            canvas.paste(portrait,(px,py))
                            draw.rounded_rectangle((32,21,188,229),radius=12,outline=gold,width=3)
                            fontfile="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
                            font_bold="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
                            titlefont=ImageFont.truetype(fontfile,32)
                            namefont=ImageFont.truetype(font_bold,44)
                            smallfont=ImageFont.truetype(fontfile,27)
                            draw.text((220,32),"DAME CAMELIAS",font=titlefont,fill=gold)
                            # DejaVu Sans cannot render many emoji: it creates
                            # empty squares around names such as 💖Милая Ева💖.
                            # Keep the original name in Telegram's caption;
                            # render a clean Cyrillic name on the banner and
                            # add decorative hearts for names containing hearts.
                            import unicodedata
                            raw_name=str(profile.get("name") or "").replace("\\n"," ").strip()
                            has_hearts=any(char in raw_name for char in "💖💗💕💓💘❤️♥")
                            name="".join(char for char in raw_name
                                if char.isalnum() or char in " -_.'’")
                            name=" ".join(name.split()).strip() or "Анкета"
                            if has_hearts:
                                draw.text((221,108),"♥",font=ImageFont.truetype(fontfile,31),fill=(239,93,150))
                            name_x=267 if has_hearts else 220
                            max_name_width=746-name_x-(40 if has_hearts else 0)
                            while len(name)>1 and draw.textbbox((0,0),name,font=namefont)[2]>max_name_width:
                                name=name[:-1]
                            draw.text((name_x,96),name,font=namefont,fill=(241,224,192))
                            if has_hearts:
                                name_width=draw.textbbox((0,0),name,font=namefont)[2]
                                draw.text((name_x+name_width+9,108),"♥",
                                    font=ImageFont.truetype(fontfile,31),fill=(239,93,150))
                            draw.text((220,167),"Анкета №"+pid,font=smallfont,fill=(205,179,143))
                            output=BytesIO()
                            canvas.save(output,format="JPEG",quality=77,optimize=True)
                            card_bytes=output.getvalue()
                            if len(card_bytes)<100000:
                                profile["cardData"]=base64.b64encode(card_bytes).decode("ascii")
                                print("LOOKUP_CARD_CAPTURE: ok",flush=True)
                        except Exception as card_error:
                            print("LOOKUP_CARD_CAPTURE: unavailable="+type(card_error).__name__,flush=True)
                        print("LOOKUP_PHOTO_CAPTURE: ok",flush=True)
                    else:
                        print("LOOKUP_PHOTO_CAPTURE: invalid_size",flush=True)
                except Exception as err:
                    print("LOOKUP_PHOTO_CAPTURE: unavailable="+type(err).__name__,flush=True)
            if mode in ("review_publish","review_proof"):
                # Same verified profile search, card, popup and identity as ratings.
                # Reviews diverge only after the exact profile tab is open.
                if not profile:
                    raise RuntimeError("Review profile identity not verified")
                print("REVIEW_STAGE: verified-profile-from-search",flush=True)
                from review_live_workflow import run_review
                approved=required("ANKETA_PRIVATE_REVIEW")
                stage=(lambda kind: report_review_stage(pid,required("ANKETA_LOOKUP_NONCE"),kind)) if mode=="review_publish" else None
                return {"profile":profile,"review_publication":run_review(
                    ctx,pid,OWNER_HOST,mode,approved,report_stage=stage,profile_page=profile_page)}
            if mode not in ("ratings","mapping","dryfill","publish") or not profile:
                return profile
            print("LOOKUP_STAGE: read-visible-rating-criteria")
            form = profile_page.locator("#checked_form")
            if not form.count():
                return {"profile":profile,"catalog":[]}
            toggle = profile_page.locator("#checked_star input[type=button]")
            if toggle.count() and toggle.first.is_visible():
                toggle.first.click(timeout=8000)
                profile_page.wait_for_timeout(650)
            # Open HTML disclosures and read all enabled rating controls, even those
            # inside initially collapsed services. This is read-only: no submit.
            form.evaluate("""form => {
              for (const d of form.querySelectorAll('details:not([open])')) d.open=true;
            }""")
            expanders = form.locator('button[type="button"], a[aria-expanded], [role="button"][aria-expanded]')
            for el in expanders.all()[:50]:
                try:
                    if not el.is_visible():
                        continue
                    title=(el.inner_text(timeout=1000) or "").lower()
                    expanded=el.get_attribute("aria-expanded")
                    if expanded=="false" and any(word in title for word in
                         ("массаж","bdsm","бдсм","дополн","услуг","показать","развернуть","ещё","еще","экстра","место","другое")):
                        el.click(timeout=3000)
                except Exception:
                    pass
            profile_page.wait_for_timeout(450)
            catalog = form.evaluate(r"""form => {
              const normalize = x => (x || '').replace(/\s+/g,' ').trim();
              const titleOf = node => normalize(node?.textContent).slice(0,90);
              const headings = 'h1,h2,h3,h4,h5,h6,legend,[role=heading],.section-title,.group-title,.title-section';
              const fields=[];
              const seen=new Set();
              const all=[...form.querySelectorAll('select,input[type="radio"]')];
              let lastSection='Оценки анкеты';
              const sectionLabel = el => {
                for(let p=el.parentElement;p && p!==form;p=p.parentElement){
                  const legend=p.matches('fieldset')?p.querySelector(':scope > legend'):null;
                  if(legend && titleOf(legend))return titleOf(legend);
                  const heading=[...p.children].find(x=>x.matches?.(headings) && titleOf(x));
                  if(heading && !heading.contains(el))return titleOf(heading);
                }
                return lastSection;
              };
              const labelOf = el => {
                const explicit=el.id && [...form.querySelectorAll('label[for]')]
                  .find(x=>x.htmlFor===el.id);
                if(explicit && titleOf(explicit))return titleOf(explicit);
                const wrapping=el.closest('label');
                if(wrapping && titleOf(wrapping))return titleOf(wrapping);
                const row=el.closest('tr,.row,.rating-row,.form-group,.field');
                if(row){
                  const label=row.querySelector('label,th,.label,.name,.question');
                  if(label && titleOf(label))return titleOf(label);
                }
                const prev=el.previousElementSibling;
                if(prev && prev.matches('label,span,strong,b') && titleOf(prev))return titleOf(prev);
                return '';
              };
              const walker=document.createTreeWalker(form,NodeFilter.SHOW_ELEMENT);
              let node;
              while((node=walker.nextNode())){
                if(node.matches?.(headings)){
                  const value=titleOf(node);
                  if(value && !node.closest('select') && value.length<=90)lastSection=value;
                }
                if(node.matches?.('select')){
                  if(node.disabled)continue;
                  const label=labelOf(node);
                  const options=[...node.options].filter(o=>!o.disabled && o.value!=='')
                    .map(o=>normalize(o.textContent).slice(0,50)).filter(Boolean);
                  if(!label || !options.length)continue;
                  const id=node.id || node.name || label;
                  // An individual one-option select does not represent the
                  // full choice set; the site's radio controls may follow it.
                  if(options.length<2 && form.querySelector('input[type="radio"][name="'+CSS.escape(node.name || node.id || '')+'"]'))continue;
                  if(seen.has('select:'+id))continue;
                  seen.add('select:'+id);
                  fields.push({label:label.slice(0,90),group:sectionLabel(node).slice(0,90),options:options.slice(0,20),control:{type:"select",name:node.name||"",id:node.id||"",values:[...node.options].filter(o=>!o.disabled && o.value!=="").map(o=>o.value).slice(0,20)}});
                }
                if(node.matches?.('input[type="radio"]')){
                  if(node.disabled || !node.name)continue;
                  const key='radio:'+node.name;
                  if(seen.has(key))continue;
                  const radios=[...form.querySelectorAll('input[type="radio"]')]
                    .filter(x=>x.name===node.name && !x.disabled);
                  if(!radios.length)continue;
                  const parent=node.closest('fieldset,.form-group,.rating-row,tr,.row') || node.parentElement?.parentElement;
                  const heading=parent?.querySelector('legend,th,.question,.label');
                  const label=titleOf(heading) || normalize(node.name);
                  const options=radios.map(x=>{
                    const explicit=x.id && form.querySelector('label[for="'+CSS.escape(x.id)+'"]');
                    const labelEl=explicit || x.closest('label');
                    const text=titleOf(labelEl);
                    return (text || normalize(x.value)).slice(0,50);
                  }).filter(Boolean);
                  if(!label || options.length<2)continue;
                  seen.add(key);
                  fields.push({label:label.slice(0,90),group:sectionLabel(node).slice(0,90),options:options.slice(0,20),control:{type:"radio",name:node.name||"",id:"",values:radios.map(x=>x.value).slice(0,20)}});
                }
              }
              return fields.slice(0,120);
            }""")
            if mode in ("dryfill","publish"):
                # Perform value assignment only in the ephemeral browser DOM; no events,
                # requests, form submission or persistent browser storage.
                payload=json.loads(required("ANKETA_DRYFILL_SELECTIONS"))
                requested=payload.get("selections") if isinstance(payload,dict) else payload
                extra_flag=payload.get("metElsewhere",False) if isinstance(payload,dict) else False
                if not isinstance(extra_flag,bool):
                    raise RuntimeError("Invalid extra flag type")
                if not isinstance(requested,list) or not 1<=len(requested)<=120:
                    raise RuntimeError("Invalid dry-fill selection count")
                if len(set(x.get("index") for x in requested if isinstance(x,dict)))!=len(requested):
                    raise RuntimeError("Duplicate dry-fill index")
                report= form.evaluate(r"""(form, requested) => {
                  const clean = v=>String(v??'').trim().toLowerCase().replace(/\\s+/g,' ');
                  const fields=[];
                  const seen=new Set();
                  const controls=[...form.querySelectorAll('select,input[type="radio"]')];
                  for(const el of controls){
                    if(el.disabled)continue;
                    if(el.matches('select')){
                      const options=[...el.options].filter(o=>!o.disabled&&o.value!=='');
                      const row=el.closest('tr,.row,.rating-row,.form-group,.field');
                      const explicit=el.id&&form.querySelector('label[for="'+CSS.escape(el.id)+'"]');
                      const label=(explicit?.textContent||el.closest('label')?.textContent||row?.querySelector('label,th,.label,.name,.question')?.textContent||el.previousElementSibling?.textContent||'').trim().replace(/\\s+/g,' ').slice(0,90);
                      if(!label||!options.length)continue;
                      const id=el.id||el.name||label;
                      if(options.length<2&&form.querySelector('input[type="radio"][name="'+CSS.escape(el.name||el.id||'')+'"]'))continue;
                      if(seen.has('select:'+id))continue;seen.add('select:'+id);
                      fields.push({label,options:options.map(o=>o.textContent.trim().replace(/\\s+/g,' ').slice(0,50)),values:options.map(o=>o.value),nodes:[el],type:'select'});
                    }else if(el.name){
                      const key='radio:'+el.name;
                      if(seen.has(key))continue;
                      const radios=[...form.querySelectorAll('input[type="radio"]')].filter(x=>x.name===el.name&&!x.disabled);
                      const parent=el.closest('fieldset,.form-group,.rating-row,tr,.row')||el.parentElement?.parentElement;
                      const label=(parent?.querySelector('legend,th,.question,.label')?.textContent||el.name).trim().replace(/\\s+/g,' ').slice(0,90);
                      const options=radios.map(x=>(x.id&&form.querySelector('label[for="'+CSS.escape(x.id)+'"]')?.textContent||x.closest('label')?.textContent||x.value).trim().replace(/\\s+/g,' ').slice(0,50));
                      if(!label||options.length<2)continue;
                      seen.add(key);fields.push({label,options,values:radios.map(x=>x.value),nodes:radios,type:'radio'});
                    }
                  }
                  const results=[];
                  let valid=true;
                  // Preflight every field before mutating even the temporary DOM.
                  const actions=[];
                  for(const item of requested){
                    const field=fields[item.index];
                    const idx=field?.options.findIndex(v=>clean(v)===clean(item.value))??-1;
                    const okay=Number.isInteger(item.index)&&item.index>=0&&
                      clean(field?.label)===(clean(item.label)==='фото соответствует'?'isfair':clean(item.label)) &&
                      idx>=0 && field.values[idx]!==undefined;
                    results.push({index:item.index,ok:Boolean(okay),label:String(item.label||'').slice(0,90)});
                    if(!okay)valid=false;else actions.push({field,idx});
                  }
                  if(!valid)return {applied:0,verified:0,results};
                  for(const {field,idx} of actions){
                    if(field.type==='select')field.nodes[0].value=field.values[idx];
                    else field.nodes[idx].checked=true;
                  }
                  let verified=0;
                  for(let i=0;i<actions.length;i++){
                    const {field,idx}=actions[i];
                    const ok=field.type==='select'
                      ?field.nodes[0].value===field.values[idx]
                      :field.nodes[idx].checked===true;
                    results[i].ok=ok;if(ok)verified++;
                  }
                  const serialized=new FormData(form);
                  const entryChecks=actions.map(({field,idx})=>{
                    const name=field.nodes[0]?.name||'';
                    return Boolean(name)&&serialized.getAll(name).includes(field.values[idx]);
                  });
                  return {applied:actions.length,verified,results,
                    serialized:{verified:entryChecks.filter(Boolean).length,
                      total:actions.length,allMatched:entryChecks.every(Boolean)}};
                }""",requested)
                if extra_flag:
                    # Identify the unique checkbox associated with the meeting-on-another-profile
                    # question, using its accessible labels and nearby question text.
                    # Stay within the submission form and fail closed if ambiguous/absent.
                    checkbox_result=profile_page.evaluate(r"""() => {
                      const form=document.querySelector('#checked_form');
                      if(!form)return {ok:false,count:0,inForm:false,serialized:false,reason:'form_missing'};
                      const clean=s=>String(s||'').toLowerCase().replace(/\\s+/g,' ').trim();
                      const isQuestion=s=>{
                        const text=clean(s);
                        return /(?:встречал|встреча|виделся|знаком)/i.test(text)
                          && /друг(?:ой|ую|ими|их|ие|ая|ом|ого)?/i.test(text)
                          && /анкет|профил/i.test(text);
                      };
                      const controls=[...form.querySelectorAll('input[type="checkbox"]')].filter(el=>!el.disabled);
                      const matches=controls.filter(el=>{
                        const texts=[el.getAttribute('aria-label'),el.getAttribute('title')];
                        for(const label of el.labels||[])texts.push(label.textContent);
                        if(el.id){
                          const label=document.querySelector('label[for="'+CSS.escape(el.id)+'"]');
                          if(label)texts.push(label.textContent);
                        }
                        if(el.closest('label'))texts.push(el.closest('label').textContent);
                        // Only use nearby field/row text, not the whole form.
                        const row=el.closest('.checkbox,.form-check,.field,.form-group,.row,tr,li,fieldset');
                        if(row)texts.push(row.textContent);
                        if(el.parentElement)texts.push(el.parentElement.textContent);
                        if(el.nextElementSibling)texts.push(el.nextElementSibling.textContent);
                        return texts.some(isQuestion);
                      });
                      if(matches.length!==1)return {ok:false,count:matches.length,
                        inForm:false,serialized:false,formCheckboxes:controls.length,reason:'not_unique'};
                      const el=matches[0];
                      if(!el.name||!el.value||!el.closest('form')||el.closest('form')!==form)
                        return {ok:false,count:1,inForm:false,serialized:false,reason:'invalid_control'};
                      // Temporary DOM assignment only. No events/clicks/network requests.
                      el.checked=true;
                      const values=new FormData(form).getAll(el.name);
                      return {ok:el.checked===true,count:1,inForm:true,
                        serialized:values.includes(el.value)};
                    }""")
                    report["extraFlag"] = checkbox_result
                    if not checkbox_result.get("ok"):
                        print("DRYFILL_EXTRA_FLAG: unverified; candidate_count=%s" %
                              checkbox_result.get("count",0),flush=True)
                    else:
                        print("DRYFILL_EXTRA_FLAG: verified",flush=True)
                # Inspect the submission contract but never trigger it.
                # Only metadata, never field values, is delivered to the bot.
                form_contract=form.evaluate(r"""form => {
                  const action=new URL(form.getAttribute('action')||location.href,location.href);
                  const buttons=[...form.querySelectorAll('button,input[type="submit"],input[type="image"]')]
                    .filter(el=>!el.disabled).map(el=>({
                      type:el.getAttribute('type')||el.tagName.toLowerCase(),
                      name:el.getAttribute('name')||'',
                      label:(el.innerText||el.value||'').trim().slice(0,70)
                    })).slice(0,12);
                  return {
                    sameHost:action.hostname===location.hostname,
                    actionPath:action.pathname.slice(0,180),
                    method:(form.getAttribute('method')||'GET').toUpperCase(),
                    formId:form.id||'',
                    hiddenFields:form.querySelectorAll('input[type="hidden"]').length,
                    enabledControls:[...form.elements].filter(el=>!el.disabled).length,
                    submitControls:buttons
                  };
                }""")
                report["formContract"]=form_contract
                # One consolidated prepublication audit: browser DOM, actual HTML FormData,
                # checkbox membership, destination and submit control. No network submission.
                checks={
                    "ratingFormData":report.get("serialized",{}).get("allMatched") is True
                      and report.get("serialized",{}).get("total")==len(requested),
                    "checkboxFormData":not extra_flag or (
                        report.get("extraFlag",{}).get("ok") is True
                        and report.get("extraFlag",{}).get("count")==1
                        and report.get("extraFlag",{}).get("inForm") is True
                        and report.get("extraFlag",{}).get("serialized") is True),
                    "sameHost":form_contract.get("sameHost") is True,
                    "submitControl":len(form_contract.get("submitControls",[]))==1,
                    "supportedMethod":form_contract.get("method") in ("GET","POST"),
                    "validActionPath":str(form_contract.get("actionPath","")).startswith("/")
                }
                report["finalAudit"]={"ok":all(checks.values()),"checks":checks}
                print("FINAL_PREPUBLISH_AUDIT: %s; rating_form_entries=%s/%s" %
                      ("PASS" if all(checks.values()) else "FAIL",
                       report.get("serialized",{}).get("verified",0),len(requested)),flush=True)
                print("DRYFILL_FORM_CONTRACT: same_host=%s; method=%s; hidden_fields=%s; submit_controls=%s" %
                      (str(form_contract["sameHost"]).lower(),form_contract["method"],
                       form_contract["hiddenFields"],len(form_contract["submitControls"])),flush=True)
                if mode=="publish":
                    # This is the first and only external form submission attempt.
                    # Fail closed before clicking if the audit or checkbox fails.
                    publication={"attempted":False,"confirmed":False,"confirmedBy":""}
                    if (not report.get("finalAudit",{}).get("ok") or
                        report.get("verified")!=len(requested) or
                        (extra_flag and not report.get("extraFlag",{}).get("ok"))):
                        print("PUBLISH: blocked by final audit",flush=True)
                        return {"profile":profile,"catalog":[],"publication":publication}
                    btn=form.locator('button[type="submit"],input[type="submit"],input[type="image"]')
                    if btn.count()!=1 or not btn.first.is_visible():
                        print("PUBLISH: submit control unavailable",flush=True)
                        return {"profile":profile,"catalog":[],"publication":publication}
                    print("PUBLISH: sending one submission attempt",flush=True)
                    # Mark attempted *before* click, since timeout/network error can
                    # happen after the server has received the form.
                    publication["attempted"]=True
                    try:
                        btn.first.click(timeout=15000,no_wait_after=True)
                        profile_page.wait_for_timeout(3000)
                        # Positive acknowledgement must be an explicit visible success
                        # message, not merely HTTP 200 or lack of an error.
                        ack=profile_page.evaluate(r"""() => {
                          const els=[...document.querySelectorAll(
                            '[role="alert"],.alert-success,.success,.message-success,.notification-success')];
                          const visible=els.filter(e=>e.getClientRects().length);
                          const text=visible.map(e=>(e.textContent||'').trim().toLowerCase()).join(' ');
                          return /успешно (добавлен|отправлен|сохранен|сохранён|опубликован)|спасибо за (оценк|отзыв)|оценк[аиуы] (сохранен|сохранён|добавлен|принят)/.test(text);
                        }""")
                        if ack:
                            publication["confirmed"]=True
                            publication["confirmedBy"]="visible-success-alert"
                    except Exception as e:
                        print("PUBLISH: uncertain after attempt; exception_type="+type(e).__name__,flush=True)
                    print("PUBLISH: result="+("confirmed" if publication["confirmed"] else "unconfirmed"),flush=True)
                    return {"profile":profile,"catalog":[],"publication":publication}
                return {"profile":profile,"catalog":[],"dryfill":report}
            print("LOOKUP_RATINGS_DIAG: fields=%s; sections=%s" %
                  (len(catalog),len(set(x.get("group","") for x in catalog))),flush=True)
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
    if mode not in ("profile","domain_probe","ratings","mapping","dryfill","publish","proof","review_publish","review_proof"):
        raise RuntimeError("Invalid lookup mode")
    try:
        if mode in ("dryfill","publish"):
            # Never put selected ratings into workflow_dispatch or Actions logs.
            os.environ["ANKETA_DRYFILL_SELECTIONS"]=json.dumps(load_private_dryfill(pid,nonce),ensure_ascii=False)
        if mode in ("review_publish","review_proof"):
            os.environ["ANKETA_PRIVATE_REVIEW"]=load_private_review(pid,nonce,mode)
        result=inspect(pid,mode)
        if result:
            status="found"
        print("LOOKUP:", "profile identity detected" if result else "profile identity unavailable")
    except EmptySearch:
        if mode=="review_publish":
            try:
                report_review_stage(pid,nonce,"review_preflight_failed")
            except Exception:
                print("REVIEW_STAGE: could not classify preflight safely",flush=True)
        status="not_found"
        print("LOOKUP: zero search results")
    except Exception as e:
        if mode=="review_publish":
            try:
                report_review_stage(pid,nonce,"review_preflight_failed")
                print("REVIEW_STAGE: preflight-only failure recorded",flush=True)
            except Exception:
                print("REVIEW_STAGE: submission state remains uncertain",flush=True)
        category = ("timeout" if "Timeout" in type(e).__name__ else
                    "proxy" if "Proxy" in type(e).__name__ else
                    "navigation-or-login")
        print("LOOKUP: failed to verify profile identity; category=" + category + "; exception_type=" + type(e).__name__,flush=True)
    profile=result.get("profile") if mode in ("ratings","mapping","dryfill","publish","proof","review_publish","review_proof") and isinstance(result,dict) else result
    catalog=result.get("catalog",[]) if mode in ("ratings","mapping") and isinstance(result,dict) else []
    user_id=os.environ.get("INTIMCITY_LOOKUP_USER_ID","").strip()
    if user_id and (not user_id.isdecimal() or not 5<=len(user_id)<=16):
        raise RuntimeError("Invalid client lookup identity")
    callback({"user_id":user_id,"profile_id":pid,"nonce":nonce,"profile":profile,"catalog":catalog,"dryfill":result.get("dryfill") if mode=="dryfill" and isinstance(result,dict) else None,"publication":result.get("publication") if mode=="publish" and isinstance(result,dict) else None,"proof":result.get("proof") if mode=="proof" and isinstance(result,dict) else None,"review_publication":result.get("review_publication") if mode in ("review_publish","review_proof") and isinstance(result,dict) else None,"mode":mode,"status":status})
    print("PASS: result delivered to existing bot")

if __name__=="__main__":
    main()
