"""Account/profile metadata binding without changing the original screenshot."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"tools"))
from secondary_man_review_job import bind_review_proof

class ReviewProofBindingTests(unittest.TestCase):
    def proof(self):
        return dict(account="yan_first",profile_id="690230",text_verified=True,mime="image/jpeg",image="unmodified-original-jpeg")
    def test_all_29_bind_own_metadata_and_preserve_original_bytes(self):
        for account in ["yan_second"]+["yan_"+str(n).zfill(2) for n in range(3,31)]:
            with self.subTest(account=account):
                source=self.proof()
                proof=bind_review_proof(source,account,"690230")
                self.assertEqual(proof["account"],account)
                self.assertEqual(proof["image"],source["image"])
                self.assertEqual(source["account"],"yan_first")
    def test_wrong_profile_account_and_unverified_text_are_rejected(self):
        for changes in [dict(profile_id="690231"),dict(account="yan_03"),dict(text_verified=False),dict(mime="image/png")]:
            with self.subTest(changes=changes),self.assertRaises(RuntimeError):
                bind_review_proof({**self.proof(),**changes},"yan_second","690230")
        with self.assertRaises(RuntimeError):bind_review_proof(self.proof(),"yan_first","690230")
