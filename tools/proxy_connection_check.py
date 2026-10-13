#!/usr/bin/env python3
"""Proxy-only connectivity check; never requests Intimcity or stores credentials."""
import ipaddress
import json
import os
from playwright.sync_api import sync_playwright

def main():
    host = os.environ.get("PROXY_HOST", "")
    user = os.environ.get("PROXY_USERNAME", "")
    password = os.environ.get("PROXY_PASSWORD", "")
    expected = os.environ.get("EXPECTED_EGRESS_IP", "")
    if not all((host, user, password, expected)):
        raise RuntimeError("FAIL: required proxy secrets missing")
    expected_address = ipaddress.ip_address(expected)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, proxy={
            "server": f"http://{host}:6408",
            "username": user,
            "password": password,
        })
        try:
            page = browser.new_page()
            page.goto("https://api.ipify.org?format=json", wait_until="domcontentloaded", timeout=30000)
            seen = ipaddress.ip_address(json.loads(page.locator("body").inner_text(timeout=8000))["ip"])
            if seen != expected_address:
                raise RuntimeError("FAIL: proxy outbound IP does not match EXPECTED_EGRESS_IP")
            print("PASS: proxy connected and outgoing IP matches expected value")
        finally:
            browser.close()

if __name__ == "__main__":
    main()
