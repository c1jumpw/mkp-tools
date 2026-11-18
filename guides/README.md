# Guides and getting-started tours

This folder builds the help that ships inside **DayForge** and **Dispatch It**:

| Output | DayForge | Dispatch It |
|---|---|---|
| Illustrated guide (every screen and setting, Everyday + Admin sections) | `dayforge/public/guide/index.html` → ⋮ › Help & guide | `mkp-dispatch/guide/index.html` → ? on Home, Settings › Help |
| Getting-started tour (slides with screenshots, Everyday or Admin path, What's new) | `dayforge/public/guide/tour.html` → opens on first use, ⋮ › Getting started tour | `mkp-dispatch/guide/tour.html` → opens on first use, ? on Home |
| What's new marker | `dayforge/public/guide/version.json` | `mkp-dispatch/guide/version.json` |

Don't edit those generated files by hand — edit the sources here.

## It updates itself

`.github/workflows/guides.yml` runs on every push to `main` that changes either app. It starts each app with **example data** (no real accounts, tasks or ClickUp data), retakes every screenshot, rebuilds the guide and tour, and commits the results. The live apps then show the new pictures.

If a numbered marker can't find its button (a label was renamed or a control removed), the run **fails on purpose** and GitHub emails you. The log says which picture and marker. Nothing is committed, so the live guide keeps its last good version until you fix it.

## When you ship a change

1. **Something people will notice?** Add an entry to the top of the app's `CHANGELOG.md`:
   ```
   ## 2026-12-01 · Short title
   - One plain sentence per change, for the person using the app.
   ```
   Everyone sees it once as **What's new** the next time they open the app.
2. **A screen changed?** Update the matching steps in `<tool>/shots.py` (what to click, which elements get numbered markers) and the text in `<tool>/guide.src.html` / `<tool>/tour.json`.
3. Push. The workflow does the rest.

## Files

| File | What it is |
|---|---|
| `run.py` | Starts the apps, runs the screenshot scripts, fails on missing markers, builds everything. |
| `lib/capture.py` | Takes one screenshot and records marker positions. |
| `lib/build.py` | Builds the guide, the tour and `version.json`. |
| `lib/browser.py` | Browser launch + optional local fonts. |
| `<tool>/shots.py` | The example data and the steps to reach each screen. |
| `<tool>/guide.src.html` | Guide text. `<figure class="shot" data-src="NAME">` gets screenshot `NAME` + markers. |
| `<tool>/tour.json` | Tour slides. `points` pick which markers of a screenshot to show (renumbered 1…n). |

## Run it on your computer

```
pip install -r guides/requirements.txt
python -m playwright install chromium
(cd dayforge && npm ci)
python guides/run.py            # both tools
python guides/run.py dayforge   # one tool
```

Ports 5180 and 5190 must be free. Set `CHROMIUM_PATH` to use an existing Chromium. If Google Fonts is blocked, put `@fontsource` packages in `guides/.fonts/<family>/` and the screenshots use them instead.

Shareable copies (for posting outside the apps) are written to `guides/.out/<tool>/` (not committed).
