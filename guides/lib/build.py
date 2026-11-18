"""
=============================================================================
FILE: guides/lib/build.py
VERSION: v1 (2026-11-18)
=============================================================================
PURPOSE
  Builds, for one tool, everything users see for help:
    <app guide dir>/index.html    the illustrated guide (in-app copy)
    <app guide dir>/tour.html     the getting-started tour (slides)
    <app guide dir>/version.json  {version, updated, whatsNew} — the app reads
                                  this to open the tour on first use and to
                                  show "What's new" once after an update
    <app guide dir>/img/*.webp    the screenshots
  plus a shareable copy of the guide + tour in guides/.out/<tool>/ for
  publishing outside the app.

INPUTS (all under guides/<tool>/)
  guide.src.html  guide text. Each <figure class="shot" data-src="NAME">
                  gets its screenshot + numbered pins injected. Tokens
                  {{UPDATED}}, {{WHATS_NEW}} are filled in here.
  tour.json       the tour's slides for each path (user / admin). A slide
                  is {title, text, shot?, points?: [[pin, text]...],
                  diagram?: [[title, text]...]}. Points pick which of the
                  screenshot's pins to show; they're renumbered 1..n.
  <shots dir>     <NAME>.png + <NAME>.json from shots.py.
  CHANGELOG.md    in the app folder. The top "## date · title" entry and
                  its "- " bullets become What's new.

ASSUMPTIONS / EDGE CASES
  - A slide or figure naming a screenshot that wasn't captured raises an
    error (the build fails rather than publishing a broken picture), and so
    does a guide figure whose numbered list doesn't have one entry per marker.
  - What's new only changes when a NEW changelog entry is added, so routine
    pushes (which retake screenshots) don't pop it up again.
=============================================================================
"""
import hashlib
import html
import json
import os
import re
import datetime as dt
from PIL import Image

MAX_W = 1600  # px; wide shots are downscaled to this (2x a ~800px display width)


# ---------------------------------------------------------------- helpers
def read_changelog(path):
    """Top entry of CHANGELOG.md -> {version, date, title, items} or None."""
    if not os.path.exists(path):
        return None
    lines = open(path, encoding='utf-8').read().splitlines()
    entry, items = None, []
    for ln in lines:
        m = re.match(r'^##\s+(\d{4}-\d{2}-\d{2})\s*[·\-–—:]\s*(.+?)\s*$', ln)
        if m:
            if entry:
                break
            entry = {'date': m.group(1), 'title': m.group(2)}
            continue
        if entry and ln.strip().startswith('- '):
            items.append(ln.strip()[2:].strip())
    if not entry:
        return None
    entry['items'] = items
    entry['version'] = hashlib.sha1((entry['date'] + entry['title']).encode()).hexdigest()[:10]
    return entry


def convert(shots, name, out_img, cache):
    """PNG -> WebP once per build; returns the capture metadata (CSS px + pins)."""
    if name in cache:
        return cache[name]
    png, meta_path = os.path.join(shots, f'{name}.png'), os.path.join(shots, f'{name}.json')
    if not (os.path.exists(png) and os.path.exists(meta_path)):
        raise FileNotFoundError(f'screenshot "{name}" was not captured ({png})')
    meta = json.load(open(meta_path))
    im = Image.open(png).convert('RGB')
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    im.save(os.path.join(out_img, f'{name}.webp'), 'WEBP', quality=82, method=6)
    meta['pw'], meta['ph'] = im.size
    cache[name] = meta
    return meta


def pins_html(pins):
    return ''.join(
        f'<span class="pin" data-n="{p["n"]}" data-a="{p.get("a", "left")}" '
        f'style="--x:{p["x"]}%;--y:{p["y"]}%" aria-hidden="true">{p["n"]}</span>' for p in pins)


def whats_new_html(entry, tool):
    if not entry:
        return ''
    items = ''.join(f'<li>{html.escape(i)}</li>' for i in entry['items'])
    return (f'<div class="note whats-new"><strong>What\'s new · {html.escape(entry["date"])}</strong>'
            f'<b>{html.escape(entry["title"])}</b><ul>{items}</ul></div>')


# ---------------------------------------------------------------- guide
def build_guide(src, shots, out_img, cache, updated, entry, tool):
    def figure(m):
        open_tag, name = m.group(0), m.group(1)
        meta = convert(shots, name, out_img, cache)
        w, h = meta['w'], meta['h']
        kind = 'phone' if (w <= 480 and h >= w * 0.6) else 'wide'  # short strips read better full width
        alt = re.search(r'data-alt="([^"]*)"', open_tag)
        alt = alt.group(1) if alt else ''
        frame = (f'<div class="frame" style="--w:{w}px">'
                 f'<button type="button" class="zoom" aria-label="Enlarge screenshot: {alt}">'
                 f'<img src="img/{name}.webp" width="{meta["pw"]}" height="{meta["ph"]}" alt="{alt}" loading="lazy" decoding="async"></button>'
                 f'{pins_html(meta["pins"])}</div>')
        return open_tag.replace('class="shot"', f'class="shot shot--{kind}"', 1) + frame

    page = re.sub(r'<figure class="shot" data-src="([a-z0-9-]+)"[^>]*>', figure, src)
    # Each numbered list must have exactly one entry per marker on its picture.
    for m in re.finditer(r'<figure class="shot[^"]*" data-src="([^"]+)"(.*?)</figure>', page, re.S):
        legend = re.search(r'<ol class="legend">(.*?)</ol>', m.group(2), re.S)
        if not legend:
            continue
        pins, items = m.group(2).count('<span class="pin"'), legend.group(1).count('<li>')
        if pins != items:
            raise ValueError(f'guide figure "{m.group(1)}": {pins} markers but {items} list entries')
    page = page.replace('{{UPDATED}}', updated).replace('{{WHATS_NEW}}', whats_new_html(entry, tool))
    return page


# ---------------------------------------------------------------- tour
TOUR_CSS = r"""
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 16px/1.55 var(--font-body); -webkit-font-smoothing: antialiased; }
a { color: var(--ember); }
:focus-visible { outline: 2px solid var(--ember); outline-offset: 2px; border-radius: 4px; }
.tour { height: 100%; display: flex; flex-direction: column;
  padding: env(safe-area-inset-top, 0px) max(0px, env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px) max(0px, env(safe-area-inset-left, 0px)); }
.bar { display: flex; align-items: center; gap: 12px; padding: 10px max(16px, env(safe-area-inset-left, 0px)) 10px max(16px, env(safe-area-inset-left, 0px)); border-bottom: 1px solid var(--line); background: var(--surface); flex: none; }
.bar .mark { display: flex; align-items: center; gap: 10px; margin-right: auto; min-width: 0; }
.bar .mark b { font: 600 15px/1.1 var(--font-display); letter-spacing: .06em; text-transform: var(--display-case); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar .mark span { font: 500 11px/1 var(--font-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.count { font: 500 13px/1 var(--font-mono); color: var(--muted); white-space: nowrap; }
.x { width: 44px; height: 44px; border-radius: 8px; border: 1px solid var(--line); background: none; color: var(--text); font-size: 20px; line-height: 1; cursor: pointer; flex: none; }
.stage { flex: 1; min-height: 0; overflow: auto; }
.screen { display: none; max-width: 1040px; margin: 0 auto; padding: 22px max(16px, env(safe-area-inset-left, 0px)) 28px max(16px, env(safe-area-inset-right, 0px)); }
.screen.on { display: block; animation: rise .25s ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.eyebrow { font: 500 12px/1.2 var(--font-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
h1 { font: 700 clamp(30px, 5.6vw, 48px)/1.02 var(--font-display); text-transform: var(--display-case); letter-spacing: .01em; margin: 0 0 12px; text-wrap: balance; }
h2 { font: 700 clamp(24px, 3.6vw, 34px)/1.08 var(--font-display); text-transform: var(--display-case); letter-spacing: .01em; margin: 0 0 8px; text-wrap: balance; }
.lede { font-size: 17px; max-width: 60ch; margin: 0 0 20px; }
.choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 14px; }
.choice { text-align: left; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 12px; padding: 18px; cursor: pointer; box-shadow: var(--shadow); font: inherit; min-height: 44px; }
.choice:hover { border-color: var(--ember); }
.choice b { display: block; font: 700 22px/1.1 var(--font-display); text-transform: var(--display-case); margin-bottom: 6px; }
.choice small { display: block; color: var(--muted); font-size: 15px; }
.choice .go { display: inline-block; margin-top: 12px; color: var(--ember); font-weight: 600; }
.choice--new { border-left: 4px solid var(--ember); }
.links { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 10px 18px; font-size: 15px; }
.slide { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 26px; align-items: start; }
.slide.no-shot { grid-template-columns: minmax(0, 1fr); max-width: 760px; }
.shotwrap { display: flex; justify-content: center; }
.shotbox { position: relative; display: inline-block; max-width: 100%; margin-left: 14px; }
.shotbox img { display: block; max-width: 100%; width: auto; height: auto; max-height: min(64vh, 640px); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); background: var(--surface); }
.pin { position: absolute; left: var(--x); top: var(--y); width: 26px; height: 26px; border-radius: 50%; background: var(--ember); color: var(--pin-ink); font: 600 13px/26px var(--font-mono); text-align: center; box-shadow: 0 0 0 2px var(--surface), 0 2px 6px rgba(0,0,0,.35); transform: translate(-50%, -50%); }
.pin[data-a="left"] { transform: translate(-100%, -50%); }
.pin[data-a="right"] { transform: translate(0, -50%); }
.copy p { margin: 0 0 14px; max-width: 58ch; }
ol.points { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; counter-reset: pt; }
ol.points li { counter-increment: pt; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; font-size: 15px; line-height: 1.45; }
ol.points li::before { content: counter(pt); width: 26px; height: 26px; border-radius: 50%; background: var(--ember); color: var(--pin-ink); font: 600 13px/26px var(--font-mono); text-align: center; }
.diagram { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; margin: 4px 0 18px; }
.diagram .node { flex: 1 1 170px; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-top: 3px solid var(--steel); border-radius: 8px; padding: 10px 12px; }
.diagram .node b { display: block; font: 700 17px/1.15 var(--font-display); text-transform: var(--display-case); letter-spacing: .02em; }
.diagram .node small { display: block; color: var(--muted); font-size: 13px; line-height: 1.4; margin-top: 4px; }
.diagram .arrow { align-self: center; color: var(--ember); font: 600 18px/1 var(--font-mono); }
.new-list { margin: 0 0 18px; padding-left: 20px; max-width: 60ch; }
.new-list li { margin: 6px 0; }
.foot { flex: none; display: flex; align-items: center; gap: 12px; padding: 10px max(16px, env(safe-area-inset-left, 0px)) 10px max(16px, env(safe-area-inset-right, 0px)); border-top: 1px solid var(--line); background: var(--surface); }
.foot[hidden] { display: none; }
.dots { display: flex; gap: 6px; margin-right: auto; flex-wrap: wrap; min-width: 0; }
.dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
.dots i.on { background: var(--ember); }
.btn { min-height: 44px; padding: 0 18px; border-radius: 8px; font: 600 15px/1 var(--font-body); cursor: pointer; border: 1px solid var(--line); background: var(--surface); color: var(--text); display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
.btn--primary { background: var(--ember); border-color: var(--ember); color: var(--pin-ink); }
.btn:disabled { opacity: .4; cursor: default; }
@media (max-width: 760px) {
  .slide { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .shotbox img { max-height: 46vh; }
  .bar .mark span { display: none; }
  .diagram { flex-direction: column; }
  .diagram .node { flex: 0 0 auto; }
  .diagram .arrow { transform: rotate(90deg); align-self: flex-start; margin-left: 16px; }
  .pin { width: 22px; height: 22px; font-size: 12px; line-height: 22px; }
}
@media (prefers-reduced-motion: reduce) { .screen.on { animation: none; } }
"""

TOUR_JS = r"""
(function () {
  var DATA = JSON.parse(document.getElementById('tour-data').textContent);
  var root = document.documentElement;
  var ctx = root.getAttribute('data-context');      // 'app' inside the tool, 'share' for the shared copy
  var inFrame = window.parent && window.parent !== window;

  if (ctx === 'app' && DATA.themeKey) {               // follow the tool's own light/dark setting
    try { var t = localStorage.getItem(DATA.themeKey); if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); } catch (e) {}
  }
  if (ctx === 'app' && DATA.forceTheme) root.setAttribute('data-theme', DATA.forceTheme);

  var screens = {}; document.querySelectorAll('.screen').forEach(function (s) { screens[s.id] = s; });
  var foot = document.querySelector('.foot'), dots = foot.querySelector('.dots'), count = document.querySelector('.count');
  var back = document.getElementById('back'), next = document.getElementById('next');
  var path = null, i = 0;

  function slidesOf(p) { return Array.prototype.slice.call(document.querySelectorAll('.screen[data-path="' + p + '"]')); }
  function show(id) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('on', k === id); });
    document.querySelector('.stage').scrollTop = 0;
  }
  function render() {
    var list = slidesOf(path);
    show(list[i].id);
    foot.hidden = false;
    count.textContent = (i + 1) + ' / ' + list.length;
    dots.innerHTML = list.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('');
    back.disabled = false;
    next.textContent = i === list.length - 1 ? 'Done' : 'Next';
  }
  function start(p) { path = p; i = 0; render(); next.focus(); }
  function home(which) { path = null; foot.hidden = true; count.textContent = ''; show(which || 'start'); }
  function finish() {
    if (ctx === 'app' && inFrame) { window.parent.postMessage({ type: 'tour:close', version: DATA.version }, location.origin); return; }
    if (ctx === 'app') { location.href = DATA.backHref; return; }
    location.href = DATA.guideHref;                     // shared copy: back to the guide
  }
  back.addEventListener('click', function () { if (i > 0) { i--; render(); } else home(); });
  next.addEventListener('click', function () { var n = slidesOf(path).length; if (i < n - 1) { i++; render(); } else home('done-' + path); });
  document.querySelectorAll('[data-start]').forEach(function (b) { b.addEventListener('click', function () { start(b.getAttribute('data-start')); }); });
  document.querySelectorAll('[data-home]').forEach(function (b) { b.addEventListener('click', function () { home(b.getAttribute('data-home') || 'start'); }); });
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', finish); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') finish();
    if (!path) return;
    if (e.key === 'ArrowRight') next.click();
    if (e.key === 'ArrowLeft') back.click();
  });
  // Swipe left/right on touch screens.
  var sx = null, sy = null, stage = document.querySelector('.stage');
  stage.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (sx === null || !path) return;
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : back).click();
  }, { passive: true });

  // Opened as tour.html#whats-new (after an update) or #user / #admin.
  var h = (location.hash || '').slice(1);
  if (h === 'whats-new' && screens['whats-new']) home('whats-new');
  else if (h === 'user' || h === 'admin') start(h);
  else home('start');
})();
"""


def build_tour(tour, tool_name, brand_svg, tokens_css, fonts_link, shots, out_img, cache, entry, ctx,
               back_href, guide_href, theme_key=None, force_theme=None, display_case='uppercase', updated=''):
    esc = html.escape
    screens = []

    # Start screen: choose a path (and What's new when there is one).
    choices = ''
    for key in ('user', 'admin'):
        p = tour['paths'][key]
        choices += (f'<button type="button" class="choice" data-start="{key}"><b>{esc(p["label"])}</b>'
                    f'<small>{esc(p["blurb"])}</small><span class="go">Start · {len(p["slides"])} steps →</span></button>')
    if entry:
        choices += (f'<button type="button" class="choice choice--new" data-home="whats-new"><b>What\'s new</b>'
                    f'<small>{esc(entry["title"])} · {esc(entry["date"])}</small><span class="go">See the changes →</span></button>')
    screens.append(f'<section class="screen" id="start"><p class="eyebrow">Getting started</p>'
                   f'<h1>Welcome to {esc(tool_name)}</h1><p class="lede">{esc(tour["intro"])}</p>'
                   f'<div class="choices">{choices}</div>'
                   f'<p class="links"><a href="{guide_href}">Open the full guide</a>'
                   f'<button type="button" class="btn" data-close>Close</button></p></section>')

    if entry:
        items = ''.join(f'<li>{esc(x)}</li>' for x in entry['items'])
        screens.append(f'<section class="screen" id="whats-new"><p class="eyebrow">What\'s new · {esc(entry["date"])}</p>'
                       f'<h1>{esc(entry["title"])}</h1><ul class="new-list">{items}</ul>'
                       f'<div class="choices"><button type="button" class="choice" data-home="start"><b>Take the tour</b>'
                       f'<small>Step through the screens, with pictures.</small></button></div>'
                       f'<p class="links"><a href="{guide_href}">Open the full guide</a>'
                       f'<button type="button" class="btn btn--primary" data-close>Done</button></p></section>')

    for key in ('user', 'admin'):
        p = tour['paths'][key]
        for k, s in enumerate(p['slides']):
            sid = f'{key}-{k + 1}'
            copy = f'<p class="eyebrow">{esc(p["label"])}</p><h2>{esc(s["title"])}</h2>'
            visual = ''
            if s.get('diagram'):
                nodes = '<span class="arrow" aria-hidden="true">→</span>'.join(
                    f'<div class="node"><b>{esc(a)}</b><small>{esc(b)}</small></div>' for a, b in s['diagram'])
                copy += f'<div class="diagram" role="img" aria-label="{esc(" then ".join(a for a, _ in s["diagram"]))}">{nodes}</div>'
            if s.get('text'):
                copy += f'<p>{esc(s["text"])}</p>'
            if s.get('shot'):
                meta = convert(shots, s['shot'], out_img, cache)
                by_n = {pp['n']: pp for pp in meta['pins']}
                pins, items = [], ''
                for j, (n, txt) in enumerate(s.get('points', []), start=1):
                    if n not in by_n:
                        raise KeyError(f'tour slide "{s["title"]}": pin {n} missing on "{s["shot"]}"')
                    pins.append({**by_n[n], 'n': j})
                    items += f'<li>{esc(txt)}</li>'
                if items:
                    copy += f'<ol class="points">{items}</ol>'
                visual = (f'<div class="shotwrap"><div class="shotbox"><img src="img/{s["shot"]}.webp" '
                          f'width="{meta["pw"]}" height="{meta["ph"]}" alt="{esc(s["title"])}" decoding="async">'
                          f'{pins_html(pins)}</div></div>')
            cls = 'slide' if visual else 'slide no-shot'
            screens.append(f'<section class="screen" id="{sid}" data-path="{key}"><div class="{cls}">{visual}'
                           f'<div class="copy">{copy}</div></div></section>')
        other = 'admin' if key == 'user' else 'user'
        screens.append(f'<section class="screen" id="done-{key}"><p class="eyebrow">{esc(p["label"])} · done</p>'
                       f'<h1>You\'re set.</h1><p class="lede">{esc(tour["done"][key])}</p>'
                       f'<div class="choices"><button type="button" class="choice" data-start="{other}">'
                       f'<b>{esc(tour["paths"][other]["label"])} tour</b><small>{esc(tour["paths"][other]["blurb"])}</small></button></div>'
                       f'<p class="links"><a href="{guide_href}">Open the full guide</a>'
                       f'<button type="button" class="btn btn--primary" data-close>Done</button></p></section>')

    data = {'version': entry['version'] if entry else 'none', 'backHref': back_href, 'guideHref': guide_href,
            'themeKey': theme_key, 'forceTheme': force_theme}
    head = ('<!doctype html>\n'
            f'<html lang="en" data-context="{ctx}">\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<meta name="robots" content="noindex">\n'
            f'<title>{esc(tool_name)} Getting Started</title>\n'
            f'<!-- Generated by guides/lib/build.py from guides/*/tour.json — edit those, not this file. Updated {updated}. -->\n'
            f'{fonts_link}\n<style>\n{tokens_css}\n:root {{ --display-case: {display_case}; }}\n{TOUR_CSS}\n</style>\n')
    body = (f'<div class="tour"><header class="bar"><div class="mark">{brand_svg}<b>{esc(tool_name)}</b><span>Getting started</span></div>'
            f'<span class="count" aria-live="polite"></span><button type="button" class="x" data-close aria-label="Close the tour">×</button></header>'
            f'<main class="stage">{"".join(screens)}</main>'
            f'<nav class="foot" hidden><div class="dots" aria-hidden="true"></div>'
            f'<button type="button" class="btn" id="back">Back</button><button type="button" class="btn btn--primary" id="next">Next</button></nav></div>'
            f'<script type="application/json" id="tour-data">{json.dumps(data)}</script>\n<script>{TOUR_JS}</script>\n')
    return head + body


# ---------------------------------------------------------------- tool build
def build_tool(cfg, shots, guides_dir, repo):
    """cfg: dict from run.py TOOLS. Writes the in-app and shareable outputs."""
    gdir = os.path.join(guides_dir, cfg['id'])
    src = open(os.path.join(gdir, 'guide.src.html'), encoding='utf-8').read()
    tour = json.load(open(os.path.join(gdir, 'tour.json'), encoding='utf-8'))
    entry = read_changelog(os.path.join(repo, cfg['changelog']))
    updated = dt.date.today().strftime('%b %d, %Y').replace(' 0', ' ')

    style = re.search(r'<style>\n(.*?)</style>', src, re.S).group(1)
    tokens_css = style[:style.index('* { box-sizing')]
    fonts_link = '\n'.join(re.findall(r'<link rel="(?:preconnect|stylesheet)"[^>]*>', src))
    brand_svg = re.search(r'<a class="brand"[^>]*>\s*(<svg.*?</svg>)', src, re.S).group(1)

    app_dir = os.path.join(repo, cfg['app_guide_dir'])
    share_dir = os.path.join(guides_dir, '.out', cfg['id'])
    for d in (app_dir, share_dir):
        os.makedirs(os.path.join(d, 'img'), exist_ok=True)
        for f in os.listdir(os.path.join(d, 'img')):  # drop screenshots no longer used
            os.remove(os.path.join(d, 'img', f))

    cache = {}
    guide = build_guide(src, shots, os.path.join(app_dir, 'img'), cache, updated, entry, cfg['name'])
    tour_kw = dict(tour=tour, tool_name=cfg['name'], brand_svg=brand_svg, tokens_css=tokens_css, fonts_link=fonts_link,
                   shots=shots, out_img=os.path.join(app_dir, 'img'), cache=cache, entry=entry,
                   theme_key=cfg.get('theme_key'), force_theme=cfg.get('force_theme'),
                   display_case=cfg.get('display_case', 'uppercase'), updated=updated)

    # In-app copies: full documents flagged data-context="app".
    head = ('<!doctype html>\n<html lang="en" data-context="app">\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<meta name="robots" content="noindex">\n')
    open(os.path.join(app_dir, 'index.html'), 'w', encoding='utf-8').write(head + guide)
    open(os.path.join(app_dir, 'tour.html'), 'w', encoding='utf-8').write(
        build_tour(ctx='app', back_href=cfg['back_href'], guide_href='index.html', **tour_kw))
    json.dump({'version': entry['version'] if entry else None, 'updated': updated,
               'whatsNew': entry}, open(os.path.join(app_dir, 'version.json'), 'w'), indent=1)

    # Shareable copies: the guide as a page fragment (the host adds <head>),
    # the tour as its own page linking back to the guide.
    for f in os.listdir(os.path.join(app_dir, 'img')):
        with open(os.path.join(app_dir, 'img', f), 'rb') as a, open(os.path.join(share_dir, 'img', f), 'wb') as b:
            b.write(a.read())
    open(os.path.join(share_dir, 'guide.html'), 'w', encoding='utf-8').write(guide)
    open(os.path.join(share_dir, 'tour.html'), 'w', encoding='utf-8').write(
        build_tour(ctx='share', back_href='./', guide_href='./', **tour_kw))
    print(f"{cfg['id']}: {len(cache)} screenshots; what's new: {entry['title'] if entry else 'none'}")
