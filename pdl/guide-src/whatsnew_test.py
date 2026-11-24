"""Exercises the What's new sheet and the move to the new address against the mock library.

usage: whatsnew_test.py <app_html> <out_dir>   (env CHANGELOG_JSON, GUIDE_HTML)

VERSION HISTORY
  v1  2026-11-20  What's new for new, existing, admin and locked devices; old-address forwarding.
  v2  2026-11-22  Reads the passcode from the app under test instead of hardcoding it.
"""
import os, re, sys, json, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "capture.py")).read().split("\nwith sync_playwright() as p:")[0]
ns = {"__file__": os.path.join(HERE, "capture.py"), "__name__": "cap"}
exec(compile(src, "capture.py", "exec"), ns)
OUT = ns["OUT"]
CHANGELOG = open(os.environ["CHANGELOG_JSON"], "rb").read()
ns["GUIDE_SRC"] = open(os.environ["GUIDE_HTML"], "rb").read() if os.environ.get("GUIDE_HTML") else None
from playwright.sync_api import sync_playwright

base_handler = ns["handler"]
state = {"changelog": CHANGELOG, "new_home_up": True}

def handler(route, request):
    from urllib.parse import urlparse
    u = urlparse(request.url)
    if u.hostname == "app.local" and u.path == "/pdl/changelog.json":
        return route.fulfill(status=200, headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}, body=state["changelog"])
    if u.hostname == "c1jumpw.github.io":
        if u.path in ("/mkp-tools/pdl/", "/mkp-tools/pdl/index.html"):
            return route.fulfill(status=200, headers={"Content-Type": "text/html"}, body=ns["APP_SRC"])
        if u.path == "/mkp-tools/pdl/changelog.json":
            return route.fulfill(status=200, headers={"Content-Type": "application/json"}, body=state["changelog"])
    if u.hostname == "mypd.mkcworkspace.com":
        if not state["new_home_up"]:
            return route.abort("namenotresolved")
        if u.path == "/changelog.json":
            return route.fulfill(status=200, headers={"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}, body=state["changelog"])
        if u.path == "/":
            return route.fulfill(status=200, headers={"Content-Type": "text/html"}, body=ns["APP_SRC"])
    return base_handler(route, request)

NOW = datetime.datetime(2026, 11, 20, 8, 5, tzinfo=datetime.timezone(datetime.timedelta(hours=-5)))

def page_for(browser, url="http://app.local/pdl/", ls=None, unlocked=True, theme="dark"):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True,
                              has_touch=True, timezone_id="America/New_York", locale="en-US")
    ctx.route("**/*", handler)
    page = ctx.new_page()
    page.clock.set_fixed_time(NOW)
    page.add_init_script(ns["INIT"] % json.dumps({"theme": theme, "layout": "list", "unlocked": unlocked, "whatsnew": True}))
    if ls:
        page.add_init_script("(() => { const o = %s; for (const k in o) localStorage.setItem(k, o[k]); })();" % json.dumps(ls))
    page.goto(url)
    return page

def sheet(page, wait=2500):
    try:
        page.wait_for_selector("#wnOverlay.show", timeout=wait)
    except Exception:
        return None
    page.wait_for_timeout(500)
    return {
        "kicker": page.inner_text("#wnKicker"), "title": page.inner_text("#wnTitle"), "sub": page.inner_text("#wnSub"),
        "items": page.eval_on_selector_all(".wn-item-title", "els => els.map(e => e.textContent)"),
        "groups": page.eval_on_selector_all(".wn-group", "els => els.map(e => e.textContent)"),
    }

results = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. existing device, never seen What's new, not an admin device
    pg = page_for(b); r = sheet(pg); results["existing_everyone"] = r
    pg.screenshot(path=os.path.join(OUT, "whatsnew.png"))
    seen_after = pg.evaluate("localStorage.getItem('pdl_whatsnew_v1')")
    results["seen_after_open"] = seen_after
    pg.locator("#wnOk").click(); pg.wait_for_timeout(300)
    results["closed"] = not pg.evaluate("document.getElementById('wnOverlay').classList.contains('show')")
    # 2. turn Organize on: admin notes appear
    pg.locator(".organize-toggle .slider").click()
    r = sheet(pg); results["organize_admin"] = r
    pg.screenshot(path=os.path.join(OUT, "whatsnew-admin.png"))
    pg.locator("#wnOk").click()
    # 3. Organize again in the same session: nothing more
    pg.locator(".organize-toggle .slider").click(); pg.locator(".organize-toggle .slider").click()
    results["organize_again"] = sheet(pg, 1500)
    # 4. reload: nothing (everything seen)
    pg.reload(); results["reload"] = sheet(pg, 2500)
    pg.context.close()

    # 5. admin device opening the app: both, with a For admins group
    pg = page_for(b, ls={"pdl_admin_device_v1": "1"}); r = sheet(pg); results["admin_device_open"] = r
    pg.evaluate("document.querySelector('#wnBody').scrollTop = 1000"); pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(OUT, "whatsnew-both.png"))
    # "Show me in the guide" opens the guide at that chapter
    pg.locator(".wn-show").first.click(); pg.wait_for_timeout(1200)
    results["show_me_guide_open"] = pg.evaluate("document.getElementById('guideOverlay').classList.contains('show')")
    results["show_me_src"] = pg.evaluate("document.getElementById('guideFrame').getAttribute('src')")
    pg.context.close()

    # 6. locked device: nothing until the passcode is entered
    pg = page_for(b, unlocked=False)
    results["locked_before"] = sheet(pg, 2000)
    code = re.search(r'const PASSCODE = "(\d{4})"', ns["APP_SRC"].decode()).group(1)  # from the app, not this file
    pg.locator("#lockInput").fill(code)
    results["locked_after_unlock"] = (sheet(pg) or {}).get("title")
    pg.context.close()

    # 7. light theme look
    pg = page_for(b, theme="light"); sheet(pg)
    pg.screenshot(path=os.path.join(OUT, "whatsnew-light.png"))
    pg.context.close()

    # 8. several updates since the last visit (adds two pretend future releases)
    log = json.loads(CHANGELOG)
    fake = json.loads(json.dumps(log["releases"][-1]))
    r2 = dict(fake, version="2026.11.20-2", date="2026-11-20", title="Pretend follow-up", items=[{"type": "fixed", "audience": "everyone", "title": "Pretend fix", "text": "Test only."}])
    log["releases"].append(r2)
    state["changelog"] = json.dumps(log).encode()
    pg = page_for(b, ls={"pdl_whatsnew_v1": json.dumps({"everyone": "2026.11.19"})})
    results["multi"] = sheet(pg)
    pg.screenshot(path=os.path.join(OUT, "whatsnew-multi.png"))
    pg.context.close()
    state["changelog"] = CHANGELOG

    # 9. old address, new address live: redirected, no sheet on the old host
    pg = page_for(b, url="https://c1jumpw.github.io/mkp-tools/pdl/#vault")
    pg.wait_for_timeout(2500)
    results["old_host_redirect_to"] = pg.url
    pg.context.close()
    # 10. old address, new address not set up yet: stays, and shows What's new there
    state["new_home_up"] = False
    pg = page_for(b, url="https://c1jumpw.github.io/mkp-tools/pdl/")
    r = sheet(pg, 4000)
    results["old_host_dns_missing_url"] = pg.url
    results["old_host_dns_missing_sheet"] = (r or {}).get("title")
    pg.context.close()
    b.close()

print(json.dumps(results, indent=1, ensure_ascii=False))
print("unhandled:", ns["UNHANDLED"])
