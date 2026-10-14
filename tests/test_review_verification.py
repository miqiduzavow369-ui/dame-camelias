import unittest
import importlib.util
from pathlib import Path

path=Path(__file__).resolve().parents[1]/"tools"/"review_verification.py"
spec=importlib.util.spec_from_file_location("review_verification",path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def item(pid,text):
    return (f'<div class="storyLeft" id="ankcrd{pid}"><a href="/indi/anketa{pid}.htm">Evelyn</a></div>'
            f'<table class="rating-block-wrapper"><tbody><tr><td class="otziv_men">'
            f'<table><tr><td class="ver11"><div class="ot_head"><b>Evelyn</b></div>'
            f'<p>{text}</p></td></tr></table></td></tr></tbody></table>')

class ReviewVerifierTests(unittest.TestCase):
    def test_exact_match(self):
        self.assertEqual(module.find_exact_review(item(771053,"Текст настоящего отзыва"),771053,"Текст настоящего отзыва")["profile_id"],"771053")
    def test_wrong_profile(self):
        self.assertIsNone(module.find_exact_review(item(771053,"Текст настоящего отзыва"),652282,"Текст настоящего отзыва"))
    def test_different_text(self):
        self.assertIsNone(module.find_exact_review(item(771053,"Текст настоящего отзыва"),771053,"Совсем другой текст отзыва"))
    def test_duplicate_is_ambiguous(self):
        html=item(771053,"Текст настоящего отзыва")*2
        self.assertIsNone(module.find_exact_review(html,771053,"Текст настоящего отзыва"))
    def test_whitespace_only_normalization(self):
        self.assertIsNotNone(module.find_exact_review(item(771053,"Текст   настоящего\n отзыва"),771053,"Текст настоящего отзыва"))
    def test_punctuation_matters(self):
        self.assertIsNone(module.find_exact_review(item(771053,"Текст настоящего отзыва."),771053,"Текст настоящего отзыва"))
    def test_site_added_final_period(self):
        text="Очень классная, был у нее не так давно. Очень позитивная, поржали и потрахались. Все супер"
        self.assertIsNotNone(module.find_exact_review(item(652282,text+"."),652282,text))
        self.assertFalse(module.review_text_matches(text+"!!",text))
    def test_url_validation(self):
        self.assertTrue(module.validate_comments_url("https://b.intimcity.rip/user_comments.php?pageCommentsMy=1","b.intimcity.rip"))
        self.assertFalse(module.validate_comments_url("https://evil.com/user_comments.php","b.intimcity.rip"))
        self.assertFalse(module.validate_comments_url("https://b.intimcity.rip/user_comments.php?redirect=x","b.intimcity.rip"))

if __name__=="__main__":
    unittest.main()
