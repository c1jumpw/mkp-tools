"""
=============================================================================
FILE: guides/run.py
VERSION: v2 (2026-11-20)
=============================================================================
PURPOSE
  One command that refreshes the help for both tools:
    1. starts each app locally (DayForge dev server, Dispatch It static),
    2. retakes every screenshot with example data (guides/<tool>/shots.py),
    3. stops with an error if any numbered marker can't find its button
       (the app changed and the guide/tour text needs updating),
    4. rebuilds the guide, the getting-started tour and version.json into
       each app's guide folder (guides/lib/build.py).
  GitHub Actions runs this on every push that changes either app
  (.github/workflows/guides.yml) and commits the results.

USAGE
  pip install -r guides/requirements.txt && python -m playwright install chromium
  (cd dayforge && npm ci)
  python guides/run.py            # both tools
  python guides/run.py dayforge   # just one

ENVIRONMENT
  CHROMIUM_PATH  use an already-installed Chromium instead of Playwright's.
  Ports 5180 (DayForge) and 5190 (Dispatch It) must be free.

REVISION HISTORY
  v1  2026-11-18  Initial runner.
  v2  2026-11-20  TOOLS[*]['history_paths']: folders whose git history fills
                  the "Every change" list in changelog.json. Needs a full
                  clone (the workflow checks out with fetch-depth 0).
=============================================================================
"""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, 'lib'))
import capture  # noqa: E402
from build import build_tool  # noqa: E402

TOOLS = {
    'dayforge': {
        'id': 'dayforge', 'name': 'DayForge',
        'app_guide_dir': 'dayforge/public/guide',      # served at /guide/ by Vercel
        'changelog': 'dayforge/CHANGELOG.md',
        'history_paths': ['dayforge'],  # git log paths for the Every change list
        'back_href': '/',                               # where Close goes when the tour isn't in the app's overlay
        'theme_key': 'dayforge-theme',                  # tour + guide follow the app's light/dark choice
        'display_case': 'uppercase',
        'server': (['npx', 'vite', '--port', '5180', '--strictPort'], 'dayforge', 'http://localhost:5180/'),
    },
    'dispatch': {
        'id': 'dispatch', 'name': 'Dispatch It',
        'app_guide_dir': 'mkp-dispatch/guide',          # served at <app>/guide/ by GitHub Pages
        'changelog': 'mkp-dispatch/CHANGELOG.md',
        'history_paths': ['mkp-dispatch'],
        'back_href': '../',
        'force_theme': 'dark',                          # the app itself is dark-only
        'display_case': 'none',
        'server': ([sys.executable, '-m', 'http.server', '5190'], 'mkp-dispatch', 'http://localhost:5190/'),
    },
}


def wait_for(url, seconds=60):
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=3)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f'{url} did not start')


def main(which):
    failed = False
    for tid in which:
        cfg = TOOLS[tid]
        cmd, cwd, url = cfg['server']
        server = subprocess.Popen(cmd, cwd=os.path.join(REPO, cwd), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(url)
            shots_dir = tempfile.mkdtemp(prefix=f'{tid}-shots-')
            sys.path.insert(0, os.path.join(HERE, tid))
            mod = __import__('shots')
            mod.run(shots_dir)
            sys.path.pop(0)
            del sys.modules['shots']
            if capture.MISSING:
                print(f'\n{cfg["name"]}: these markers could not find their button or label:')
                for name, n in capture.MISSING:
                    print(f'  - {name}: pin {n}')
                print('The app changed. Update guides/' + tid + '/shots.py (and the guide/tour text), then run again.')
                failed = True
                capture.MISSING.clear()
                continue
            build_tool(cfg, shots_dir, HERE, REPO)
        finally:
            server.terminate()
            server.wait(timeout=10)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main(sys.argv[1:] or list(TOOLS))
