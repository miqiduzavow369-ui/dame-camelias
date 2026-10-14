"""Read-only extraction and genuine screenshot of an owner's matching review.

The caller supplies an already authenticated Playwright browser context.
This code never presses Submit and never modifies review forms.
"""
import base64
import re
from urllib.parse import urlparse
from review_verification import find_exact_review, validate_comments_url

def capture_review_proof(ctx, host, profile_id, expected_text, max_pages=8):
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
        for index in range(max_pages):
            url = f"https://{host}/user_comments.php?comments_type=0&sort_mycomm=0&pageCommentsMy={index}"
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            if not validate_comments_url(page.url, host):
                raise RuntimeError("Unexpected comments destination")
            selected = page.locator(".commentsSelectedSection")
            if selected.count() != 1 or "Ваши отзывы" not in selected.first.inner_text():
                raise RuntimeError("Owner review tab not selected")
            candidate = find_exact_review(page.content(), pid, expected_text)
            if candidate is None:
                continue
            card = page.locator(f"#ankcrd{pid}")
            if card.count() != 1:
                raise RuntimeError("Review card ambiguous")
            table = card.evaluate_handle("""card => {
                let node=card.nextElementSibling;
                while(node && node.tagName==='BR') node=node.nextElementSibling;
                return node && node.matches('table.rating-block-wrapper')?node:null;
            }""").as_element()
            if table is None:
                raise RuntimeError("Matching review table missing")
            actual = table.locator("td.ver11 p")
            if actual.count() != 1 or " ".join(actual.inner_text().split()) != " ".join(expected_text.split()):
                raise RuntimeError("Review text changed since verification")
            card.scroll_into_view_if_needed(timeout=10000)
            # The actual rendered screenshot includes both the profile card and its review.
            a=card.bounding_box()
            b=table.bounding_box()
            if not a or not b:
                raise RuntimeError("Review card not visible")
            x=min(a["x"],b["x"])
            y=min(a["y"],b["y"])
            width=max(a["x"]+a["width"],b["x"]+b["width"])-x
            height=max(a["y"]+a["height"],b["y"]+b["height"])-y
            if x<0 or y<0 or width<200 or width>1400 or height<100 or height>1600:
                raise RuntimeError("Invalid screenshot bounds")
            photo=card.locator(".imganketa img")
            if photo.count()==1:
                try:
                    photo.first.evaluate("""img=>{img.loading='eager'}""")
                    photo.first.scroll_into_view_if_needed(timeout=10000)
                    page.wait_for_timeout(500)
                except Exception:
                    pass
            jpeg=page.screenshot(type="jpeg",quality=78,clip={"x":x,"y":y,"width":width,"height":height},animations="disabled")
            if len(jpeg)<1000 or len(jpeg)>700000:
                raise RuntimeError("Unexpected screenshot size")
            return {"account":"yan_first","profile_id":pid,"text_verified":True,
                    "image":base64.b64encode(jpeg).decode("ascii"),"mime":"image/jpeg"}
        return None
    finally:
        page.close()
