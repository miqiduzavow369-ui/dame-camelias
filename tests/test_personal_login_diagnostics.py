import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# Import the runner without installing or starting a real browser.
TOOLS = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))
api = types.ModuleType("playwright.sync_api")
api.sync_playwright = lambda: None
spec = importlib.util.spec_from_file_location("personal_login_under_test", TOOLS / "man_site_login_preflight.py")
runner = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"playwright": types.ModuleType("playwright"), "playwright.sync_api": api}):
    spec.loader.exec_module(runner)


class PersonalLoginDiagnostics(unittest.TestCase):
    def test_stage_error_never_prints_exception_credentials(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(runner.LoginStageError) as caught:
            runner.login_step("login_password_fill", lambda: (_ for _ in ()).throw(
                TimeoutError("synthetic-sensitive-password https://secret.invalid/")))
        self.assertEqual(caught.exception.stage, "login_password_fill")
        self.assertEqual(caught.exception.error_kind, "timeout")
        self.assertNotIn("synthetic-sensitive-password", output.getvalue())
        self.assertNotIn("secret.invalid", output.getvalue())
        self.assertIn("stage=login_password_fill; kind=timeout", output.getvalue())

    def test_site_open_timeout_is_a_site_stage(self):
        page = MagicMock()
        page.goto.side_effect = TimeoutError("synthetic-sensitive-url")
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(runner.LoginStageError) as caught:
            runner.inspect_login(page, "https://b.intimcity.rip/", "synthetic", "synthetic")
        self.assertEqual(caught.exception.stage, "site_open")

    def test_real_login_sequence_identifies_email_fill_timeout(self):
        page, form, email, password = (MagicMock() for _ in range(4))
        page.url = "https://b.intimcity.rip/"
        page.locator.return_value.all.return_value = [form]
        form.locator.side_effect = lambda s: email if 'name="login"' in s else password
        form.is_visible.return_value = True
        email.count.return_value = password.count.return_value = 1
        email.first.is_visible.return_value = True
        email.first.fill.side_effect = TimeoutError("synthetic-sensitive-login")
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(runner.LoginStageError) as caught:
            runner.inspect_login(page, page.url, "synthetic", "synthetic")
        self.assertEqual(caught.exception.stage, "login_email_fill")
        password.first.fill.assert_not_called()

    def test_passed_proxy_ip_is_never_blamed_for_login_stage_errors(self):
        config = {"MAN_SITE_ACCOUNT_ID": "yan_second", "MAN_SITE_NONCE": "a" * 32,
                  "MAN_SITE_HOST": "b.intimcity.rip", "ANKETA_CALLBACK_URL": "https://audit.invalid/api/anketa/result"}
        details = {"ok": True, "accountId": "yan_second", "nonce": "a" * 32,
                   "siteUrl": "https://b.intimcity.rip/", "proxyHost": "proxy.example.test",
                   "proxyPort": 8080, "proxyUsername": "synthetic", "proxyPassword": "synthetic-sensitive-proxy",
                   "siteLogin": "synthetic@example.test", "sitePassword": "synthetic-sensitive-site", "expectedIp": "8.8.8.8"}
        for stage, expected in runner.LOGIN_FAILURE_CODES.items():
            with self.subTest(stage=stage):
                manager, browser, context, page = (MagicMock() for _ in range(4))
                manager.__enter__.return_value.chromium.launch.return_value = browser
                browser.new_context.return_value = context
                context.new_page.return_value = page
                page.locator.return_value.inner_text.return_value = json.dumps({"ip": "8.8.8.8"})
                requests = MagicMock(side_effect=[details, {"ok": True}])
                output = io.StringIO()
                with patch.object(runner, "required", side_effect=config.__getitem__), \
                     patch.object(runner, "request_json", requests), \
                     patch.object(runner, "sync_playwright", return_value=manager), \
                     patch.object(runner, "inspect_login", side_effect=runner.LoginStageError(stage, "timeout")), \
                     contextlib.redirect_stdout(output):
                    self.assertEqual(runner.main(), 1)
                result = requests.call_args_list[-1].args[1]
                self.assertEqual(result["code"], expected)
                self.assertEqual(result["failure_stage"], stage)
                self.assertNotEqual(result["code"], "proxy_error")
                self.assertNotIn("synthetic-sensitive", output.getvalue())


if __name__ == "__main__":
    unittest.main()
