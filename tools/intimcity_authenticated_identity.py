#!/usr/bin/env python3
"""Conservative read-only account-identity inspection in authenticated Intimcity.

The authenticated header and account page, not the login form or a user-supplied
query parameter, are possible evidence sources. Ambiguous evidence is rejected.
This helper intentionally never posts ratings or reviews.
"""
import re
from urllib.parse import urlsplit

EMAIL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,24}$")

def matches_verified_account(expected_login, observed_text):
    if not isinstance(expected_login, str) or not isinstance(observed_text, str):
        return False
    expected = expected_login.strip().casefold()
    observed = observed_text.strip().casefold()
    return bool(EMAIL.fullmatch(expected_login.strip()) and
                EMAIL.fullmatch(observed_text.strip()) and expected == observed)

def authenticated_identity_status(page, expected_login):
    """Return a safe status code, not an identity string or page contents.

    Strict requirements:
    - authenticated logout marker is present
    - visible account page does not contain a password form
    - a distinct account header element visibly states exactly the expected email
    - never use the sign-in form's filled email as evidence
    """
    url = urlsplit(page.url)
    if url.scheme != "https" or url.hostname not in ("a.intimcity.rip", "b.intimcity.rip"):
        return "identity_unverified"
    logout = page.locator('a[href*="logout"], a[href*="exit"], button:has-text("Выйти"), a:has-text("Выход")')
    if not logout.count():
        return "identity_unverified"
    if page.locator('form input[type="password"]:visible').count():
        return "identity_unverified"
    # Explicitly constrain evidence to authenticated account-header widgets.
    selectors = [
        'header [data-account-email]',
        'header [data-user-email]',
        '.user-account [data-email]',
        '.account-details .account-email',
        '.profile-menu .account-email',
    ]
    observed = []
    for selector in selectors:
        for element in page.locator(selector).all():
            if not element.is_visible():
                continue
            value = (element.get_attribute("data-account-email") or
                     element.get_attribute("data-user-email") or
                     element.get_attribute("data-email") or
                     element.inner_text()).strip()
            if value:
                observed.append(value)
    if len(set(x.casefold() for x in observed)) != 1:
        return "identity_unverified"
    return "identity_verified" if matches_verified_account(expected_login, observed[0]) else "identity_mismatch"
