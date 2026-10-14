"""Fill an owner-approved authentic review in two steps on the SAME page.

No submit, no navigation, no modifications to text and no bypass of site checks.
The caller must separately obtain explicit consent and a one-time submission claim.
"""

def stage_review_text(page, approved_text):
    if not isinstance(approved_text, str) or not (10 <= len(approved_text) <= 3000):
        raise ValueError("Invalid approved text")
    if approved_text != approved_text.strip():
        raise ValueError("Approved text must not have leading/trailing whitespace")
    field = page.locator('textarea[name="personcomment"]')
    if field.count() != 1 or not field.is_visible():
        raise RuntimeError("Expected exactly one visible new-review field")
    # Existing published reviews are displayed as multiple read-only
    # textarea[name="comment_text"] elements. They are unrelated to the
    # single editable textarea[name="personcomment"] and must not block it.
    # Never interact with any existing-review textarea.
    split = len(approved_text) // 2
    first, second = approved_text[:split], approved_text[split:]
    # Fill once and then append; do not navigate, reload, or clear after first half.
    field.fill(first)
    if field.input_value() != first:
        raise RuntimeError("First half changed in site field")
    field.press("End")
    field.type(second, delay=0)
    if field.input_value() != approved_text:
        raise RuntimeError("Final review text differs from owner-approved text")
    return True
