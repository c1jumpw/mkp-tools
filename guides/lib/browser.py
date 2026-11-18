"""
=============================================================================
FILE: guides/lib/browser.py
VERSION: v1 (2026-11-18)
=============================================================================
PURPOSE
  Shared browser setup for the screenshot scripts, so they run the same way
  on a laptop, in Claude's workspace and in GitHub Actions.
  - launch(p): starts Chromium. Uses CHROMIUM_PATH if set (a preinstalled
    browser), otherwise Playwright's own download.
  - fonts(ctx): when the web can't reach Google Fonts (some sandboxes block
    it), serves the apps' fonts from local @fontsource files in
    guides/.fonts/<slug>/files/. Does nothing when that folder is absent,
    which is the normal case in GitHub Actions (real Google Fonts load).
=============================================================================
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, '..', '.fonts')  # optional, git-ignored
FAMILIES = {'Barlow Condensed': 'barlow-condensed', 'Inter': 'inter',
            'IBM Plex Mono': 'ibm-plex-mono', 'IBM Plex Sans': 'ibm-plex-sans'}


def launch(p):
    path = os.environ.get('CHROMIUM_PATH')
    return p.chromium.launch(executable_path=path) if path else p.chromium.launch()


def _css():
    out = []
    for fam, slug in FAMILIES.items():
        for w in (400, 500, 600, 700):
            out.append(f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{w};font-display:block;"
                       f"src:url(https://fonts.gstatic.com/local/{slug}/files/{slug}-latin-{w}-normal.woff2) format('woff2');}}")
    return '\n'.join(out)


def fonts(ctx):
    if not os.path.isdir(FONT_DIR):
        return  # online: let the pages load Google Fonts themselves
    css = _css()
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(
        status=200, content_type='text/css', body=css, headers={'access-control-allow-origin': '*'}))

    def serve(r):
        rel = r.request.url.split('/local/')[-1]
        path = os.path.join(FONT_DIR, rel)
        if os.path.exists(path):
            r.fulfill(status=200, content_type='font/woff2', body=open(path, 'rb').read(),
                      headers={'access-control-allow-origin': '*'})
        else:
            r.fulfill(status=404, body='')
    ctx.route('https://fonts.gstatic.com/**', serve)
