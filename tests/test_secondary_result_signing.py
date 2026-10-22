"""Offline runner recovery: no browser or network calls."""
import base64
import hashlib
import hmac
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"tools"))
from secondary_man_result_signing import result_signing_key, build_rating_result
import secondary_man_rating_proof_recovery as recovery

class ResultSigning(unittest.TestCase):
    def grant(self):
        return dict(ok=True,mode="proof-recovery",readOnly=True,accountId="yan_second",userId="123456789",profileId="690230",nonce="abcdef123456",callbackTicket="a"*32,resultSigningKey="cd"*32,proxyVersion=2,siteVersion=3,approvedSelectionsSha256="ff"*32,siteUrl="https://c.intimcity.rip/",siteLogin="own@example.test",verifiedSiteLogin="own@example.test",sitePassword="own-password",proxyHost="own-proxy.test",proxyPort=8080,proxyUsername="own-proxy-user",proxyPassword="own-proxy-password",expectedIp="8.8.8.8")
    def proof(self):
        return dict(account="yan_second",profile_id="690230",mime="image/jpeg",image=base64.b64encode(b"\xff\xd8\xff"+b"0"*100+b"\xff\xd9").decode())
    def test_missing_key_and_wrong_account_fail(self):
        for key in (None,"","bad"):
            with self.assertRaises(RuntimeError): result_signing_key({"resultSigningKey":key})
        with self.assertRaises(RuntimeError):build_rating_result(self.grant(),{**self.proof(),"account":"yan_first"})
    def test_signature_canonical_and_original_bytes(self):
        g=self.grant()
        with patch("secondary_man_result_signing.time.time",return_value=200):out=build_rating_result(g,self.proof())
        fields=["secondary-result-v1",g["userId"],g["accountId"],g["profileId"],"rating",g["nonce"],"2","3","200000","verified_published",out["input"]["sitePublicationId"],out["input"]["proofFileId"]]
        self.assertEqual(out["signature"],hmac.new(bytes.fromhex(g["resultSigningKey"]),":".join(fields).encode(),hashlib.sha256).hexdigest())
        self.assertEqual(out["originalJpegBase64"],self.proof()["image"])
    def test_recovery_calls_only_read_mode_and_existing_result(self):
        g=self.grant();calls=[];modes=[]
        browser=types.SimpleNamespace(OWNER_HOST="a.intimcity.rip")
        def inspect(pid,mode):
            self.assertEqual(pid,g["profileId"]);modes.append(mode)
            self.assertEqual(__import__('os').environ["INTIMCITY_LOGIN"],g["siteLogin"])
            return {"proof":self.proof()}
        browser.inspect=inspect
        def call(path,payload=None,query=None):
            calls.append(path)
            return g if query else {"ok":True,"status":"completed"}
        values={"SECONDARY_ACCOUNT_ID":g["accountId"],"SECONDARY_USER_ID":g["userId"],"SECONDARY_PROFILE_ID":g["profileId"],"SECONDARY_RATING_NONCE":g["nonce"],"SECONDARY_CALLBACK_TICKET":"b"*32,"SECONDARY_SITE_HOST":"c.intimcity.rip"}
        with patch.dict("os.environ",values),patch.dict(sys.modules,{"intimcity_profile_lookup":browser}),patch.object(recovery,"call",side_effect=call):
            self.assertEqual(recovery.main(),0)
        self.assertEqual(modes,["secondary_rating_proof"])
        self.assertEqual(calls,["/api/secondary-man/rating-proof-recovery","/api/secondary-man/result"])
        self.assertEqual(browser.OWNER_HOST,"a.intimcity.rip")
        g.pop("resultSigningKey");modes.clear();calls.clear()
        with patch.dict("os.environ",values),patch.dict(sys.modules,{"intimcity_profile_lookup":browser}),patch.object(recovery,"call",side_effect=call):
            with self.assertRaises(RuntimeError):recovery.main()
        self.assertEqual(modes,[])
        self.assertEqual(calls,["/api/secondary-man/rating-proof-recovery"])
