"""Read-only proof of the newest owner review. Never submit or edit reviews."""
import base64
import re
from urllib.parse import urlparse
from review_verification import validate_comments_url, review_text_matches


def capture_review_proof(ctx, host, profile_id, expected_text, max_pages=1):
    if not re.fullmatch(r"[a-z0-9-]+\.intimcity\.rip", host):
        raise ValueError("Invalid host")
    pid = str(profile_id)
    if not re.fullmatch(r"\d{1,9}", pid):
        raise ValueError("Invalid profile ID")
    if not isinstance(expected_text, str) or not 10 <= len(expected_text) <= 3000:
        raise ValueError("Invalid review text")

    page = ctx.new_page()
    try:
        page.set_viewport_size({"width": 1100, "height": 900})
        # The site's real owner-comments entry point has no query parameters.
        # The default owner tab sorts newest reviews first.
        print("REVIEW_PROOF_STAGE: open-owner-comments", flush=True)
        page.goto(f"https://{host}/user_comments.php", wait_until="domcontentloaded", timeout=45000)
        if not validate_comments_url(page.url, host):
            raise RuntimeError("Unexpected owner comments destination")
        print("REVIEW_PROOF_STAGE: check-owner-tab", flush=True)
        owner_tab = page.locator('a.commentsSelectedSection').filter(has_text="Ваши отзывы")
        filter_field = page.locator('form[name="form_mycomm"] input[name="comments_type"]')
        if owner_tab.count() != 1 or filter_field.count() != 1 or filter_field.input_value() != "0":
            raise RuntimeError("Your reviews tab not selected")
        order = page.locator('form[name="form_mycomm"] select[name="sort_mycomm"]')
        if order.count() != 1 or order.input_value() != "0":
            raise RuntimeError("Newest-first review sorting not confirmed")
        print("REVIEW_PROOF_STAGE: check-first-card", flush=True)
        cards = page.locator('div.storyLeft[id^="ankcrd"]')
        if cards.count() < 1:
            raise RuntimeError("No owner review cards")
        card = cards.first
        if card.get_attribute("id") != f"ankcrd{pid}":
            print("REVIEW_PROOF: newest card does not match requested profile", flush=True)
            return None
        table = card.locator("xpath=following-sibling::*[1][self::table[contains(concat(' ',normalize-space(@class),' '),' rating-block-wrapper ')]]")
        if table.count() != 1:
            raise RuntimeError("First review table missing")
        actual = table.locator("td.ver11 p")
        if actual.count() != 1 or not review_text_matches(actual.inner_text(), expected_text):
            print("REVIEW_PROOF: newest review text does not match", flush=True)
            return None
        print("REVIEW_PROOF_STAGE: load-photo", flush=True)
        photo = card.locator(".imganketa img")
        if photo.count() != 1:
            raise RuntimeError("Matching review photo element missing")
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
            print("REVIEW_PROOF: photo not loaded; no screenshot sent", flush=True)
            return None
        print("REVIEW_PROOF_STAGE: measure-card-and-review", flush=True)
        # Compute AFTER scrolling/photo decode. Playwright bounding_box is page-relative.
        card.scroll_into_view_if_needed(timeout=10000)
        a, b = card.bounding_box(), table.bounding_box()
        if not a or not b:
            raise RuntimeError("Review card not visible")
        x = min(a["x"], b["x"])
        y = min(a["y"], b["y"])
        width = max(a["x"] + a["width"], b["x"] + b["width"]) - x
        height = max(a["y"] + a["height"], b["y"] + b["height"]) - y
        if x < 0 or y < 0 or width < 200 or width > 1400 or height < 100 or height > 1600:
            raise RuntimeError("Invalid screenshot bounds")
        print("REVIEW_PROOF_STAGE: screenshot", flush=True)
        jpeg = page.screenshot(type="jpeg", quality=78, clip={
            "x": x, "y": y, "width": width, "height": height
        }, animations="disabled")
        if not 1000 <= len(jpeg) <= 700000:
            raise RuntimeError("Unexpected screenshot size")
        print("REVIEW_PROOF: newest verified review captured", flush=True)
        return {"account": "yan_first", "profile_id": pid, "text_verified": True,
                "image": base64.b64encode(jpeg).decode("ascii"), "mime": "image/jpeg"}
    finally:
        page.close()
