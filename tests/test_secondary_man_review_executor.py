"""Offline execution guard tests."""
import unittest
from test_secondary_man_review_publish import sample, TEXT
from secondary_man_review_executor import execute_secondary_review

class Page:
    url="https://b.intimcity.rip/indi/anketa690230.htm"

class TestExecutionGuard(unittest.TestCase):
    def call(self,**kwargs):
        options=dict(browser_context=object(),profile_page=Page(),
                     authenticated_account="yan_second",
                     authenticated_site_login="author@example.test",
                     record_submit_boundary=lambda record:True)
        options.update(kwargs)
        return execute_secondary_review(sample(),"yan_second","690230",TEXT,**options)

    def test_rejects_wrong_account(self):
        with self.assertRaises(RuntimeError):
            self.call(authenticated_account="yan_first")

    def test_rejects_wrong_browser_identity(self):
        with self.assertRaises(RuntimeError):
            self.call(authenticated_site_login="another@example.test")

    def test_rejects_missing_audit(self):
        with self.assertRaises(RuntimeError):
            self.call(record_submit_boundary=None)

    def test_rejects_wrong_page(self):
        page=Page()
        page.url="https://b.intimcity.rip/indi/anketa690231.htm"
        with self.assertRaises(RuntimeError):
            self.call(profile_page=page)

if __name__=="__main__":
    unittest.main()
