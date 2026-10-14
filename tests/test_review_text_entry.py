import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"tools"))
from review_text_entry import stage_review_text

class Field:
    def __init__(self):
        self.value=""
        self.calls=[]
    def count(self): return 1
    def is_visible(self): return True
    def fill(self,v): self.calls.append(("fill",v));self.value=v
    def input_value(self):return self.value
    def press(self,k):self.calls.append(("press",k))
    def type(self,v,delay=0):self.calls.append(("type",v));self.value+=v
class Zero:
    def count(self): return 0
class Page:
    def __init__(self): self.field=Field();self.selectors=[]
    def locator(self,s):
        self.selectors.append(s)
        return self.field if s=='textarea[name="personcomment"]' else Zero()

class EntryTests(unittest.TestCase):
    def test_two_operations_without_reload_or_overwrite(self):
        page=Page()
        text="Очень классная, был у нее не так давно. Очень позитивная, поржали и потрахались. Все супер"
        self.assertTrue(stage_review_text(page,text))
        self.assertEqual(page.field.value,text)
        self.assertEqual([x[0] for x in page.field.calls],["fill","press","type"])
        self.assertEqual(page.field.calls[0][1]+page.field.calls[2][1],text)
        self.assertNotIn('textarea[name="comment_text"]',page.selectors[:1])
    def test_no_auto_submit(self):
        page=Page()
        stage_review_text(page,"Реальный текст настоящего отзыва")
        self.assertEqual(page.selectors,['textarea[name="personcomment"]','textarea[name="comment_text"]'])
    def test_reject_short(self):
        with self.assertRaises(ValueError): stage_review_text(Page(),"Кратко")
    def test_reject_extra_whitespace(self):
        with self.assertRaises(ValueError): stage_review_text(Page()," Реальный текст настоящего отзыва")
if __name__=="__main__": unittest.main()
