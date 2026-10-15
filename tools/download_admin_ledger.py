"""Run on the owner's computer. Never paste the existing secret into chat."""
import datetime
import getpass
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward credentials to another address.


def validate(raw):
    data = json.loads(raw)
    if (data.get("format") != "dame-camelias-owner-ledger-v1"
            or data.get("userId") != "5866034656"
            or data.get("objectName") != "publication-credits:5866034656"
            or data.get("storageKey") != "credits_v1"):
        raise ValueError("Unexpected export identity")
    ledger = data.get("value")
    if not isinstance(ledger, dict) or not isinstance(ledger.get("claims"), dict) or not isinstance(ledger.get("history"), list):
        raise ValueError("Incomplete ledger structure")
    for key in ("grant", "spent"):
        if type(ledger.get(key)) is not int or ledger[key] < 0:
            raise ValueError("Invalid ledger totals")
    return data


def main():
    origin = input("Existing Worker HTTPS address (*.workers.dev): ").strip()
    url = urllib.parse.urlsplit(origin)
    if (url.scheme != "https" or not url.hostname or not url.hostname.endswith(".workers.dev")
            or url.username or url.password or url.port not in (None, 443)
            or url.query or url.fragment or url.path not in ("", "/")):
        raise ValueError("Use only the existing Worker's HTTPS workers.dev origin")
    secret = getpass.getpass("Existing ANKETA_CALLBACK_TOKEN (hidden; enter locally only): ")
    if not secret or "\n" in secret or "\r" in secret:
        raise ValueError("Missing or invalid credential")
    request = urllib.request.Request(origin.rstrip("/") + "/api/admin/ledger-backup",
                                     headers={"Authorization": "Bearer " + secret})
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=30) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError("Response too large; backup not saved")
    except urllib.error.HTTPError as error:
        raise ValueError("Export failed (HTTP %s); no backup confirmed" % error.code) from None
    data = validate(raw)
    os.umask(0o077)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    directory = Path.home() / ("DAME_CAMELIAS_ADMIN_LEDGER_" + stamp)
    directory.mkdir(mode=0o700)
    target = directory / "admin-ledger.json"
    with target.open("xb") as output:
        output.write(raw)
    digest = hashlib.sha256(raw).hexdigest()
    with (directory / "SHA256SUMS.txt").open("x", encoding="utf-8") as output:
        output.write(digest + "  admin-ledger.json\n")
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise ValueError("Local verification failed")
    ledger = data["value"]
    print("Saved and checksum verified:", directory)
    print("Spent:", ledger["spent"], "History entries:", len(ledger["history"]))
    print("This is the owner credit record, not a full KV/DO backup.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, urllib.error.URLError):
        # Do not print HTTP bodies, request headers, or credentials on errors.
        print("Backup failed. No complete backup confirmed; check access and export availability.")
        raise SystemExit(1)
