"""
=============================================================================
FILE: guides/lib/capture.py
VERSION: v1 (2026-11-18)
=============================================================================
PURPOSE
  Takes one screenshot region and records where each numbered callout
  ("pin") goes, as a percentage of the image, so the guide and the
  getting-started tour can draw markers exactly on the controls they
  describe — and keep doing so after the app's layout changes, because
  the positions are re-measured from the live page on every run.

capture(pg, out_dir, name, crop, pins=(), pad=0)
  crop: a Playwright Locator (crop to its box), 'viewport', or a dict
        {'x','y','width','height'} in CSS px of the viewport.
  pins: list of (number, Locator, anchor). anchor is one of
        'left'   just left of the element, vertically centered
        'right'  just right of it
        'top'    its top-left corner
        'center' its middle
  Writes <name>.png and <name>.json: {'w','h','pins':[{n,a,x,y}]}, with
  w/h in CSS px and x/y in % of the image.

MISSING PINS
  A pin whose element can't be found (usually because a label or button
  in the app was renamed or removed) is skipped and recorded in MISSING.
  run.py fails the build when MISSING is non-empty, so a guide that no
  longer matches the app is caught instead of silently published.
=============================================================================
"""
import json

MISSING = []  # (figure name, pin number) for every pin that couldn't be placed


def _box(target):
    b = target.bounding_box()
    if not b:
        raise RuntimeError(f'no bounding box for {target}')
    return b


def capture(pg, out_dir, name, crop, pins=(), pad=0):
    pg.wait_for_timeout(300)
    if crop == 'viewport':
        vp = pg.viewport_size
        clip = {'x': 0, 'y': 0, 'width': vp['width'], 'height': vp['height']}
    elif isinstance(crop, dict):
        clip = dict(crop)
    else:
        b = _box(crop)
        clip = {'x': b['x'] - pad, 'y': b['y'] - pad, 'width': b['width'] + 2 * pad, 'height': b['height'] + 2 * pad}
    clip['x'] = max(0, clip['x'])
    clip['y'] = max(0, clip['y'])
    pg.screenshot(path=f'{out_dir}/{name}.png', clip=clip)
    out = []
    for n, loc, anchor in pins:
        try:
            b = loc.bounding_box(timeout=3000)
        except Exception:
            b = None
        if not b:
            print(f'  ! {name}: pin {n} not found')
            MISSING.append((name, n))
            continue
        if anchor == 'left':
            x, y = b['x'] - 2, b['y'] + b['height'] / 2
        elif anchor == 'right':
            x, y = b['x'] + b['width'] + 2, b['y'] + b['height'] / 2
        elif anchor == 'top':
            x, y = b['x'] + 6, b['y'] + 2
        else:
            x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
        px = (x - clip['x']) / clip['width'] * 100
        py = (y - clip['y']) / clip['height'] * 100
        # Clamp inside the image so a pin never floats off the picture.
        out.append({'n': n, 'a': anchor, 'x': round(min(max(px, 2.5), 97.5), 2), 'y': round(min(max(py, 2.5), 97.5), 2)})
    meta = {'w': round(clip['width']), 'h': round(clip['height']), 'pins': out}
    with open(f'{out_dir}/{name}.json', 'w') as f:
        json.dump(meta, f)
    return meta
