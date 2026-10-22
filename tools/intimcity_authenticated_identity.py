#!/usr/bin/env python3
"""Conservative read-only account-identity inspection in authenticated Intimcity.

Evidence is an authenticated account header or a completed, account-bound login
request from an initially empty browser context. Filled inputs alone are not proof.
This helper intentionally never posts ratings or reviews.
"""
import re
import hashlib
import hmac
from weakref import WeakKeyDictionary
from urllib.parse import urlsplit, parse_qs

EMAIL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,24}$")
HOSTS = {"a.intimcity.rip", "b.intimcity.rip", "c.intimcity.rip"}
_logins = WeakKeyDictionary()

def _site_url(value):
    try:
        u = urlsplit(value)
        return (u.scheme == "https" and u.hostname in HOSTS and
                not u.username and not u.password and u.port is None)
    except ValueError:
        return False

def watch_credentialed_login(page, expected_login, password):
    """Observe this page's own POST, never send credentials or make a request.

    Install before opening Intimcity in the newly created personal context.
    The observer keeps digests, not passwords, and never logs request contents.
    Its result still needs Yan First's authenticated-page markers afterwards.
    """
    _logins.pop(page, None)
    if not isinstance(expected_login, str) or not EMAIL.fullmatch(expected_login.strip()) or not password:
        return False
    try:
        context = page.context
        origins = ["https://" + host + "/" for host in HOSTS]
        if context.cookies(origins):
            return False
        for origin in context.storage_state().get("origins", []):
            if _site_url(origin.get("origin", "")):
                return False
    except Exception:
        return False
    state = {"login": expected_login.strip().casefold(), "accepted": False, "foreign": False}
    password_hash = hashlib.sha256(password.encode("utf-8")).digest()
    _logins[page] = state
    def response_received(response):
        try:
            request = response.request
            if (request.method != "POST" or not request.is_navigation_request() or
                    request.frame != page.main_frame or not _site_url(request.url)):
                return
            body = request.post_data or ""
            if len(body) > 16000:
                return
            fields = parse_qs(body, keep_blank_values=True)
            if "login" not in fields or "password" not in fields:
                return
            # A later login with different credentials invalidates this evidence.
            matches = (fields["login"] == [expected_login] and len(fields["password"]) == 1 and
                       hmac.compare_digest(hashlib.sha256(fields["password"][0].encode("utf-8")).digest(), password_hash))
            if not matches:
                state["foreign"] = True
                state["accepted"] = False
            elif not state["foreign"] and 200 <= response.status < 400:
                state["accepted"] = True
            else:
                state["accepted"] = False
        except Exception:
            # Malformed/unavailable network evidence cannot prove identity.
            state["accepted"] = False
    page.on("response", response_received)
    return True

def matches_verified_account(expected_login, observed_text):
    if not isinstance(expected_login, str) or not isinstance(observed_text, str):
        return False
    expected = expected_login.strip().casefold()
    observed = observed_text.strip().casefold()
    return bool(EMAIL.fullmatch(expected_login.strip()) and
                EMAIL.fullmatch(observed_text.strip()) and expected == observed)

def authenticated_identity_status(page, expected_login, diagnostic=None):
    """Return a safe status code, not an identity string or page contents.

    Strict requirements:
    - authenticated logout marker is present
    - visible account page does not contain a password form
    - matching authenticated header OR this fresh context's successful own-login POST
    - never use the sign-in form's filled email as evidence
    """
    def finish(status, reason):
        # Only fixed status/reason tokens; never email, HTML, URL or form values.
        if diagnostic is not None:
            diagnostic(status, reason)
        return status
    if not _site_url(page.url):
        return finish("identity_unverified", "unsupported_host")
    logout = page.locator('a[href*="logout"], a[href*="exit"], button:has-text("Выйти"), a:has-text("Выход")')
    if not logout.count():
        return finish("identity_unverified", "logout_marker_missing")
    if page.locator('form input[type="password"]:visible').count():
        return finish("identity_unverified", "password_form_visible")
    evidence = _logins.get(page)
    if evidence and evidence["foreign"]:
        return finish("identity_mismatch", "different_login_request")
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
    if not observed:
        if evidence and evidence["accepted"] and evidence["login"] == expected_login.strip().casefold():
            return finish("identity_verified", "fresh_credentialed_login")
        if evidence:
            return finish("identity_unverified", "login_request_unconfirmed")
        return finish("identity_unverified", "account_email_missing")
    if len(set(x.casefold() for x in observed)) != 1:
        return finish("identity_unverified", "account_email_ambiguous")
    if matches_verified_account(expected_login, observed[0]):
        return finish("identity_verified", "account_email_matches")
    return finish("identity_mismatch", "account_email_mismatch")

def observed_authenticated_site_email(page, expected_login):
    """Return the verified login after header or fresh credentialed-login proof.
    The submitted input alone is never evidence of successful authentication.
    """
    if authenticated_identity_status(page, expected_login)!="identity_verified":
        return None
    selectors = [
        'header [data-account-email]',
        'header [data-user-email]',
        '.user-account [data-email]',
        '.account-details .account-email',
        '.profile-menu .account-email',
    ]
    values=[]
    for selector in selectors:
        for element in page.locator(selector).all():
            if element.is_visible():
                value=(element.get_attribute("data-account-email") or
                       element.get_attribute("data-user-email") or
                       element.get_attribute("data-email") or
                       element.inner_text()).strip()
                if value:
                    values.append(value)
    if len(set(v.casefold() for v in values))!=1:
        evidence = _logins.get(page)
        if not values and evidence and evidence["accepted"] and not evidence["foreign"]:
            return evidence["login"] if matches_verified_account(expected_login, evidence["login"]) else None
        return None
    return values[0] if matches_verified_account(expected_login,values[0]) else None

