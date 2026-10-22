"""Operation-scoped result signing. The Worker master key never leaves Worker."""
import base64
import hashlib
import hmac
import re
import time

def result_signing_key(grant):
    value = grant.get("resultSigningKey")
    if not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", value):
        raise RuntimeError("Operation result signing unavailable before browser start")
    return bytes.fromhex(value)

def build_rating_result(grant, proof):
    secret = result_signing_key(grant)
    account, uid, pid, nonce = (grant[k] for k in ("accountId", "userId", "profileId", "nonce"))
    if not isinstance(proof, dict) or proof.get("account") != account or proof.get("profile_id") != pid or proof.get("mime") != "image/jpeg":
        raise RuntimeError("No account-matched authenticated screenshot")
    encoded = proof.get("image")
    if not isinstance(encoded, str): raise RuntimeError("Original proof not returned")
    jpeg = base64.b64decode(encoded, validate=True)
    if not 90 <= len(jpeg) <= 700000 or not jpeg.startswith(b"\xff\xd8\xff") or not jpeg.endswith(b"\xff\xd9"):
        raise RuntimeError("Invalid original JPEG")
    checksum = hashlib.sha256(jpeg).hexdigest()
    file_id = "jpeg_" + checksum[:40]
    reference = "proof_" + hashlib.sha256((uid+":"+account+":"+pid+":"+grant["approvedSelectionsSha256"]+":"+checksum).encode()).hexdigest()[:40]
    at = int(time.time()*1000)
    identity = {"userId": uid, "accountId": account, "profileId": pid, "kind": "rating", "nonce": nonce}
    fields = ["secondary-result-v1", uid, account, pid, "rating", nonce,
              str(grant["proxyVersion"]), str(grant["siteVersion"]), str(at),
              "verified_published", reference, file_id]
    signature = hmac.new(secret, ":".join(fields).encode(), hashlib.sha256).hexdigest()
    return {"identity": identity, "token": grant["callbackTicket"], "input": {
        "identity": identity, "proxyVersion": grant["proxyVersion"], "siteVersion": grant["siteVersion"],
        "issuedAt": at, "status": "verified_published", "sitePublicationId": reference, "proofFileId": file_id},
        "signature": signature, "originalJpegBase64": encoded}
