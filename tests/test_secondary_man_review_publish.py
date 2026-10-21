"""Offline guards for the isolated secondary review authorization boundary."""
import hashlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from secondary_man_review_publish import (validate_secondary_review_grant,
                                          review_preflight_status)

TEXT = "Это индивидуальный подтверждённый текст настоящего отзыва."

def sample():
    return {
        "accountId": "yan_second", "profileId": "690230", "mode": "publish",
        "kind": "review", "status": "attempted",
        "proxyHost": "127.0.0.1", "proxyPort": 8080,
        "proxyVersion": 3, "siteVersion": 4,
        "siteUrl": "https://b.intimcity.rip/",
        "expectedIp": "127.0.0.1",
        "proxyUsername": "proxy-user", "proxyPassword": "not-a-real-secret",
        "siteLogin": "author@example.test", "verifiedSiteLogin": "author@example.test",
        "sitePassword": "not-a-real-secret",
        "oneUseClaimConsumed": True, "ownerOperationConfirmed": True,
        "independentAuthorConfirmed": True, "moderatorApproved": True,
        "creditReserved": True, "siteIdentityVerified": True,
        "callbackTicket": "a" * 32, "nonce": "b" * 16,
        "approvedTextSha256": hashlib.sha256(TEXT.encode("utf-8")).hexdigest()
    }

class ReviewGrantTests(unittest.TestCase):
    def test_authorized_preflight_never_enables_post(self):
        result = review_preflight_status(sample(), "yan_second", "690230", TEXT)
        self.assertTrue(result["reviewBound"])
        self.assertFalse(result["publicationEnabled"])
        self.assertFalse(result["siteSubmitted"])

    def test_different_man_and_legacy_rejected(self):
        for man in ("yan_first", "yan_03"):
            with self.subTest(man=man), self.assertRaises(RuntimeError):
                validate_secondary_review_grant(sample(), man, "690230", TEXT)

    def test_different_profile_rejected(self):
        with self.assertRaises(RuntimeError):
            validate_secondary_review_grant(sample(), "yan_second", "690231", TEXT)

    def test_modified_review_rejected(self):
        with self.assertRaises(RuntimeError):
            validate_secondary_review_grant(sample(), "yan_second", "690230", TEXT + " Изменено.")

    def test_missing_moderation_or_claim_rejected(self):
        for field in ("moderatorApproved", "oneUseClaimConsumed", "creditReserved",
                      "independentAuthorConfirmed", "siteIdentityVerified"):
            grant = sample()
            grant[field] = False
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                validate_secondary_review_grant(grant, "yan_second", "690230", TEXT)

    def test_identity_mismatch_rejected(self):
        grant = sample()
        grant["verifiedSiteLogin"] = "different@example.test"
        with self.assertRaises(RuntimeError):
            validate_secondary_review_grant(grant, "yan_second", "690230", TEXT)

if __name__ == "__main__":
    unittest.main()
