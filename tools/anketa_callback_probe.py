#!/usr/bin/env python3
"""Check deployed callback route without transmitting credentials or profile data."""
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import os

base = os.environ.get("ANKETA_CALLBACK_URL", "")
if not base.startswith("https://") or not base.endswith("/api/anketa/result"):
    raise SystemExit("FAIL: ANKETA_CALLBACK_URL missing or incorrect format")
root = base[:-len("/result")]
for suffix, method in [("/health","GET"),("/result","POST")]:
    request = Request(root + suffix, method=method, headers={
        "User-Agent":"dame-camelias-diagnostic",
        "Content-Type":"application/json",
    }, data=b"{}" if method=="POST" else None)
    try:
        with urlopen(request, timeout=20) as result:
            code=result.status
            marker=result.headers.get("X-DC-Callback-Handler","")
            content=result.read(80).decode("utf-8","replace") if suffix=="/health" else ""
    except HTTPError as error:
        code=error.code
        marker=error.headers.get("X-DC-Callback-Handler","")
        content=""
    except URLError:
        print(f"CHECK {suffix}: network error")
        continue
    if suffix=="/health":
        print(f"CHECK health: HTTP {code}; current_worker={content=='anketa-handler-v2'}")
    else:
        print(f"CHECK callback without auth: HTTP {code}; worker_handler_reached={marker=='reached'}")
