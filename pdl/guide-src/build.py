"""Builds the My PD guide from template.html + figs.py + the captured screenshots.

Outputs:
  guide.html          full document, for the repo (pdl/guide.html) and the in-app sheet
  guide-artifact.html same page without the document skeleton, for publishing as an artifact

VERSION HISTORY
  v1  2026-10-30  Builds guide.html and the artifact copy; pins avoid covering labels.
  v2  2026-11-20  Built-in change log; header comment; WebP fallback for pin placement.
  v3  2026-11-22  Moved to c3jumpw/mkp-tools/pdl/guide-src. Pin spots are remembered in
                  shots/pins.json, so a rebuild from the WebP screenshots matches.
"""
import base64, html, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from figs import FIGS

SHOTS_DIR = sys.argv[1]          # contains shots.json
WEBP_DIR = sys.argv[2]           # contains <id>.webp
OUT_DIR = sys.argv[3]
os.makedirs(OUT_DIR, exist_ok=True)

SHOTS = json.load(open(os.path.join(SHOTS_DIR, "shots.json")))
TEMPLATE = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()

LOGO = ('<svg viewBox="0 0 180 180" aria-hidden="true" focusable="false">'
        '<rect width="180" height="180" rx="40" fill="#221d18"/>'
        '<rect x="1" y="1" width="178" height="178" rx="39" fill="none" stroke="#3a3127" stroke-width="2"/>'
        '<g fill="none" stroke="#c9a15e" stroke-width="6.5" stroke-linejoin="round" stroke-linecap="round">'
        '<path d="M90 54 Q66 40 38 44 L38 124 Q66 120 90 135 Q114 120 142 124 L142 44 Q114 40 90 54 Z"/>'
        '<path d="M90 54 L90 133"/></g></svg>')

_img_cache = {}
def img_src(shot):
    if shot not in _img_cache:
        data = open(os.path.join(WEBP_DIR, shot + ".webp"), "rb").read()
        _img_cache[shot] = "data:image/webp;base64," + base64.b64encode(data).decode()
    return _img_cache[shot]

warnings = []

# ---------- pin placement ----------
# Each callout records the box of the thing it points at. A pin dropped on the middle of a
# small button hides the very label it's explaining, so each pin is tried at a handful of
# spots around and inside its target, and goes where the screenshot is quietest and it
# doesn't sit on another pin.
from PIL import Image, ImageStat
R = 15          # pin radius in app pixels (20px pin on a ~272px-wide screen)
_png = {}
def _gray(shot):
    """Greyscale screenshot used to judge how busy a spot is; full PNG if present, else the WebP."""
    if shot not in _png:
        png = os.path.join(SHOTS_DIR, shot + ".png")
        src = png if os.path.exists(png) else os.path.join(WEBP_DIR, shot + ".webp")
        _png[shot] = Image.open(src).convert("L")
    return _png[shot]

def busy(shot, x, y):
    im = _gray(shot)
    s = im.width / SHOTS[shot].get("w", 390)
    box = (int((x - R) * s), int((y - R) * s), int((x + R) * s), int((y + R) * s))
    st = ImageStat.Stat(im.crop(box))
    return st.stddev[0]

def candidates(bx, by, bw, bh):
    cx, cy = bx + bw / 2, by + bh / 2
    g = R + 3
    small = bw < 120 or bh < 44
    out = []
    # outside the target: pin sits beside it, the label stays visible
    out += [("L", bx - g, cy), ("R", bx + bw + g, cy), ("T", cx, by - g), ("B", cx, by + bh + g)]
    # inside corners and edges: fine for big targets like cards, video, text blocks
    ins = [("tl", bx + g, by + g), ("tr", bx + bw - g, by + g), ("l", bx + g, cy), ("r", bx + bw - g, cy),
           ("bl", bx + g, by + bh - g), ("br", bx + bw - g, by + bh - g), ("c", cx, cy)]
    out += ins
    return out, small

# Where each pin went last time, keyed by screenshot, callout and target box. WebP
# compression shifts the "how busy" scores a little, so without this a rebuild from the
# committed WebP files could move pins that were checked by eye. A re-captured screen has
# new boxes, so its pins are placed afresh. Entries not used by this build are dropped.
PINS_FILE = os.path.join(SHOTS_DIR, "pins.json")
try:
    PIN_CACHE = json.load(open(PINS_FILE))
except (OSError, ValueError):
    PIN_CACHE = {}
PIN_USED = {}

def _pin_key(shot, c):
    return "|".join([shot, c["key"], ",".join(f"{v:g}" for v in c["box"]), c.get("at", "")])

def place_pins(shot, items):
    """items: [(n, callout)] -> [(n, x%, y%)]"""
    W0, H0 = SHOTS[shot].get("w", 390), SHOTS[shot].get("h", 844)
    placed = []
    for n, c in items:
        k = _pin_key(shot, c)
        if k in PIN_CACHE:
            x, y = PIN_CACHE[k]
            PIN_USED[k] = [x, y]
            placed.append((n, x, y))
            continue
        bx, by, bw, bh = c["box"]
        cands, small = candidates(bx, by, bw, bh)
        cands.append(("badge", bx + bw - 10, by + 10))
        forced = c.get("at", "").startswith("!")
        if forced:
            cands = [cd for cd in cands if cd[0] == c["at"][1:]]
        best = None
        for name, x, y in cands:
            if not forced and not (R + 1 <= x <= W0 - R - 1 and R + 1 <= y <= H0 - R - 1):
                continue
            score = busy(shot, x, y)
            if name in ("L", "R", "T", "B"):
                score += 4                      # slight preference for staying on the target
            elif small:
                score += 30                     # would cover a small control's label
            for _, px, py in placed:
                d = math.hypot(px - x, py - y)
                if d < 2 * R + 3:
                    score += 1000
            if best is None or score < best[0]:
                best = (score, x, y)
        if best is None:
            best = (0, bx + bw / 2, by + bh / 2)
        if best[0] >= 1000:
            warnings.append(f"{shot}: pin {n} overlaps another pin")
        placed.append((n, best[1], best[2]))
        PIN_USED[k] = [best[1], best[2]]
    return [(n, x / W0 * 100, y / H0 * 100) for n, x, y in placed]

def callout(shot, key):
    for c in SHOTS[shot]["callouts"]:
        if c["key"] == key:
            return c
    warnings.append(f"missing callout {shot}:{key}")
    return None

def phone(shot, alt, pins, cap=None):
    out = [f'<div class="shot"><div class="phone"><div class="glass">'
           f'<img src="{img_src(shot)}" width="640" height="1385" alt="{html.escape(alt, quote=True)}" decoding="async">']
    for n, x, y in place_pins(shot, pins):
        out.append(f'<span class="pin" data-n="{n}" style="left:{x:.2f}%;top:{y:.2f}%" aria-hidden="true">{n}</span>')
    out.append("</div></div>")
    if cap:
        out.append(f'<div class="shot-cap">{html.escape(cap)}</div>')
    out.append("</div>")
    return "".join(out)

def key_item(n, title, text):
    t = f'<span class="t">{html.escape(text)}</span>' if text else ""
    return (f'<li data-n="{n}" tabindex="0"><span class="n" aria-hidden="true">{n}</span>'
            f'<div><b>{html.escape(title)}</b>{t}</div></li>')

def check_spacing(name, shot, pins):
    # Pins are 22px on a ~272px-wide screen image; flag any pair closer than that.
    for i in range(len(pins)):
        for j in range(i + 1, len(pins)):
            (a, ca), (b, cb) = pins[i], pins[j]
            dx = (ca["x"] - cb["x"]) / 100 * 272
            dy = (ca["y"] - cb["y"]) / 100 * 589
            if math.hypot(dx, dy) < 21:
                warnings.append(f"{name}/{shot}: pins {a} and {b} overlap ({math.hypot(dx, dy):.0f}px)")

def figure(name):
    f = FIGS[name]
    shots = f["shots"]
    pair = len(shots) > 1
    alts = f["alt"] if isinstance(f["alt"], dict) else {shots[0]: f["alt"]}
    caps = f.get("caps", [None] * len(shots))
    per_shot = {s: [] for s in shots}
    keys = []
    n = 0
    for k, title, text in f["items"]:
        shot, key = (k.split(":", 1) if pair else (shots[0], k))
        c = callout(shot, key)
        if not c:
            continue
        n += 1
        per_shot[shot].append((n, c))
        keys.append((shot, n, title, text))
    phones = []
    for s, cap in zip(shots, caps):
        phones.append(phone(s, alts.get(s, ""), per_shot[s], cap if pair else None))
    lis = []
    last = None
    for shot, n, title, text in keys:
        if pair and shot != last:
            lis.append(f'<li class="group-row" aria-hidden="true"><span class="group">{html.escape(caps[shots.index(shot)])}</span></li>')
            last = shot
        lis.append(key_item(n, title, text))
    cls = "screen pair" if pair else "screen"
    return (f'<figure class="{cls}" id="fig-{name}"><div class="phones">{"".join(phones)}</div>'
            f'<ol class="key">{"".join(lis)}</ol></figure>')

def shot_only(name):
    f = FIGS[name]
    s = f["shots"][0]
    pins = []
    for i, (k, _t, _x) in enumerate(f["items"], 1):
        c = callout(s, k)
        if c:
            pins.append((i, c))
    return f'<div class="phones">{phone(s, f["alt"], pins)}</div>'

body = TEMPLATE.replace("{{LOGO}}", LOGO)
# The change log is built in, so the page is complete on its own (and as a published artifact).
_cl = json.load(open(os.environ["CHANGELOG_JSON"], encoding="utf-8"))
body = body.replace("{{CHANGELOG_JSON}}", json.dumps(_cl, ensure_ascii=False).replace("</", "<\\/"))
body = re.sub(r"\{\{FIG:([\w-]+)\}\}", lambda m: figure(m.group(1)), body)
body = re.sub(r"\{\{SHOT:([\w-]+)\}\}", lambda m: shot_only(m.group(1)), body)
assert "{{" not in body, re.findall(r"\{\{[^}]+\}\}", body)

# the in-app sheet and the hand-built light figure use .group-row; style it once here
body = body.replace(".key .group {", ".key li.group-row { display: block; padding: 0; }\n  .key .group {", 1)

open(os.path.join(OUT_DIR, "guide-artifact.html"), "w", encoding="utf-8").write(body)

head_end = body.index("</style>") + len("</style>")
favicon = "data:image/svg+xml," + LOGO.replace('aria-hidden="true" focusable="false"', 'xmlns="http://www.w3.org/2000/svg"').replace("#", "%23").replace('"', "'")
HEADER = """<!--
  guide.html — the My PD guide: every screen, admin tasks, setup and the change log.

  Built by guide-src/build.py from guide-src/template.html, guide-src/figs.py and
  screenshots of the real app running against a sample library (guide-src/capture.py).
  Don't hand-edit this file; change the sources and rebuild (guide-src/README.md).
  The Change log chapter renders a built-in copy of changelog.json and, on My PD's own
  site, re-reads changelog.json beside it, so new entries show without a rebuild.
  The app opens this page in a full-screen sheet from its Guide button.

  VERSION HISTORY
    v1  2026-10-30  First guide: everyday use, admin, setup and help; Guide button.
    v2  2026-11-20  What's new, Change log chapter, new address mypd.mkcworkspace.com,
                    app files in c3jumpw/mkp-tools (setup chapter rewritten).
-->
"""
full = ("<!DOCTYPE html>\n" + HEADER + "<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        f"<link rel=\"icon\" href=\"{favicon}\">\n"
        + body[:head_end] + "\n</head>\n<body>\n" + body[head_end:].lstrip() + "\n</body>\n</html>\n")
open(os.path.join(OUT_DIR, "guide.html"), "w", encoding="utf-8").write(full)

with open(PINS_FILE, "w") as f:
    json.dump(dict(sorted(PIN_USED.items())), f, indent=0)
    f.write("\n")
print("guide.html", round(len(full) / 1024), "KB")
for w in warnings:
    print("  !", w)
