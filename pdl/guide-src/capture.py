"""Photographs the real My PD app (live index.html) against the mock library in mockdata.py.

Every network request is answered locally; anything not explicitly mocked is aborted, so
nothing can reach the real repo or relay. Writes out PNG screenshots plus callout
positions (as % of the frame) in shots.json.

usage: python3 capture.py <app_html> <out_dir> [only_id ...]

VERSION HISTORY
  v1  2026-10-30  First capture of every screen for the guide.
  v2  2026-11-20  What's new shots; suppresses What's new elsewhere; range requests for media.
  v3  2026-11-22  Moved to c3jumpw/mkp-tools/pdl/guide-src.
"""
import json, os, sys, datetime
from urllib.parse import urlparse, unquote, parse_qs
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mockdata as M

APP_HTML, OUT = sys.argv[1], sys.argv[2]
ONLY = set(sys.argv[3:])
os.makedirs(OUT, exist_ok=True)
ASSETS = os.path.join(HERE, "assets")
COVER_DIR = os.path.join(ASSETS, "covers")
MP3 = open(os.path.join(ASSETS, "silence.mp3"), "rb").read()
WEBM = open(os.path.join(ASSETS, "sunrise.webm"), "rb").read()
APP_SRC = open(APP_HTML, "rb").read()
GUIDE_SRC = None
CHANGELOG_SRC = open(os.environ["CHANGELOG_JSON"], "rb").read() if os.environ.get("CHANGELOG_JSON") else None
W, H = 390, 844
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS"}
UNHANDLED = []

ALL_FILES = {e["path"]: e for entries in M.FOLDERS.values() for e in entries}


def fulfill_json(route, obj, status=200):
    route.fulfill(status=status, headers=dict(CORS, **{"Content-Type": "application/json"}), body=json.dumps(obj))


def sort_rows(rows, sort, name_key):
    key, _, direction = (sort or "created_at.desc").partition(".")
    if key in ("term", "topic", "title"):
        key = name_key
    rows = sorted(rows, key=lambda r: (r.get(key) or "").lower() if isinstance(r.get(key), str) else r.get(key))
    return list(reversed(rows)) if direction == "desc" else rows


def media(route, request, data, ctype):
    rng = request.headers.get("range")
    base = dict(CORS, **{"Content-Type": ctype, "Accept-Ranges": "bytes"})
    if rng and rng.startswith("bytes="):
        a, _, b = rng[6:].partition("-")
        start = int(a or 0)
        end = min(int(b) if b else len(data) - 1, len(data) - 1)
        return route.fulfill(status=206, body=data[start:end + 1], headers=dict(base, **{
            "Content-Range": f"bytes {start}-{end}/{len(data)}", "Content-Length": str(end - start + 1)}))
    return route.fulfill(status=200, headers=base, body=data)


def handler(route, request):
    u = urlparse(request.url)
    host, method = u.hostname, request.method
    if method == "OPTIONS":
        return route.fulfill(status=204, headers=CORS)
    if host == "app.local":
        if u.path in ("/pdl/", "/pdl/index.html"):
            return route.fulfill(status=200, headers={"Content-Type": "text/html; charset=utf-8"}, body=APP_SRC)
        if u.path == "/pdl/changelog.json" and CHANGELOG_SRC:
            return route.fulfill(status=200, headers={"Content-Type": "application/json"}, body=CHANGELOG_SRC)
        if u.path == "/pdl/guide.html" and GUIDE_SRC:
            return route.fulfill(status=200, headers={"Content-Type": "text/html; charset=utf-8"}, body=GUIDE_SRC)
        return route.fulfill(status=404, body="nope")
    if host == "api.github.com":
        p = unquote(u.path[len("/repos/c1jumpw/mkp-tools/contents/"):])
        if p in M.FOLDERS:
            return fulfill_json(route, M.FOLDERS[p])
        if p in ALL_FILES:
            return fulfill_json(route, ALL_FILES[p])
        return fulfill_json(route, {"message": "Not Found"}, 404)
    if host == "raw.githubusercontent.com":
        p = unquote(u.path[len("/c1jumpw/mkp-tools/main/"):])
        if p in M.COVERS:
            return route.fulfill(status=200, headers=dict(CORS, **{"Content-Type": "image/jpeg"}),
                                 body=open(os.path.join(COVER_DIR, M.COVERS[p] + ".jpg"), "rb").read())
        if p.endswith(".collection-covers/morning-ritual.jpg"):
            return route.fulfill(status=200, headers=dict(CORS, **{"Content-Type": "image/jpeg"}),
                                 body=open(os.path.join(COVER_DIR, "banner.jpg"), "rb").read())
        name = p.split("/")[-1]
        if p.endswith(".summary.json"):
            base = name[: -len(".summary.json")]
            if base in M.SUMMARIES:
                return fulfill_json(route, {"text": M.SUMMARIES[base]})
        if p.endswith(".transcript.json") and name.startswith("B. The_High"):
            return fulfill_json(route, M.TRANSCRIPT_B)
        if p.endswith(".md"):
            return route.fulfill(status=200, headers=dict(CORS, **{"Content-Type": "text/plain"}), body=M.MARKDOWN_DOC)
        return route.fulfill(status=404, headers=CORS, body="404")
    if host == "cdn.jsdelivr.net":
        p = unquote(u.path)
        if p.endswith(".mp4"):
            return media(route, request, WEBM, "video/webm")
        if p.endswith((".m4a", ".mp3")):
            return media(route, request, MP3, "audio/mpeg")
        return route.fulfill(status=404, headers=CORS, body="404")
    if host == "purge.jsdelivr.net":
        return fulfill_json(route, {})
    if host == "pdl-relay.c1-jumpw.workers.dev":
        p = unquote(u.path)
        q = parse_qs(u.query)
        if method == "GET" and p == "/contents/pdl/media/.collections.json":
            return fulfill_json(route, {"content": M.b64json(M.COLLECTIONS), "sha": "c0ffee"})
        if method == "GET" and p == "/contents/pdl/media/trash/.trash-meta.json":
            return fulfill_json(route, {"content": M.b64json(M.TRASH_META), "sha": "7ra54"})
        if method == "GET" and p in ("/vault", "/topics", "/ideas"):
            rows, key = {"/vault": (M.TERMS, "term"), "/topics": (M.TOPICS, "topic"), "/ideas": (M.IDEAS, "title")}[p]
            s = (q.get("search") or [""])[0].lower()
            if s:
                rows = [r for r in rows if s in json.dumps(r).lower()]
            return fulfill_json(route, sort_rows(rows, (q.get("sort") or [None])[0], key))
        if method == "POST" and p == "/define":
            return fulfill_json(route, M.DEFINE_KAIZEN)
        if method == "POST" and p == "/ask-followup":
            return fulfill_json(route, M.ASK_ANSWER)
        if p.startswith("/stream/"):
            return media(route, request, MP3, "audio/mpeg")
    UNHANDLED.append(f"{method} {request.url}")
    return route.abort()


INIT = """
(() => {
  const o = %s;
  const d = new Date();
  const today = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  try {
    if (o.unlocked) localStorage.setItem("pdl_unlocked_v1", "1");
    localStorage.setItem("pdl_theme_v1", o.theme);
    localStorage.setItem("pdl_layout_v1", o.layout);
    localStorage.setItem("pdl_speed_v1", "1");
    localStorage.setItem("pdl_practice_cache_v1", JSON.stringify({date: today, paths: ["pdl/media/B. The_High_Achiever_Operating_System.m4a"]}));
    // What's new would cover every other screenshot; it gets its own shots below.
    if (!o.whatsnew) localStorage.setItem("pdl_whatsnew_v1", JSON.stringify({everyone: "9999", admin: "9999"}));
  } catch (e) {}
  // Native dialogs can't be photographed and would block; accept them silently.
  window.alert = () => {};
  window.confirm = () => false;
  window.prompt = () => null;
})();
"""

RESULTS = {}


def new_page(browser, theme="dark", layout="list", unlocked=True, whatsnew=False):
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=2,
                              is_mobile=True, has_touch=True, timezone_id="America/New_York",
                              locale="en-US")
    ctx.route("**/*", handler)
    page = ctx.new_page()
    page.clock.set_fixed_time(datetime.datetime(2026, 10, 30, 8, 12, tzinfo=datetime.timezone(datetime.timedelta(hours=-4))))
    page.add_init_script(INIT % json.dumps({"theme": theme, "layout": layout, "unlocked": unlocked, "whatsnew": whatsnew}))
    page.goto("http://app.local/pdl/")
    page.wait_for_timeout(400)
    return page


def ready(page, selector=".item"):
    page.wait_for_selector(selector, timeout=8000)
    page.wait_for_timeout(500)


def scroll_to(page, selector, offset=12):
    page.evaluate("""([s, off]) => { const e = document.querySelector(s); window.scrollTo(0, window.scrollY + e.getBoundingClientRect().top - off); }""", [selector, offset])
    page.wait_for_timeout(250)


def point(box, at):
    x, y, w, h = box["x"], box["y"], box["width"], box["height"]
    if at == "l": return x + min(14, w / 2), y + h / 2
    if at == "r": return x + w - min(14, w / 2), y + h / 2
    if at == "t": return x + w / 2, y + min(12, h / 2)
    if at == "b": return x + w / 2, y + h - min(12, h / 2)
    if at == "tl": return x + min(16, w / 2), y + min(14, h / 2)
    if at == "tr": return x + w - min(16, w / 2), y + min(14, h / 2)
    return x + w / 2, y + h / 2


def cap(page, sid, callouts):
    if ONLY and sid not in ONLY:
        return
    page.wait_for_timeout(350)
    path = os.path.join(OUT, sid + ".png")
    page.screenshot(path=path)
    out = []
    for c in callouts:
        key, sel = c[0], c[1]
        at = c[2] if len(c) > 2 else "c"
        nth = c[3] if len(c) > 3 else 0
        loc = page.locator(sel).nth(nth)
        try:
            box = loc.bounding_box(timeout=1500)
        except Exception:
            box = None
        if not box:
            print(f"  ! {sid}: no box for {key} ({sel})")
            continue
        x, y = point(box, at)
        if not (0 <= x <= W and 0 <= y <= H):
            print(f"  ! {sid}: {key} off-frame ({x:.0f},{y:.0f})")
            continue
        out.append({"key": key, "x": round(x / W * 100, 2), "y": round(y / H * 100, 2), "at": at,
                    "box": [round(box["x"], 1), round(box["y"], 1), round(box["width"], 1), round(box["height"], 1)]})
    RESULTS[sid] = {"file": sid + ".png", "w": W, "h": H, "callouts": out}
    print(f"  ✓ {sid} ({len(out)}/{len(callouts)} callouts)")


def row(page, text):
    return page.locator(".item", has_text=text).first


def run(browser):
    # ---------- everyday ----------
    page = new_page(browser, unlocked=False)
    page.wait_for_selector("#lockOverlay.show")
    cap(page, "lock", [("code", "#lockInput"), ("unlock", "#lockSubmit")])
    page.context.close()

    page = new_page(browser)
    ready(page)
    page.wait_for_selector("#practiceCard", state="visible")
    cap(page, "home", [
        ("brand", "#greetingHeader", "!R"), ("guide", "#guideBtn"), ("theme", "#themeToggle"), ("organize", ".organize-toggle .switch"),
        ("practice", "#practiceCard .practice-label", "l"), ("play", "#practicePlay"),
        ("tabs", ".view-toggle"), ("search", "#search", "l"), ("filters", ".filters .filter-chip", "c", 2),
        ("upload", "#crumbs .pill-btn"), ("layout", "#crumbs .layout-toggle"),
        ("folder", ".item.folder", "r"),
    ])
    # file rows
    scroll_to(page, ".item:not(.folder)")
    cap(page, "files", [
        ("icon", ".item:not(.folder) .item-icon", "c", 0), ("title", ".item:not(.folder) .item-title", "l", 1),
        ("meta", ".item:not(.folder) .item-meta", "l", 2), ("badge", ".item-summary-badge", "c", 1),
        ("multipart", ".item:not(.folder) .item-meta", "l", 5),
    ])
    page.evaluate("window.scrollTo(0,0)")
    # grid
    page.locator('#crumbs .layout-btn[data-layout="grid"]').click()
    page.wait_for_timeout(1200)
    scroll_to(page, ".tile.folder:nth-child(3)", -40)
    cap(page, "grid", [
        ("folder", ".tile.folder", "c", 2),
        ("cover", ".tile:not(.folder) .tile-art", "c", 2), ("kind", ".tile:not(.folder) .tile-kind", "c", 1),
        ("summary", ".tile-summary", "c", 0),
    ])
    page.locator('#crumbs .layout-btn[data-layout="list"]').click()
    page.wait_for_timeout(500)

    # player + transcript
    scroll_to(page, "#crumbs")
    row(page, "High Achiever").click()
    page.wait_for_selector("#miniPlayer.show")
    page.locator("#miniSpeed").click()
    page.locator("#miniTranscript").click()
    page.wait_for_selector(".transcript-line")
    page.evaluate("document.getElementById('audioEl').currentTime = 82")
    page.wait_for_timeout(1300)
    scroll_to(page, ".item.playing", 300)
    cap(page, "player", [
        ("playing", ".item.playing", "!badge"), ("title", "#miniTitle", "!T"), ("scrub", "#miniProgress", "!c"),
        ("transport", "#miniPlayPause", "!T"), ("speed", "#miniSpeed", "!T"), ("transcript", "#miniTranscript", "!B"),
        ("summary", "#miniSummary", "!R"), ("close", "#miniClose", "!T"), ("line", ".transcript-line.active"),
    ])
    # summary (read)
    page.locator("#miniSummary").click()
    page.wait_for_selector("#suEditBtn")
    cap(page, "summary", [("file", "#suFileName", "l"), ("body", "#suBody", "tl"), ("edit", "#suEditBtn"), ("close", "#suClose")])
    page.locator("#suClose").click()
    page.locator("#miniClose").click()

    # video
    row(page, "Morning Visualization").click()
    page.wait_for_selector("#modalOverlay.show video")
    page.wait_for_function("document.querySelector('#modalContent video').readyState >= 2", timeout=8000)
    page.evaluate("const v=document.querySelector('#modalContent video'); v.pause(); v.currentTime = 3.2;")
    page.wait_for_timeout(700)
    cap(page, "video", [("video", "#modalContent video", "c"), ("speed", "#modalSpeed"), ("summary", "#modalSummary"), ("close", "#modalClose")])
    page.locator("#modalClose").click()

    # document
    row(page, "Weekly Reflection").click()
    page.wait_for_selector(".doc-text")
    cap(page, "doc", [("text", ".doc-text", "tl"), ("close", "#modalClose")])
    page.locator("#modalClose").click()

    # collections
    page.evaluate("window.scrollTo(0,0)")
    page.locator('.view-tab[data-view="collections"]').click()
    page.wait_for_timeout(400)
    page.locator("#collectionsBar .filter-chip", has_text="Morning Ritual").click()
    page.wait_for_selector(".coll-header.has-image", timeout=8000)
    page.locator('#collectionsBar .layout-btn[data-layout="grid"]').click()
    page.wait_for_timeout(1200)
    scroll_to(page, ".view-toggle")
    cap(page, "collections", [
        ("tab", '.view-tab[data-view="collections"]'), ("chips", "#collectionsBar .filter-chip", "c", 0),
        ("upload", "#collectionsBar .pill-btn", "c", 0), ("header", ".coll-header", "c"),
        ("item", "#listing .tile", "c", 0),
    ])
    page.locator('#collectionsBar .layout-btn[data-layout="list"]').click()

    # vault terms
    page.evaluate("window.scrollTo(0,0)")
    page.locator('.view-tab[data-view="vault"]').click()
    page.wait_for_selector(".vault-card")
    page.locator(".vault-card", has_text="Kaizen").click()
    page.wait_for_selector(".vault-detail")
    scroll_to(page, ".view-toggle")
    cap(page, "vault", [
        ("subtabs", ".vault-subtabs", "!tr"), ("new", "#vaultNewBtn"), ("sort", ".vault-sort-chip", "c", 1),
        ("card", ".vault-card .vault-term", "l", 0), ("subjects", ".vault-card .vault-subject", "c", 0),
        ("source", ".vault-card .vault-source", "l", 0), ("jump", ".vault-jump"), ("edit", ".vault-edit"),
        ("delete", ".vault-delete"),
    ])
    # by subject
    page.locator(".vault-card", has_text="Kaizen").first.click()
    page.locator('.vault-sort-chip[data-sort="subject.asc"]').click()
    page.wait_for_selector("#vaultSubjectFilterBar.show .subject-filter-chip")
    page.locator("#vaultSubjectFilterBar .subject-filter-chip", has_text="Mindset").click()
    page.wait_for_timeout(500)
    scroll_to(page, ".view-toggle")
    cap(page, "vault-subjects", [
        ("bysubject", '.vault-sort-chip[data-sort="subject.asc"]'),
        ("filter", "#vaultSubjectFilterBar .subject-filter-chip.active", "c", 0),
        ("none", "#vaultSubjectFilterBar .reset-chip"),
    ])
    page.locator('.vault-sort-chip[data-sort="created_at.desc"]').click()
    page.context.close()

    # term editor (opened while a track plays, so it links back to it)
    page = new_page(browser)
    ready(page)
    row(page, "High Achiever").click()
    page.wait_for_selector("#miniPlayer.show")
    page.wait_for_timeout(600)
    page.evaluate("document.getElementById('audioEl').currentTime = 75")
    page.wait_for_timeout(500)
    page.evaluate("document.getElementById('audioEl').pause()")
    page.locator('.view-tab[data-view="vault"]').click()
    page.wait_for_selector(".vault-card")
    page.locator("#vaultNewBtn").click()
    page.wait_for_selector("#veOverlay.show")
    page.locator("#veTermInput").fill("Kaizen")
    page.locator("#veLookupBtn").click()
    page.wait_for_function("document.getElementById('veDefinition').value.length > 0")
    page.wait_for_timeout(300)
    cap(page, "term-editor", [
        ("term", "#veTermInput", "l"), ("lookup", "#veLookupBtn"), ("lang", ".ve-language-badge"),
        ("source", ".ve-source-chip", "!B"), ("definition", "#veDefinition", "tl"), ("example", "#veExample", "tl"),
        ("newexample", "#veRefreshExampleBtn"), ("suggested", ".ve-suggest-chip", "!R", 1),
    ])
    page.locator(".ve-suggest-chip", has_text="Productivity").click()
    page.locator(".ve-suggest-chip", has_text="Mindset").click()
    page.locator("#veAskToggle").click()
    page.locator("#veAskInput").fill("How do I actually start small with this?")
    page.locator("#veAskBtn").click()
    page.wait_for_selector(".ve-ask-a")
    page.evaluate("document.querySelector('#veOverlay .ve-card').scrollTop = 0; document.querySelector('#veAskToggle').scrollIntoView({block:'start'})")
    page.wait_for_timeout(300)
    cap(page, "term-ask", [
        ("ask", "#veAskToggle", "l"), ("q", ".ve-ask-q", "l"), ("a", ".ve-ask-a", "c"),
        ("addnotes", ".ve-ask-add"), ("notes", "#veNotes", "tl"), ("attach", "#veAttachBtn"), ("save", "#veSave"),
    ])
    page.locator("#veCancel").click()

    # topic editor
    page.locator("#vaultSubtabTopics").click()
    page.wait_for_selector(".vault-card")
    page.locator("#vaultNewBtn").click()
    page.wait_for_selector("#topicOverlay.show")
    page.locator("#topicNameInput").fill("Second-order thinking")
    page.locator("#topicSimple").fill(M.TOPICS[0]["simple_explanation"])
    page.locator("#topicFull").fill(
        "Most decisions are judged by their first effect: does this help right now? Second-order thinking keeps going. "
        "It asks what that first effect will cause, and what that will cause in turn.\n\n"
        "Example: skipping sleep to finish work looks productive today (first order), but tomorrow's focus drops "
        "and the work takes longer (second order)…")
    page.locator("#topicSubjectInput").fill("Decision-making")
    page.keyboard.press("Enter")
    page.evaluate("document.querySelector('#topicOverlay .ve-card').scrollTop = 0")
    page.wait_for_timeout(300)
    cap(page, "topic-editor", [
        ("name", "#topicNameInput", "l"), ("simple", "#topicExplainSimpleBtn", "!L"), ("full", "#topicExplainFullBtn", "!L"),
        ("fulltext", "#topicFull", "tl"), ("subject", "#topicSubjectChips .ve-subject-chip", "c", 0),
    ])
    page.locator("#topicCancel").click()

    # idea editor
    page.locator("#vaultSubtabIdeas").click()
    page.wait_for_selector(".vault-card")
    page.locator("#vaultNewBtn").click()
    page.wait_for_selector("#ideaOverlay.show")
    page.locator("#ideaTitleInput").fill("Sunday 20-minute review ritual")
    page.locator("#ideaOriginalNote").fill(M.IDEAS[0]["original_note"])
    page.locator("#ideaSummary").fill(M.IDEAS[0]["summary"])
    for s in ("Habits", "Reflection"):
        page.locator("#ideaSubjectInput").fill(s)
        page.keyboard.press("Enter")
    page.evaluate("document.querySelector('#ideaOverlay .ve-card').scrollTop = 0")
    page.wait_for_timeout(300)
    cap(page, "idea-editor", [
        ("title", "#ideaTitleInput", "l"), ("note", "#ideaOriginalNote", "!br"), ("summarize", "#ideaSummarizeBtn"),
        ("summary", "#ideaSummary", "!B"), ("subjects", "#ideaSubjectChips .ve-subject-chip", "c", 0),
    ])
    page.locator("#ideaCancel").click()
    page.context.close()

    # ---------- admin ----------
    page = new_page(browser)
    ready(page)
    page.locator(".organize-toggle .slider").click()
    page.wait_for_selector(".organize-controls")
    cap(page, "organize-top", [("organize", ".organize-toggle .switch")])
    scroll_to(page, "#crumbs")
    first_file = '.item:not(.folder) .organize-controls'
    cap(page, "organize", [
        ("upload", "#crumbs .pill-btn", "c", 0), ("newfolder", "#crumbs .pill-btn", "c", 1),
        ("summary", first_file + ' [data-act="summary"]'), ("tag", first_file + ' [data-act="tag"]'),
        ("rename", first_file + ' [data-act="rename"]'), ("move", first_file + ' [data-act="move"]'),
        ("trash", first_file + ' [data-act="trash"]'),
    ])
    # rename
    row(page, "High Achiever").locator('[data-act="rename"]').click()
    page.wait_for_selector(".rename-row input")
    page.locator(".rename-row input").fill("B. The High Achiever Operating System")
    cap(page, "rename", [("input", ".rename-row input", "l"), ("ext", ".rename-ext"), ("save", ".rename-row button")])
    page.locator(".rename-row").evaluate("e => e.remove()")
    # tag modal
    row(page, "High Achiever").locator('[data-act="tag"]').click()
    page.wait_for_selector("#tagModalOverlay.show")
    cap(page, "tag-modal", [
        ("file", "#tagModalFile", "l"), ("list", ".tag-row", "!r", 0), ("new", "#newCollectionInput", "!r"),
        ("add", "#newCollectionBtn"), ("save", "#tagModalSave"),
    ])
    page.locator("#tagModalCancel").click()
    # summary edit
    row(page, "High Achiever").locator('[data-act="summary"]').click()
    page.wait_for_selector("#suAiBtn")
    page.wait_for_timeout(500)
    cap(page, "summary-edit", [("text", "#suInput", "tl"), ("ai", "#suAiBtn"), ("save", "#suSaveBtn")])
    page.locator("#suClose").click()
    # trash
    page.locator(".item.folder", has_text="Trash").click()
    page.wait_for_selector('[data-act="restore"]')
    page.wait_for_timeout(500)
    cap(page, "trash", [
        ("crumb", "#crumbs .seg.current"), ("meta", ".item .item-meta", "l", 0),
        ("restore", '[data-act="restore"]', "c", 0), ("delete", '[data-act="delete"]', "c", 0),
    ])
    page.locator("#crumbs .seg", has_text="Library").click()
    page.wait_for_timeout(600)
    # transcript editor (Organize on → the transcript panel offers Edit)
    row(page, "High Achiever").locator(".item-body").click()
    page.wait_for_selector("#miniPlayer.show")
    page.locator("#miniTranscript").click()
    page.wait_for_selector(".te-open-btn")
    page.locator(".te-open-btn").click()
    page.wait_for_selector("#teOverlay.show")
    page.evaluate("document.getElementById('audioEl').currentTime = 148; document.getElementById('audioEl').pause()")
    page.locator("#teLineInput").fill("Keep them short enough to remember without notes.")
    page.wait_for_timeout(400)
    cap(page, "transcript-editor", [
        ("tabs", ".te-tab", "c", 0), ("paste", ".te-tab", "c", 1), ("transport", "#tePlayPause", "!T"),
        ("time", "#teTime", "!R"), ("line", "#teLineInput", "!l"), ("add", "#teAddLine", "!T"), ("cues", ".te-cue-row", "l", 0),
        ("save", "#teSave"),
    ])
    page.locator('.te-tab[data-mode="paste"]').click()
    page.locator("#tePasteArea").fill("1\n00:00:00,000 --> 00:00:13,500\nEvery high achiever runs on a system, whether they designed it or not.\n\n2\n00:00:14,000 --> 00:00:30,000\nThe question is whether yours was chosen on purpose.\n")
    cap(page, "transcript-paste", [("area", "#tePasteArea", "tl")])
    page.locator("#teCancel").click()
    page.locator("#miniClose").click()
    # organize grid → cover editor
    page.locator('#crumbs .layout-btn[data-layout="grid"]').click()
    page.wait_for_timeout(1200)
    scroll_to(page, ".tile.folder:nth-child(3)", -40)
    cap(page, "organize-grid", [
        ("add", ".tile-cover-hint", "c", 0), ("change", ".tile-cover-hint", "c", 1),
    ])
    with page.expect_file_chooser() as fc:
        page.locator(".tile", has_text="Morning Visualization").click()
    fc.value.set_files(os.path.join(COVER_DIR, "sunrise.jpg"))
    page.wait_for_timeout(900)
    page.evaluate("const z=document.getElementById('ccZoom'); z.value=130; z.dispatchEvent(new Event('input'))")
    page.wait_for_timeout(300)
    cap(page, "cover-editor", [("stage", "#ccStage"), ("zoom", "#ccZoom"), ("remove", "#ccRemove"), ("save", "#ccSave")])
    page.locator("#ccCancel").click()
    page.locator('#crumbs .layout-btn[data-layout="list"]').click()
    # collections in organize mode
    page.evaluate("window.scrollTo(0,0)")
    page.locator('.view-tab[data-view="collections"]').click()
    page.locator("#collectionsBar .filter-chip", has_text="Morning Ritual").click()
    page.wait_for_selector(".coll-header.has-image", timeout=8000)
    page.wait_for_timeout(800)
    scroll_to(page, ".view-toggle")
    cap(page, "collections-organize", [
        ("newcoll", "#collectionsBar .pill-btn", "c", 1), ("cleanup", "#collCleanupBtn"),
        ("editheader", ".coll-header-edit"), ("tag", '.item [data-act="tag"]', "c", 0),
    ])
    # upload overlay (statuses are the app's own wording, filled in by hand)
    page.evaluate("""() => {
      document.getElementById('uploadDestLabel').textContent = 'Daily Affirmations';
      const rows = [
        ['Evening_wind_down.m4a', 'Done', 'ok'],
        ['Confidence_reset_long_form.m4a', 'Uploaded part 3 of 7 (43%)', ''],
        ['Breathwork_box_breathing.m4a', 'Waiting…', ''],
      ];
      document.getElementById('uploadList').innerHTML = rows.map(([n, s, c]) =>
        `<div class="upload-row"><span class="upload-row-name">${n}</span><span class="upload-row-status ${c}">${s}</span></div>`).join('');
      const b = document.getElementById('uploadDoneBtn'); b.textContent = 'Uploading…'; b.disabled = true;
      document.getElementById('uploadNote').style.display = 'block';
      document.getElementById('uploadOverlay').classList.add('show');
    }""")
    page.wait_for_timeout(300)
    cap(page, "upload", [("dest", "#uploadDestLabel", "l"), ("note", "#uploadNote", "l"),
                         ("done", ".upload-row-status.ok"), ("parts", ".upload-row-status", "c", 1)])
    page.context.close()

    # What's new (needs CHANGELOG_JSON)
    if CHANGELOG_SRC:
        page = new_page(browser, whatsnew=True)
        page.wait_for_selector("#wnOverlay.show", timeout=8000)
        page.wait_for_timeout(700)
        cap(page, "whatsnew", [
            ("kicker", "#wnKicker", "!R"), ("tag", ".wn-tag", "!B", 0),
            ("show", ".wn-show", "!R", 0), ("all", "#wnAll", "!T"), ("ok", "#wnOk", "!T"), ("close", "#wnClose", "!B"),
        ])
        page.locator("#wnOk").click()
        page.locator(".organize-toggle .slider").click()
        page.wait_for_selector("#wnOverlay.show", timeout=8000)
        page.wait_for_timeout(700)
        cap(page, "whatsnew-admin", [("kicker", "#wnKicker", "!R"), ("item", ".wn-tag", "!B", 0)])
        page.context.close()

    # light theme
    page = new_page(browser, theme="light")
    ready(page)
    cap(page, "light", [("theme", "#themeToggle")])
    page.context.close()


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    run(browser)
    browser.close()

prev = {}
jp = os.path.join(OUT, "shots.json")
if ONLY and os.path.exists(jp):
    prev = json.load(open(jp))
prev.update(RESULTS)
json.dump(prev, open(jp, "w"), indent=1)
print("unhandled requests:", len(UNHANDLED))
for u in sorted(set(UNHANDLED))[:30]:
    print("   ", u)
