import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"tools"))
from review_live_workflow import run_review

TEXT="Очень классная, был у нее не так давно. Очень позитивная, поржали и потрахались. Все супер"
HOST="b.intimcity.rip"
PID="652282"

class Field:
    def __init__(self):
        self.value=""
        self.clicked=0
        self.calls=[]
    def count(self):return 1
    def is_visible(self):return True
    def fill(self,value):self.calls.append("fill");self.value=value
    def press(self,key):self.calls.append("press")
    def type(self,value,delay=0):self.calls.append("type");self.value+=value
    def input_value(self):return self.value
    def locator(self,selector):
        if selector=="xpath=ancestor::form[1]":return Form()
        raise AssertionError(selector)
class Submit:
    def __init__(self):self.clicked=0
    def count(self):return 1
    def is_visible(self):return True
    def click(self,**kwargs):self.clicked+=1
class Form:
    submit=Submit()
    def count(self):return 1
    def get_attribute(self,name):
        return {"method":"POST","action":f"https://{HOST}/indi/anketa{PID}.htm"}[name]
    def locator(self,selector):
        assert selector=='input[name="submit"][type="submit"]'
        return self.submit
class Page:
    def __init__(self):
        self.url=f"https://{HOST}/indi/anketa{PID}.htm"
        self.field=Field()
        self.waits=[]
        Form.submit=Submit()
    def goto(self,url,**kw):self.url=url
    def locator(self,selector):
        if selector=='textarea[name="personcomment"]':return self.field
        if selector=='textarea[name="comment_text"]':return type("Empty",(),{"count":lambda self:0})()
        raise AssertionError(selector)
    def wait_for_timeout(self,t):self.waits.append(t)
    def close(self):pass
class Context:
    def __init__(self):self.page=Page();self.calls=0
    def new_page(self):self.calls+=1;return self.page

class LiveReviewTests(unittest.TestCase):
    def test_real_entry_and_exactly_one_submission(self):
        ctx=Context()
        real={"account":"yan_first","profile_id":PID,"text_verified":True,"image":"jpeg","mime":"image/jpeg"}
        with patch("review_live_workflow.capture_review_proof",side_effect=[None,real]) as find:
            result=run_review(ctx,PID,HOST,"review_publish",TEXT,report_stage=lambda kind:None,profile_page=ctx.page)
        self.assertEqual(result["proof"],real)
        self.assertEqual(Form.submit.clicked,1)
        self.assertEqual(ctx.page.field.value,TEXT)
        self.assertEqual(ctx.page.field.calls,["fill","press","type"])
        self.assertEqual(find.call_count,2)
    def test_existing_review_not_submitted_again(self):
        ctx=Context()
        with patch("review_live_workflow.capture_review_proof",return_value={"verified":True}):
            result=run_review(ctx,PID,HOST,"review_publish",TEXT,report_stage=lambda kind:None,profile_page=ctx.page)
        self.assertFalse(result["attempted"])
        self.assertTrue(result["already_exists"])
        self.assertEqual(ctx.calls,0)
    def test_proof_only_never_submits(self):
        ctx=Context()
        with patch("review_live_workflow.capture_review_proof",return_value=None):
            result=run_review(ctx,PID,HOST,"review_proof",TEXT,profile_page=ctx.page)
        self.assertFalse(result["attempted"])
        self.assertEqual(ctx.calls,0)
    def test_uncertain_result_never_retries_submission(self):
        ctx=Context()
        with patch("review_live_workflow.capture_review_proof",return_value=None):
            result=run_review(ctx,PID,HOST,"review_publish",TEXT,report_stage=lambda kind:None,profile_page=ctx.page)
        self.assertTrue(result["attempted"])
        self.assertFalse(result["confirmed"])
        self.assertEqual(Form.submit.clicked,1)
    def test_invalid_target_before_navigation(self):
        ctx=Context()
        with self.assertRaises(ValueError):
            run_review(ctx,"../../etc/passwd",HOST,"review_publish",TEXT)
        self.assertEqual(ctx.calls,0)

if __name__=="__main__":unittest.main()
