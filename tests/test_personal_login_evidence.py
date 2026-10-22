"""Offline authentication evidence; never connects to Intimcity or a proxy."""
import ast
import hashlib
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from urllib.parse import urlencode
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
from intimcity_authenticated_identity import (watch_credentialed_login,
    authenticated_identity_status, observed_authenticated_site_email)

LOGIN = "owner@example.test"
PASSWORD = "synthetic-sensitive-password"

class Element:
    def __init__(self, text=""):
        self.text = text
    def is_visible(self): return True
    def get_attribute(self, key): return None
    def inner_text(self): return self.text

class Locator:
    def __init__(self, items=()): self.items = list(items)
    def count(self): return len(self.items)
    def all(self): return self.items
    @property
    def first(self): return self.items[0]

class Context:
    def __init__(self, cookies=None, origins=None):
        self.saved_cookies = cookies or []
        self.origins = origins or []
    def cookies(self, urls): return self.saved_cookies
    def storage_state(self): return {"origins": self.origins}

class Page:
    def __init__(self, *, cookies=None, origins=None, header=""):
        self.url = "https://c.intimcity.rip/"
        self.context = Context(cookies, origins)
        self.main_frame = object()
        self.listeners = []
        self.header = header
        self.authenticated = True
        self.password_visible = False
        self.fields = {}
    def on(self, name, callback):
        assert name == "response"
        self.listeners.append(callback)
    def emit(self, login=LOGIN, password=PASSWORD, *, status=302, method="POST",
             url="https://c.intimcity.rip/login", main_frame=True, navigation=True, body=None):
        request = types.SimpleNamespace(method=method, url=url,
            frame=self.main_frame if main_frame else object(),
            is_navigation_request=lambda: navigation,
            post_data=body if body is not None else urlencode({"login": login, "password": password}))
        response = types.SimpleNamespace(request=request, status=status)
        for callback in self.listeners: callback(response)
    def locator(self, selector):
        if selector == "form": return Locator([Form(self)])
        if "logout" in selector: return Locator([Element()] if self.authenticated else [])
        if "password" in selector: return Locator([Element()] if self.password_visible else [])
        if selector == 'header [data-account-email]':
            return Locator([Element(self.header)] if self.header else [])
        return Locator()
    def goto(self, url, **kwargs): self.url = url
    def wait_for_load_state(self, *args, **kwargs): pass
    def wait_for_timeout(self, *args): pass

class Input(Element):
    def __init__(self, page, name): self.page, self.name = page, name
    def fill(self, value): self.page.fields[self.name] = value
    def click(self, **kwargs):
        self.page.emit(**self.page.fields)
        self.page.authenticated = True
        self.page.password_visible = False
    def press(self, *args): self.click()

class Form(Element):
    def __init__(self, page): self.page = page
    def locator(self, selector):
        name = "login" if 'name="login"' in selector else "password" if 'name="password"' in selector else "submit"
        return Locator([Input(self.page, name)])

class PersonalLoginEvidence(unittest.TestCase):
    def test_all_29_login_sessions_require_exact_personal_post(self):
        accounts = ["yan_second"] + [f"yan_{i:02}" for i in range(3, 31)]
        for account in accounts:
            with self.subTest(account=account):
                login, password = account + "@example.test", account + "-synthetic"
                page = Page()
                self.assertTrue(watch_credentialed_login(page, login, password))
                self.assertEqual(authenticated_identity_status(page, login), "identity_unverified")
                page.emit(login=login, password=password)
                self.assertEqual(authenticated_identity_status(page, login), "identity_verified")
                self.assertEqual(observed_authenticated_site_email(page, login), login)
                self.assertNotEqual(authenticated_identity_status(page, "other@example.test"), "identity_verified")

    def test_no_response_wrong_login_password_status_frame_or_host_cannot_prove_identity(self):
        cases = [{"login": "someone@example.test"}, {"password": "other-password"},
                 {"method": "GET"}, {"status": 401}, {"status": 500},
                 {"main_frame": False}, {"navigation": False},
                 {"url": "https://c.intimcity.rip.evil.test/login"},
                 {"url": "http://c.intimcity.rip/login"},
                 {"body": "login=owner%40example.test&login=other%40example.test&password=" + PASSWORD},
                 {"body": ""}]
        for case in cases:
            with self.subTest(case=case):
                page = Page()
                watch_credentialed_login(page, LOGIN, PASSWORD)
                page.emit(**case)
                self.assertNotEqual(authenticated_identity_status(page, LOGIN), "identity_verified")
                self.assertIsNone(observed_authenticated_site_email(page, LOGIN))

    def test_authenticated_markers_are_required_even_after_successful_post(self):
        for change in ({"authenticated": False}, {"password_visible": True},
                       {"url": "https://evil.test/"}, {"header": "someone@example.test"}):
            with self.subTest(change=change):
                page = Page()
                watch_credentialed_login(page, LOGIN, PASSWORD)
                page.emit()
                for key, value in change.items(): setattr(page, key, value)
                self.assertNotEqual(authenticated_identity_status(page, LOGIN), "identity_verified")

    def test_existing_cookies_or_site_storage_cannot_use_post_fallback(self):
        for page in (Page(cookies=[{"name": "session", "value": "existing"}]),
                     Page(origins=[{"origin": "https://c.intimcity.rip", "localStorage": []}])):
            self.assertFalse(watch_credentialed_login(page, LOGIN, PASSWORD))
            page.emit()
            self.assertEqual(authenticated_identity_status(page, LOGIN), "identity_unverified")

    def test_later_foreign_login_invalidates_earlier_success_even_with_matching_header(self):
        page = Page(header=LOGIN)
        watch_credentialed_login(page, LOGIN, PASSWORD)
        page.emit()
        page.emit(login="other@example.test")
        self.assertEqual(authenticated_identity_status(page, LOGIN), "identity_mismatch")
        self.assertIsNone(observed_authenticated_site_email(page, LOGIN))

    def test_diagnostics_expose_only_fixed_tokens(self):
        page = Page()
        watch_credentialed_login(page, LOGIN, PASSWORD)
        page.emit()
        output = []
        self.assertEqual(authenticated_identity_status(page, LOGIN, lambda *v: output.append(v)), "identity_verified")
        self.assertEqual(output, [("identity_verified", "fresh_credentialed_login")])
        self.assertNotIn(LOGIN, str(output))
        self.assertNotIn(PASSWORD, str(output))

    def test_admin_runner_verifies_real_guard_without_any_email_widget(self):
        api = types.ModuleType("playwright.sync_api")
        api.sync_playwright = lambda: None
        spec = importlib.util.spec_from_file_location("login_evidence_runner", TOOLS / "man_site_login_preflight.py")
        runner = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"playwright": types.ModuleType("playwright"), "playwright.sync_api": api}):
            spec.loader.exec_module(runner)
        page = Page()
        page.authenticated = False
        page.password_visible = True
        self.assertEqual(runner.inspect_login(page, page.url, LOGIN, PASSWORD), "login_authenticated_identity_verified")
        self.assertEqual(observed_authenticated_site_email(page, LOGIN), LOGIN)

    def test_yan_first_inspect_actions_are_identical_to_established_baseline(self):
        tree = ast.parse((TOOLS / "intimcity_profile_lookup.py").read_text())
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "inspect")
        class LegacyPath(ast.NodeTransformer):
            def visit_If(self, node):
                if ast.unparse(node.test) == "os.environ.get('SECONDARY_EXPECTED_SITE_LOGIN')":
                    return None
                return self.generic_visit(node)
        fn = LegacyPath().visit(fn)
        digest = hashlib.sha256(ast.dump(fn, include_attributes=False).encode()).hexdigest()
        self.assertEqual(digest, "5a8bbc295524b4063199d4e77feb622034a102fa614a442327caf45aca5ceddc")

if __name__ == "__main__": unittest.main()
