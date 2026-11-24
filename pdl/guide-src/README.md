<!--
  guide-src/README.md — rebuilding My PD's guide (../guide.html)
  VERSION HISTORY
    v1  2026-11-22  Created with the move to c3jumpw/mkp-tools (includes pins.json).
-->

# Rebuilding the guide

`../guide.html` is generated from these files. Don't edit it by hand.

| File | What it is |
|---|---|
| `template.html` | The guide's text, layout and styles. `{{FIG:name}}` marks a screenshot with numbered pins. |
| `figs.py` | For each figure: which screenshot(s) and what each numbered pin means. |
| `build.py` | Puts it together. Places pins next to what they point at, without covering labels, and embeds `changelog.json`. |
| `capture.py` | Opens the real `../index.html` in headless Chromium against the sample library in `mockdata.py` and takes the screenshots. Every request is answered locally; anything unknown is blocked, so the real repo and relay are never touched. |
| `shots/` | The current screenshots (WebP), what each callout points at (`shots.json`) and where each pin was placed (`pins.json`, so a rebuild doesn't move pins that were checked by eye). |
| `whatsnew_test.py` | Checks What's new for new, existing, admin and locked devices, plus old-address forwarding. |

## When only text changes

```sh
cd pdl/guide-src
CHANGELOG_JSON=../changelog.json python3 build.py shots shots /tmp/pd-guide
cp /tmp/pd-guide/guide.html ../guide.html
```

## When a screen changes

One-time setup: `pip install playwright pillow`, then `python3 -m playwright install chromium`. Generate the sample media (ffmpeg needed):

```sh
mkdir -p assets
ffmpeg -f lavfi -i anullsrc=r=8000:cl=mono -t 1094 -c:a libmp3lame -b:a 8k assets/silence.mp3
ffmpeg -f lavfi -i "gradients=s=640x360:c0=0x241a12:c1=0xc9a15e:c2=0x5a3d22:x0=0:y0=360:x1=640:y1=0:speed=0.02:d=6:r=24" -c:v libvpx-vp9 -b:v 400k -an assets/sunrise.webm
python3 make_covers.py assets/covers
```

Then capture, shrink and build:

```sh
CHANGELOG_JSON=../changelog.json python3 capture.py ../index.html /tmp/pd-shots   # add shot ids to capture only some
python3 to_webp.py /tmp/pd-shots shots
CHANGELOG_JSON=../changelog.json python3 build.py shots shots /tmp/pd-guide
cp /tmp/pd-guide/guide.html ../guide.html
```

For a new screen, add a scenario and its callout keys to `capture.py`, an entry to `figs.py`, and `{{FIG:name}}` in `template.html`. A callout anchor beginning with `!` (for example `!T`, `!R`, `!badge`) forces where the pin goes. Without one, `build.py` picks the quietest spot beside the target.

`build.py` also writes `guide-artifact.html`: the same page without the document skeleton, for publishing as a claude.ai artifact.

## Checking What's new

```sh
CHANGELOG_JSON=../changelog.json GUIDE_HTML=../guide.html python3 whatsnew_test.py ../index.html /tmp/pd-wn
```
