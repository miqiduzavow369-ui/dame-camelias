import importlib.util
import sys
import unittest
from pathlib import Path

tools=Path(__file__).resolve().parents[1]/"tools"
sys.path.insert(0,str(tools))
spec=importlib.util.spec_from_file_location("review_proof_capture",tools/"review_proof_capture.py")
capture=importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)

class FakePage:
    def __init__(self,url,html):
        self.url=url
        self.html=html
        self.visits=[]
    def set_viewport_size(self, size): pass
    def goto(self,url,**kw): self.url=url;self.visits.append(url)
    def locator(self,selector): return FakeLocator(selector)
    def content(self): return self.html
    def close(self): pass
class FakeLocator:
    def __init__(self,selector): self.selector=selector
    def count(self): return 1 if self.selector=='input[name="comments_type"][value="0"]' else 0
    def filter(self, **kwargs): return self
    @property
    def first(self): return self
    def inner_text(self): return "Ваши отзывы (15)"
class FakeContext:
    def __init__(self,page):self.page=page
    def new_page(self):return self.page

class CaptureSafetyTests(unittest.TestCase):
    def test_missing_owner_tab_fails_closed_without_submission(self):
        page=FakePage("https://b.intimcity.rip/user_comments.php","<html></html>")
        with self.assertRaisesRegex(RuntimeError,"Your reviews tab not selected"):
            capture.capture_review_proof(FakeContext(page),"b.intimcity.rip","652282",
                  "Настоящий согласованный отзыв",max_pages=3)
        self.assertEqual(page.visits,["https://b.intimcity.rip/user_comments.php"])
    def test_invalid_host_rejected_before_navigation(self):
        page=FakePage("","")
        with self.assertRaises(ValueError):
            capture.capture_review_proof(FakeContext(page),"attacker.example","652282",
              "Настоящий согласованный отзыв")
        self.assertEqual(page.visits,[])
    def test_invalid_profile_rejected_before_navigation(self):
        page=FakePage("","")
        with self.assertRaises(ValueError):
            capture.capture_review_proof(FakeContext(page),"b.intimcity.rip","../",
              "Настоящий согласованный отзыв")
        self.assertEqual(page.visits,[])
if __name__=="__main__":
    unittest.main()
