<!--
  CLAUDE.md — working rules for anyone (person or AI) changing My PD (pdl/)
  VERSION HISTORY
    v1  2026-11-22  Created with the move to c3jumpw/mkp-tools: change log rule,
                    roles, hosting, the library staying in c1, guide rebuilds,
                    commenting and versioning, security.
-->

# Working on My PD

Read `README.md` first for what lives where. These are the rules every change follows.

## 1. Every change gets a change log entry (required)

`changelog.json` feeds the What's new sheet in the app and the Change log chapter of the guide. A change without an entry is invisible to the people using the app.

In the **same commit** as the change:

1. Append one release to the END of `releases` (oldest stays first).
2. `version` = release date `YYYY.MM.DD`. A second release the same day is `YYYY.MM.DD-2`. Versions must be unique and ascending. Never change the version or title of a published release; devices remember versions as "seen".
3. Fill in `date`, `title`, `summary`, `versions` (file versions, e.g. `index.html v14 · guide.html v3`), `repo` (`c3jumpw/mkp-tools`) and `commits` once you know them.
4. Add one item per change people would notice:
   - `type`: new, improved, fixed or changed.
   - `audience`: `everyone`, or `admin` for anything only used with Organize on (uploads, rename, move, Trash, covers, collections, transcripts) or done outside the app (passcode, relay, keys, hosting).
   - `title` and `text`: plain language from the user's side of the screen. No file names in everyone items.
   - `link` (optional): a guide chapter such as `#trash`.
5. Set `updated` at the top. Leave `announceSince` alone.
6. Validate: `python3 -c "import json; json.load(open('pdl/changelog.json'))"`.

A device that has never seen What's new (a new phone, or every device after an address change) is shown only the **newest** release. While a release is unpublished, add admin follow-ups to it instead of starting a new release.

## 2. Roles

There are no accounts. The passcode gets everyone in, and **Organize** shows the admin tools. The app remembers per device that Organize has been used, and that decides who sees admin items in What's new. Hiding a button is not security. The passcode is a soft lock that ships in `index.html`.

## 3. The library stays in c1jumpw/mkp-tools

Media, covers, summaries, transcripts, collections and Trash live in `c1jumpw/mkp-tools/pdl/media`. The relay can only write there (`ALLOWED_PREFIXES`). Don't move the library or change `OWNER`/`REPO` in `index.html` unless the relay's `OWNER`/`REPO` and token move with it, in the same release, with an admin change log note.

## 4. The guide

`guide.html` is generated. Don't hand-edit it. When a screen, button or setting changes, update `guide-src/template.html` and `guide-src/figs.py`, re-capture if the screen looks different, and rebuild (`guide-src/README.md`). A change-log-only update needs no rebuild: on the live site the guide re-reads `changelog.json`.

## 5. Commenting and versioning (the owner's rule)

- Every file starts with a header: purpose, what it does, assumptions, and a VERSION HISTORY block. Bump it on every change. In `index.html` the version number matches the release count in `changelog.json`.
- Every function gets a doc comment. Non-obvious logic gets an inline comment on intent and trade-offs.

## 6. Security

- Never put relay secrets (`GITHUB_TOKEN`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, `UPLOAD_APP_KEY`) anywhere in this repo or in chat. `CONFIG.APP_KEY` and `CONFIG.WORKER_URL` are public by design.
- Never put the passcode into `guide.html`, `changelog.json` or a README.

## 7. Before pushing

- `index.html` script parses: `node -e "new Function(require('fs').readFileSync('pdl/index.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1])"`.
- Open the app with the sample library (`guide-src/whatsnew_test.py`) if What's new or roles changed.
- After pushing, check https://mypd.mkcworkspace.com, `/changelog.json` and `/guide.html`.
