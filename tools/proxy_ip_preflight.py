#!/usr/bin/env python3
"""Fail-closed proxy egress test. Does not access Intimcity."""
import json
import os
import sys
import urllib.parse
import urllib.request

CHECK_URL = "https://api.ipify.org?format=json"

def main():
    host = os.environ.get("PROXY_HOST", "").strip()
    port = os.environ.get("PROXY_PORT", "6408").strip()
    username = os.environ.get("PROXY_USERNAME", "")
    password = os.environ.get("PROXY_PASSWORD", "")
    expected = os.environ.get("EXPECTED_EGRESS_IP", "").strip()
    if not all((host, port, username, password, expected)):
        raise RuntimeError("Missing proxy settings or EXPECTED_EGRESS_IP")
    if not port.isdecimal() or not (1 <= int(port) <= 65535):
        raise RuntimeError("Invalid proxy port")

    credentials = urllib.parse.quote(username, safe="") + ":" + urllib.parse.quote(password, safe="")
    proxy_url = f"http://{credentials}@{host}:{port}"
    # No default/direct network handlers: proxy connection errors fail the check.
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": proxy_url, "http": proxy_url})
    )
    request = urllib.request.Request(CHECK_URL, headers={"Accept": "application/json"})
    with opener.open(request, timeout=15) as response:
        detected = json.load(response).get("ip", "")
    if detected != expected:
        print("FAIL: egress IP does not match configured allowlist.", file=sys.stderr)
        return 1
    print("PASS: proxy egress IP matched allowlist.")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        # Avoid disclosing proxy URL or credentials from exception text.
        print(f"FAIL: proxy check unsuccessful ({type(exc).__name__}).", file=sys.stderr)
        sys.exit(1)
