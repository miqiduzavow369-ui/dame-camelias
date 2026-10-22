"""Offline smoke check. No site requests, credentials, callbacks or publications."""
from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(locale="ru-RU", service_workers="block")
            try:
                context.route("**/*", lambda route: route.abort())
                page = context.new_page()
                page.set_content('<html lang="ru"><body><h1>Проверка браузера</h1></body></html>')
                if page.locator("h1").inner_text() != "Проверка браузера":
                    raise RuntimeError("Offline Chromium text check failed")
                if not page.screenshot(type="png").startswith(b"\x89PNG\r\n\x1a\n"):
                    raise RuntimeError("Offline Chromium render check failed")
            finally:
                context.close()
        finally:
            browser.close()
    print("SECONDARY_BROWSER_RUNTIME: offline Chromium ready", flush=True)

if __name__ == "__main__": main()
